import type { FastifyRequest } from "fastify";
import { sql, type SqlBool } from "kysely";
import type { DB } from "../db/database.js";
import { orgMembers, users } from "../db/repositories.js";
import type { UserRow } from "../types.js";
import { recordAudit, type AuditAction } from "./audit.js";

/**
 * L'effacement d'un compte, qu'il vienne de la personne (`DELETE /api/account`, article 17)
 * ou d'un administrateur de l'instance (`DELETE /api/admin/users/:id`). Un seul chemin, pour
 * qu'une correction de l'un ne manque pas à l'autre : l'anonymisation du journal ci-dessous
 * a déjà été corrigée deux fois.
 */

const CIBLE_EFFACEE = "(compte supprimé)";

// Une organisation dont le dernier administrateur s'efface devient
// inadministrable : ses membres restants ne peuvent plus inviter, ni
// révoquer, ni même se retirer proprement. `orgAdmin.ts` tient déjà cette
// garde pour un changement de rôle ; elle vaut a fortiori ici.
export async function dernierAdminDUneOrg(db: DB, userId: string): Promise<string | null> {
  const appartenances = await orgMembers.listByUser(db, userId);
  for (const m of appartenances) {
    if (m.role !== "admin" || m.status !== "active") continue;
    const membres = await orgMembers.listByOrg(db, m.org_id);
    const autresAdmins = membres.filter(
      (x) => x.status === "active" && x.role === "admin" && x.user_id !== userId,
    );
    if (autresAdmins.length === 0) return m.org_id;
  }
  return null;
}

/// Efface `u`. L'événement est consigné par cette fonction, au bon moment de la séquence :
/// `account.delete` quand la personne s'efface, `admin.user.delete` quand un administrateur
/// le fait (avec la personne en `target`, que l'anonymisation remplace ensuite).
export async function effacerLeCompte(
  db: DB,
  req: FastifyRequest,
  u: UserRow,
  evenement: { action: AuditAction; userId: string | null; actorEmail: string | null; target?: string },
): Promise<void> {
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
  await recordAudit(db, req, evenement.action, evenement);

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
}
