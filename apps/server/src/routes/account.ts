/// Les deux droits que le produit ne savait pas honorer : partir avec ses
/// données, et partir tout court.
///
/// L'API comptait 62 chemins et aucun des deux. Le schéma, lui, était prêt :
/// `vault_items`, `sessions`, `passkeys`, `webauthn_credentials`,
/// `login_events`, `org_members`, `collection_access` portent tous
/// `ON DELETE CASCADE`. Le graphe d'effacement existait et fonctionnait ;
/// rien ne le déclenchait.
///
/// Ce que l'export contient et ne contient pas : tout ce que le serveur
/// détient sur la personne, **chiffré tel qu'il le détient**. Nous ne pouvons
/// pas déchiffrer, donc nous n'exportons pas en clair — c'est la contrepartie
/// exacte de la promesse zero-knowledge, et non une limite de l'export. La
/// personne déchiffre avec sa clé, hors du serveur.

import type { FastifyInstance } from "fastify";
import { sql, type SqlBool } from "kysely";
import { z } from "zod";
import type { DB } from "../db/database.js";
import {
  audit,
  collectionAccess,
  loginEvents,
  orgMembers,
  passkeys,
  users,
  vaultItems,
  webauthnCredentials,
} from "../db/repositories.js";
import { makeAuthenticate } from "../plugins/auth.js";
import { recordAudit } from "../services/audit.js";
import { verifyAndConsumeTotp } from "../services/mfa.js";
import { verifyServerSecret } from "../services/security.js";

const suppressionSchema = z.object({
  /// Le même secret dérivé que celui de la connexion : la preuve que la
  /// personne devant l'écran est bien la titulaire, et pas quelqu'un qui a
  /// trouvé une session ouverte.
  serverPassword: z.string().min(1),
  totpCode: z.string().optional(),
});

/// Ce qui remplace l'adresse d'un compte supprimé dans `audit_log.target`.
///
/// Un marqueur plutôt qu'une case vide, pour la même raison qui fait qu'on
/// anonymise au lieu de supprimer la ligne : « la cible a été effacée » et
/// « cette action n'avait pas de cible » ne sont pas la même information, et
/// l'administrateur qui relit son journal a besoin de les distinguer.
const CIBLE_EFFACEE = "(compte supprimé)";

