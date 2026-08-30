// La rétention : ce que le serveur oublie, et au bout de combien de temps.
//
// Aucune de ces tables n'était purgée. Le test vérifie les deux directions —
// que le vieux part ET que le récent reste — parce qu'une purge trop large est
// une perte de données silencieuse, et se lit comme un succès.

import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db/database.js";
import {
  RETENTION_AUDIT_LOG_JOURS,
  RETENTION_LOGIN_EVENTS_JOURS,
  purgerLesTraces,
} from "../src/services/retention.js";

const JOUR = 24 * 60 * 60 * 1000;

test("la purge retire les vieilles traces et garde les récentes", async () => {
  const db = openDatabase(":memory:");
  const maintenant = Date.now();

  await db
    .insertInto("users")
    .values({
      id: "u1", email: "a@b.c", kdf_params: "{}", server_password_hash: "h",
      password_salt: "s", encrypted_user_key: "k", encrypted_private_key: "p",
      public_key: "pk", mfa_secret: null, mfa_enabled: 0, mfa_last_counter: 0,
      encrypted_user_key_recovery: null, recovery_auth_hash: null,
      recovery_salt: null, created_at: maintenant,
    })
    .execute();

  const connexion = (id: string, age: number) => ({
    id, user_id: "u1", ip: "10.0.0.1", user_agent: "UA",
    new_device: 0, created_at: maintenant - age,
  });
  await db.insertInto("login_events").values([
    connexion("vieille", (RETENTION_LOGIN_EVENTS_JOURS + 1) * JOUR),
    connexion("recente", 1 * JOUR),
  ]).execute();

  const entree = (id: string, age: number) => ({
    id, user_id: "u1", actor_email: "a@b.c", action: "test",
    target: null, ip: "10.0.0.1", created_at: maintenant - age,
  });
  await db.insertInto("audit_log").values([
    entree("vieille", (RETENTION_AUDIT_LOG_JOURS + 1) * JOUR),
    entree("recente", 1 * JOUR),
  ]).execute();

  const r = await purgerLesTraces(db);
  assert.equal(r.loginEvents, 1);
  assert.equal(r.auditLog, 1);

  const ids = async (table: "login_events" | "audit_log") =>
    (await db.selectFrom(table).select("id").execute()).map((x) => x.id);
  assert.deepEqual(await ids("login_events"), ["recente"]);
  assert.deepEqual(await ids("audit_log"), ["recente"]);
});

test("la purge est rejouable sans rien retirer de plus", async () => {
  const db = openDatabase(":memory:");
  const premier = await purgerLesTraces(db);
  const second = await purgerLesTraces(db);
  assert.deepEqual(premier, { loginEvents: 0, auditLog: 0 });
  assert.deepEqual(second, { loginEvents: 0, auditLog: 0 });
});
