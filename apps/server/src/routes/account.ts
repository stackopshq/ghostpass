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
import { verifierLeSecondFacteur } from "../services/mfa.js";
import { verifyServerSecret } from "../services/security.js";
import { estAdminDeLInstance } from "../services/administration.js";
import { dernierAdminDUneOrg, effacerLeCompte } from "../services/effacement.js";

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
      // Pour que le client propose la vue d'administration de l'instance. Indicatif : les
      // routes `/api/admin/*` vérifient le rôle elles-mêmes.
      isInstanceAdmin: estAdminDeLInstance(u.email),
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
      const verdict = await verifierLeSecondFacteur(db, u, parsed.data.totpCode);
      if (!verdict.ok) {
        if (verdict.raison === "bloque")
          return reply.code(429).send({
            error: "trop d'essais sur le second facteur",
            mfaRequired: true,
            lockedUntil: verdict.jusqua,
          });
        return reply.code(401).send({ error: "code 2FA requis ou invalide", mfaRequired: true });
      }
    }

    const org = await dernierAdminDUneOrg(db, u.id);
    if (org)
      return reply.code(409).send({
        error:
          "vous êtes le dernier administrateur d'au moins une organisation : " +
          "nommez un autre administrateur, ou supprimez l'organisation, avant de supprimer votre compte",
        organizationId: org,
      });

    await effacerLeCompte(db, req, u, {
      action: "account.delete",
      userId: u.id,
      actorEmail: u.email,
    });

    return reply.code(204).send();
  });
}