export function registerAccountRoutes(app: FastifyInstance, db: DB): void {
  const authenticate = makeAuthenticate(db);

  /// « Qui suis-je » : ce que le client doit savoir sur le compte ouvert.
  ///
  /// Le client possédait le jeton de session mais ni l'adresse ni les
  /// paramètres KDF, alors qu'il en a besoin pour recalculer la preuve
  /// d'authentification — celle que la suppression redemande. Sans cette
  /// route, il fallait la lui faire retaper, ce qui aurait fait d'une faute
  /// de frappe un refus incompréhensible.
  app.get("/api/account", { preHandler: authenticate }, async (req) => {
    const u = req.currentUser!;
    return {
      email: u.email,
      kdfParams: u.kdf_params,
      mfaEnabled: u.mfa_enabled === 1,
      createdAt: u.created_at,
    };
  });

  /// Export : article 15 (accès) et 20 (portabilité).
  app.get("/api/account/export", { preHandler: authenticate }, async (req) => {
    const u = req.currentUser!;

    const [items, cles, credentials, connexions, journal, appartenances, acces] =
      await Promise.all([
        vaultItems.listByUser(db, u.id),
        passkeys.listByUser(db, u.id),
        webauthnCredentials.listByUser(db, u.id),
        loginEvents.listByUser(db, u.id, 10_000),
        audit.listByUser(db, u.id, 10_000),
        orgMembers.listByUser(db, u.id),
        collectionAccess.listByUser(db, u.id),
      ]);

    await recordAudit(db, req, "account.export", { userId: u.id, actorEmail: u.email });

    return {
      // Un export daté et versionné : sans ça, deux exports du même compte à
      // six mois d'écart ne sont pas comparables, et personne ne sait quelle
      // forme lire.
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      notice:
        "Les champs chiffrés le sont avec votre clé, dérivée de votre mot de passe maître. " +
        "GhostPass ne peut pas les déchiffrer : c'est la contrepartie du zero-knowledge. " +
        "Utilisez un client GhostPass pour les lire.\n\n" +
        "Vos liens de partage ne figurent pas ici : la table `sends` ne porte aucun " +
        "identifiant d'utilisateur, délibérément — le serveur ne sait pas qui a créé " +
        "quel partage. La liste de vos partages vit dans votre coffre, chiffrée, et " +
        "se trouve donc déjà dans `vaultItems`.",
      account: {
        email: u.email,
        createdAt: u.created_at,
        kdfParams: u.kdf_params,
        mfaEnabled: u.mfa_enabled === 1,
        encryptedUserKey: u.encrypted_user_key,
        encryptedPrivateKey: u.encrypted_private_key,
        publicKey: u.public_key,
      },
      vaultItems: items,
      passkeys: cles,
      webauthnCredentials: credentials,
      loginEvents: connexions,
      auditLog: journal,
      organizationMemberships: appartenances,
      collectionAccess: acces,
    };
  });

  /// Effacement : article 17.
  app.delete("/api/account", { preHandler: authenticate }, async (req, reply) => {
    const u = req.currentUser!;
    const parsed = suppressionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });

    if (!verifyServerSecret(parsed.data.serverPassword, u.server_password_hash, u.password_salt))
      return reply.code(401).send({ error: "mot de passe invalide" });

    if (u.mfa_enabled) {
      if (!parsed.data.totpCode || !(await verifyAndConsumeTotp(db, u, parsed.data.totpCode)))
        return reply.code(401).send({ error: "code 2FA requis ou invalide", mfaRequired: true });
    }

    // Une organisation dont le dernier administrateur s'efface devient
    // inadministrable : ses membres restants ne peuvent plus inviter, ni
    // révoquer, ni même se retirer proprement. `orgAdmin.ts` tient déjà cette
    // garde pour un changement de rôle ; elle vaut a fortiori ici.
    const appartenances = await orgMembers.listByUser(db, u.id);
    for (const m of appartenances) {
      if (m.role !== "admin" || m.status !== "active") continue;
      const membres = await orgMembers.listByOrg(db, m.org_id);
      const autresAdmins = membres.filter(
        (x) => x.status === "active" && x.role === "admin" && x.user_id !== u.id,
      );
      if (autresAdmins.length === 0)
        return reply.code(409).send({
          error:
            "vous êtes le dernier administrateur d'au moins une organisation : " +
            "nommez un autre administrateur, ou supprimez l'organisation, avant de supprimer votre compte",
          organizationId: m.org_id,
        });
    }

    // L'ordre compte, et c'est tout l'intérêt de cette fonction.
    //
    // `audit_log.user_id` est en `ON DELETE SET NULL` : supprimer l'utilisateur
    // laisserait des lignes orphelines portant encore `actor_email` et `ip` —
    // un effacement qui n'efface pas. On anonymise DONC AVANT de supprimer,
    // sans quoi la cascade nous ôte le moyen de retrouver ces lignes.
    //
    // On anonymise plutôt que de supprimer : le journal doit garder la trace
    // qu'une action a eu lieu — c'est sa raison d'être, et un journal qu'on
    // peut vider en supprimant un compte ne prouve plus rien. Ce qui part est
    // ce qui identifie ; ce qui reste est l'événement.
    // L'événement est consigné AVANT l'anonymisation, et non après, pour que
    // l'anonymisation l'emporte lui aussi. Écrit après, il portait l'adresse IP
    // de la personne sur une ligne sans utilisateur — une trace nominative que
    // l'effacement laissait derrière lui. C'est le test qui l'a dit, pas la
    // relecture : la ligne semblait anodine puisqu'elle ne porte pas d'adresse
    // de courriel.
    await recordAudit(db, req, "account.delete", { userId: u.id, actorEmail: u.email });

    await db
      .updateTable("audit_log")
      .set({ actor_email: null, ip: "" })
      .where("user_id", "=", u.id)
      .execute();

    // La passe ci-dessus ne couvre que la moitié du problème, et c'est la
    // moitié la plus visible.
    //
    // `audit_log` porte DEUX colonnes nominatives. `actor_email` dit qui a
    // agi — c'est elle que `WHERE user_id = …` atteint. `target` dit sur qui,
    // et ces lignes-là appartiennent à L'ADMINISTRATEUR qui a agi : ajout d'un
    // membre (`orgs.ts`), d'un groupe ou changement de rôle (`orgAdmin.ts`),
    // invitation d'un contact d'urgence (`emergency.ts`). Elles ne portent
    // donc pas le `user_id` de la personne, la requête ci-dessus ne les voit
    // pas, et la cascade `ON DELETE SET NULL` ne les touche pas davantage.
    // Son adresse y survivait jusqu'à 365 jours après qu'elle a supprimé son
    // compte — la durée de rétention du journal.
    //
    // Le commentaire vingt lignes plus haut décrivait exactement ce défaut,
    // « un effacement qui n'efface pas », mais pour l'autre colonne.
    //
    // DEUX FORMES À COUVRIR, et la seconde est celle qu'une égalité stricte
    // manque en silence : `org.member.role` écrit `adresse:rôle`. D'où le
    // `LIKE`, et d'où le recalcul ligne par ligne — le suffixe doit survivre,
    // sans quoi le journal ne dit plus QUEL rôle a été attribué.
    //
    // L'ÉCHAPPEMENT N'EST PAS DU ZÈLE : `_` est un caractère légal d'une partie
    // locale d'adresse, et c'est le joker « un caractère quelconque » de
    // `LIKE`. Non échappé, supprimer `a_b@exemple.fr` effacerait aussi les
    // lignes visant `axb@exemple.fr` — une SUR-anonymisation, qui détruit
    // précisément l'imputabilité qu'on cherche à préserver. `ESCAPE` est
    // explicite parce que SQLite n'a aucun caractère d'échappement par défaut,
    // là où PostgreSQL en a un.
    const motifCible = u.email.replace(/[\\%_]/g, (c) => `\\${c}`) + ":%";
    const cibles = await db
      .selectFrom("audit_log")
      .select(["id", "target"])
      .where(sql<SqlBool>`target = ${u.email} OR target LIKE ${motifCible} ESCAPE '\\'`)
      .execute();

    for (const ligne of cibles) {
      await db
        .updateTable("audit_log")
        .set({ target: CIBLE_EFFACEE + (ligne.target ?? "").slice(u.email.length) })
        .where("id", "=", ligne.id)
        .execute();
    }

    // La cascade emporte le reste : coffre, sessions, clés d'accès, seconds
    // facteurs, historique de connexion, appartenances, accès aux collections.
    await users.deleteById(db, u.id);

    return reply.code(204).send();
  });
}
