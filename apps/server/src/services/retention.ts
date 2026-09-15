/// Rétention : ce que le serveur garde, et combien de temps.
///
/// Avant ce fichier, aucune table de traçabilité n'était jamais purgée.
/// `login_events` conservait une adresse IP et un agent utilisateur par
/// connexion, `audit_log` une adresse IP par action, et les deux croissaient
/// sans borne. L'ironie était nette : le sérialiseur de journal retire
/// délibérément l'IP que Fastify écrirait, au motif qu'elle « reprendrait
/// d'une main ce que le chiffrement donne de l'autre » — et la même IP
/// partait dans la base, définitivement. Le raisonnement était juste, il
/// n'avait été appliqué qu'à un des deux réceptacles.
///
/// Les durées sont réglables par l'exploitant, parce qu'un auto-hébergeur
/// n'a pas les mêmes obligations qu'un service vendu.

import type { DB } from "../db/database.js";
import { ephemeral } from "../db/repositories.js";

const JOUR_MS = 24 * 60 * 60 * 1000;

/// Historique de connexion : sert à repérer un accès inhabituel, donc une
/// fenêtre courte suffit. Au-delà, la donnée ne sert plus qu'à exister.
export const RETENTION_LOGIN_EVENTS_JOURS = Number(
  process.env.RETENTION_LOGIN_EVENTS_DAYS ?? 90,
);

/// Journal d'audit : plus long, parce qu'une investigation d'incident remonte
/// plus loin qu'une vérification d'appareil. Un an est la borne usuelle.
export const RETENTION_AUDIT_LOG_JOURS = Number(
  process.env.RETENTION_AUDIT_LOG_DAYS ?? 365,
);

export interface ResultatPurge {
  loginEvents: number;
  auditLog: number;
}

/// Un passage de purge. Idempotent : rejouable sans effet supplémentaire.
export async function purgerLesTraces(db: DB): Promise<ResultatPurge> {
  const maintenant = Date.now();

  const le = await db
    .deleteFrom("login_events")
    .where("created_at", "<", maintenant - RETENTION_LOGIN_EVENTS_JOURS * JOUR_MS)
    .executeTakeFirst();

  const al = await db
    .deleteFrom("audit_log")
    .where("created_at", "<", maintenant - RETENTION_AUDIT_LOG_JOURS * JOUR_MS)
    .executeTakeFirst();

  // `ephemeral.purgeExpired` était écrit depuis toujours et n'était appelé
  // nulle part : un contrôle de rétention non branché, ce qui est pire qu'un
  // contrôle absent — sa présence dans le code laissait croire qu'il agissait.
  await ephemeral.purgeExpired(db);

  return {
    loginEvents: Number(le?.numDeletedRows ?? 0),
    auditLog: Number(al?.numDeletedRows ?? 0),
  };
}

/// Programme la purge : une fois au démarrage, puis toutes les six heures.
/// Renvoie de quoi l'arrêter, pour que les tests ne laissent pas de minuterie
/// derrière eux.
export function programmerLaPurge(
  db: DB,
  journaliser: (r: ResultatPurge) => void = () => {},
): { arreter: () => void } {
  const passe = () => {
    purgerLesTraces(db).then(journaliser).catch(() => {
      // Une purge qui échoue ne doit pas abattre le serveur : elle
      // réessaiera au tour suivant. L'échec reste visible par la croissance
      // des tables, que la supervision voit.
    });
  };
  passe();
  const minuterie = setInterval(passe, 6 * 60 * 60 * 1000);
  // Ne maintient pas le processus en vie à lui seul.
  if (typeof minuterie.unref === "function") minuterie.unref();
  return { arreter: () => clearInterval(minuterie) };
}
