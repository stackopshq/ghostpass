// L'effacement et l'export : les deux droits que l'API ne savait pas honorer.
//
// Chaque test répond à une question qu'un contrôle poserait, et pas à
// « le code fait-il ce qu'il dit ». Le plus important est le dernier : un
// effacement qui laisse l'adresse de la personne dans le journal d'audit
// n'efface pas, et c'est le mode d'échec le plus discret des trois.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";

const INSCRIPTION = {
  email: "clara@stackops.ch",
  masterPasswordHash: "client-auth-hash-AAA",
  kdfParams: JSON.stringify({ mem_cost_kib: 65536, time_cost: 3, parallelism: 4 }),
  encryptedUserKey: "2.bm9uY2U.Y2lwaGVy",
  encryptedPrivateKey: "2.bm9uY2Uy.Y2lwaGVyMg",
  publicKey: "cHVibGlja2V5LWJhc2U2NA",
};

async function compte(app: ReturnType<typeof buildApp>, email = INSCRIPTION.email) {
  const r = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { ...INSCRIPTION, email },
  });
  assert.ok(r.statusCode === 200 || r.statusCode === 201, `inscription refusée : ${r.statusCode} ${r.body}`);
  return r.json().token as string;
}

test("l'export rend ce que le serveur détient, et le rend chiffré", async () => {
  const app = buildApp(openDatabase(":memory:"));
  const token = await compte(app);

  const res = await app.inject({
    method: "GET",
    url: "/api/account/export",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.statusCode, 200);
  const d = res.json();

  assert.equal(d.formatVersion, 1, "un export sans version n'est pas comparable au suivant");
  assert.equal(d.account.email, INSCRIPTION.email);
  assert.equal(d.account.encryptedUserKey, INSCRIPTION.encryptedUserKey);
  assert.ok(Array.isArray(d.vaultItems));
  assert.ok(Array.isArray(d.loginEvents));
  assert.ok(Array.isArray(d.auditLog));

  // Ce que l'export ne doit JAMAIS contenir : la preuve d'authentification
  // du serveur. L'exporter livrerait de quoi se faire passer pour la personne
  // à quiconque met la main sur le fichier.
  const brut = JSON.stringify(d);
  assert.ok(!brut.includes("server_password_hash"), "l'export porte le hachage serveur");
  assert.ok(!brut.includes("password_salt"), "l'export porte le sel du mot de passe");
  assert.ok(!brut.includes("mfa_secret"), "l'export porte le secret du second facteur");

  await app.close();
});

test("l'export exige une session", async () => {
  const app = buildApp(openDatabase(":memory:"));
  const res = await app.inject({ method: "GET", url: "/api/account/export" });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("supprimer un compte exige le mot de passe, pas seulement la session", async () => {
  const app = buildApp(openDatabase(":memory:"));
  const token = await compte(app);

  const sans = await app.inject({
    method: "DELETE",
    url: "/api/account",
    headers: { authorization: `Bearer ${token}` },
    payload: {},
  });
  assert.equal(sans.statusCode, 400, "une suppression sans preuve doit être refusée");

  const faux = await app.inject({
    method: "DELETE",
    url: "/api/account",
    headers: { authorization: `Bearer ${token}` },
    payload: { serverPassword: "ce-n-est-pas-le-bon" },
  });
  assert.equal(faux.statusCode, 401, "un mauvais mot de passe doit être refusé");

  // Le compte est toujours là.
  const encore = await app.inject({
    method: "GET",
    url: "/api/account/export",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(encore.statusCode, 200);

  await app.close();
});

test("la suppression efface le compte et invalide la session", async () => {
  const app = buildApp(openDatabase(":memory:"));
  const token = await compte(app);

  const res = await app.inject({
    method: "DELETE",
    url: "/api/account",
    headers: { authorization: `Bearer ${token}` },
    payload: { serverPassword: INSCRIPTION.masterPasswordHash },
  });
  assert.equal(res.statusCode, 204, `suppression refusée : ${res.body}`);

  // La session tombe avec le compte — `sessions.user_id` est en cascade.
  const apres = await app.inject({
    method: "GET",
    url: "/api/account/export",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(apres.statusCode, 401, "la session survit à la suppression du compte");

  // Et l'adresse est réutilisable : rien ne subsiste qui la retienne.
  const rouvert = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: INSCRIPTION,
  });
  assert.ok(
    rouvert.statusCode === 200 || rouvert.statusCode === 201,
    "l'adresse reste prise après suppression",
  );

  await app.close();
});

test("le journal d'audit survit à la personne, mais pas son adresse ni son IP", async () => {
  const db = openDatabase(":memory:");
  const app = buildApp(db);
  const token = await compte(app);

  // Une connexion, pour garantir qu'il existe des lignes d'audit portant
  // l'adresse — sans quoi le test passerait en ne mesurant rien.
  await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: INSCRIPTION.email, masterPasswordHash: INSCRIPTION.masterPasswordHash },
  });

  const avant = await db.selectFrom("audit_log").selectAll().execute();
  assert.ok(
    avant.some((l) => l.actor_email === INSCRIPTION.email),
    "aucune ligne d'audit ne portait l'adresse : le test ne mesure rien",
  );

  await app.inject({
    method: "DELETE",
    url: "/api/account",
    headers: { authorization: `Bearer ${token}` },
    payload: { serverPassword: INSCRIPTION.masterPasswordHash },
  });

  const apres = await db.selectFrom("audit_log").selectAll().execute();
  assert.ok(apres.length > 0, "le journal a été vidé : un journal effaçable ne prouve plus rien");
  assert.ok(
    apres.every((l) => l.actor_email !== INSCRIPTION.email),
    "l'adresse de la personne supprimée est encore au journal",
  );
  assert.ok(
    apres.every((l) => l.ip === "" || l.user_id !== null),
    "une ligne orpheline garde encore une adresse IP",
  );

  await app.close();
});

test("l'effacement retire l'adresse AUSSI là où la personne est la CIBLE", async () => {
  // Le test qui précède gardait la moitié du problème.
  //
  // `audit_log` porte DEUX colonnes nominatives : `actor_email`, qui dit qui a
  // agi, et `target`, qui dit sur qui. L'anonymisation ne balayait que les
  // lignes de la personne en tant qu'ACTEUR (`WHERE user_id = …`). Les lignes
  // où elle est la cible appartiennent à l'ADMINISTRATEUR qui a agi : elles ne
  // la référencent pas, la cascade `ON DELETE SET NULL` ne les touche pas, et
  // son adresse y survivait jusqu'à 365 jours après la suppression de son
  // compte — la durée de rétention du journal.
  //
  // Le garde-fou existait et regardait à côté : l'assertion ne portait que sur
  // `actor_email`. Un test vert au-dessus d'un défaut présent est pire qu'une
  // absence de test, parce qu'il fait croire que la question a été posée.
  //
  // Ce défaut ne se produit QU'EN ORGANISATION, c'est-à-dire dans le périmètre
  // exact du contrat de sous-traitance, là où un Client peut être saisi d'une
  // demande d'effacement et doit pouvoir répondre qu'elle a été honorée.
  const db = openDatabase(":memory:");
  const app = buildApp(db);

  const ADMIN = "admin@stackops.ch";
  const CIBLE = "bob@stackops.ch";
  const jetonAdmin = await compte(app, ADMIN);
  const jetonCible = await compte(app, CIBLE);
  const enTeteAdmin = { authorization: `Bearer ${jetonAdmin}` };

  const idCible = (
    await db.selectFrom("users").select("id").where("email", "=", CIBLE).executeTakeFirstOrThrow()
  ).id;

  const SCEAU = "2.bm9uY2U.Y2lwaGVy";
  const org = await app.inject({
    method: "POST",
    url: "/api/orgs",
    headers: enTeteAdmin,
    payload: { name: "Acme", encryptedOrgKey: SCEAU },
  });
  assert.equal(org.statusCode, 201, org.body);
  const orgId = org.json().orgId as string;

  // Les cinq écritures qui mettent une adresse de courriel dans `target`.
  // L'audit du 2026-08-31 en citait trois ; il en existe deux de plus, dont
  // une COMPOSITE — `adresse:rôle` — qu'un effacement par égalité stricte
  // manquerait en silence.
  const ajout = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/members`,
    headers: enTeteAdmin,
    payload: { email: CIBLE, role: "member", encryptedOrgKey: SCEAU },
  });
  assert.equal(ajout.statusCode, 201, ajout.body);

  const groupe = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/groups`,
    headers: enTeteAdmin,
    payload: { name: "Ops" },
  });
  assert.equal(groupe.statusCode, 201, groupe.body);
  const gid = groupe.json().id as string;

  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/orgs/${orgId}/groups/${gid}/members`,
        headers: enTeteAdmin,
        payload: { userId: idCible },
      })
    ).statusCode,
    201,
  );
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `/api/orgs/${orgId}/groups/${gid}/members/${idCible}`,
        headers: enTeteAdmin,
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: `/api/orgs/${orgId}/members/${idCible}`,
        headers: enTeteAdmin,
        payload: { role: "readonly" },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/emergency",
        headers: enTeteAdmin,
        payload: { email: CIBLE, role: "view", waitDays: 7, sealedUserKey: SCEAU },
      })
    ).statusCode,
    201,
  );

  // Sans ce contrôle, le test passerait en ne mesurant rien : c'est exactement
  // ainsi que le précédent restait vert.
  const avant = await db.selectFrom("audit_log").selectAll().execute();
  const nominatives = avant.filter((l) => l.target?.includes(CIBLE));
  assert.deepEqual(
    new Set(nominatives.map((l) => l.action)),
    new Set([
      "org.member.add",
      "org.group.member.add",
      "org.group.member.remove",
      "org.member.role",
      "emergency.grant",
    ]),
    "le témoin ne couvre plus les cinq écritures qui posent une adresse dans `target`",
  );
  assert.ok(
    nominatives.every((l) => l.actor_email === ADMIN),
    "ces lignes doivent appartenir à l'administrateur : c'est ce qui les rend hors de portée de `WHERE user_id = …`",
  );

  const suppression = await app.inject({
    method: "DELETE",
    url: "/api/account",
    headers: { authorization: `Bearer ${jetonCible}` },
    payload: { serverPassword: INSCRIPTION.masterPasswordHash },
  });
  assert.equal(suppression.statusCode, 204, suppression.body);

  const apres = await db.selectFrom("audit_log").selectAll().execute();
  assert.deepEqual(
    apres.filter((l) => l.target?.includes(CIBLE)).map((l) => `${l.action} → ${l.target}`),
    [],
    "l'adresse de la personne supprimée survit dans `audit_log.target`",
  );

  // L'imputabilité est l'autre moitié de l'exigence : ce qui doit disparaître
  // est l'ADRESSE, pas la trace de l'action. Un journal qu'on vide en
  // supprimant un compte ne prouve plus rien à l'administrateur qui a agi.
  assert.ok(
    apres.some((l) => l.action === "org.member.add" && l.actor_email === ADMIN),
    "l'ajout du membre a disparu du journal : l'effacement a emporté la trace de l'action",
  );
  assert.ok(
    apres.some((l) => l.action === "org.member.role" && l.target?.endsWith(":readonly")),
    "le rôle attribué a disparu avec l'adresse : le journal ne dit plus ce qui a été fait",
  );
  assert.ok(
    apres.some((l) => l.action === "org.member.add" && !!l.target),
    "la cible a été vidée plutôt que remplacée : une case blanche ne distingue plus " +
      "« la cible a été effacée » de « cette action n'avait pas de cible »",
  );

  await app.close();
});

test("l'effacement d'une cible ne déborde pas sur une adresse voisine", async () => {
  // Le garde-fou de l'échappement.
  //
  // `_` est un caractère parfaitement légal dans une partie locale d'adresse,
  // et c'est aussi le joker « un caractère quelconque » de `LIKE`. Une version
  // simplifiée de l'anonymisation — `LIKE adresse || ':%'` sans `ESCAPE` —
  // passerait tous les autres tests de ce fichier et effacerait en silence les
  // lignes visant une TIERCE personne. C'est une sur-anonymisation : elle
  // détruit l'imputabilité que le journal existe pour porter, et elle ne se
  // voit nulle part puisqu'aucune erreur n'est levée.
  const db = openDatabase(":memory:");
  const app = buildApp(db);

  const ADMIN = "admin@stackops.ch";
  const PARTANT = "a_b@stackops.ch"; // le joker est ici
  const VOISIN = "axb@stackops.ch"; // et c'est lui que le joker attraperait
  const jetonAdmin = await compte(app, ADMIN);
  const jetonPartant = await compte(app, PARTANT);
  await compte(app, VOISIN);
  const enTete = { authorization: `Bearer ${jetonAdmin}` };

  const idDe = async (email: string) =>
    (await db.selectFrom("users").select("id").where("email", "=", email).executeTakeFirstOrThrow())
      .id;

  const SCEAU = "2.bm9uY2U.Y2lwaGVy";
  const orgId = (
    await app.inject({
      method: "POST",
      url: "/api/orgs",
      headers: enTete,
      payload: { name: "Acme", encryptedOrgKey: SCEAU },
    })
  ).json().orgId as string;

  // Un rôle change pour chacun : c'est l'écriture COMPOSITE `adresse:rôle`,
  // la seule que l'anonymisation traite par motif plutôt que par égalité.
  for (const email of [PARTANT, VOISIN]) {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/orgs/${orgId}/members`,
          headers: enTete,
          payload: { email, role: "member", encryptedOrgKey: SCEAU },
        })
      ).statusCode,
      201,
    );
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/orgs/${orgId}/members/${await idDe(email)}`,
          headers: enTete,
          payload: { role: "readonly" },
        })
      ).statusCode,
      200,
    );
  }

  await app.inject({
    method: "DELETE",
    url: "/api/account",
    headers: { authorization: `Bearer ${jetonPartant}` },
    payload: { serverPassword: INSCRIPTION.masterPasswordHash },
  });

  const apres = await db.selectFrom("audit_log").selectAll().execute();
  assert.ok(
    apres.every((l) => !l.target?.includes(PARTANT)),
    "l'adresse du compte supprimé survit au journal",
  );
  assert.ok(
    apres.some((l) => l.target === `${VOISIN}:readonly`),
    "la ligne d'une TIERCE personne a été anonymisée : le motif a débordé faute d'échappement",
  );

  await app.close();
});
