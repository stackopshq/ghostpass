import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/lib/csv.js";
import { depuisLigneCsv } from "../src/lib/export.js";

// L'import d'un CSV exporté par un autre gestionnaire.
//
// CE QUE CES TESTS SURVEILLENT
// -----------------------------
// Un import raté bruyamment se voit. Celui-ci ne l'était pas : l'application
// annonçait le bon nombre d'entrées, et les notes de tout le coffre migré
// n'étaient nulle part. Un test qui vérifierait seulement que l'import ne
// plante pas passerait sur ce défaut : c'est pourquoi chaque cas ci-dessous
// affirme qu'une VALEUR précise est arrivée, jamais qu'un appel a réussi.
//
// Les en-têtes sont ceux des exports réels, relevés fournisseur par
// fournisseur. Les deviner est précisément ce qui avait fait manquer `extra`
// (LastPass) et `note` au singulier (Dashlane, Chrome).

const SANS_NOM = "(sans nom)";

/// La première ligne d'un CSV, telle que l'import la construit.
function premiere(csv: string) {
  const lignes = parseCsv(csv);
  assert.equal(lignes.length, 1, "le CSV de test doit produire exactement une entrée");
  return depuisLigneCsv(lignes[0]!, SANS_NOM);
}

test("Bitwarden : la note arrive, et le dossier avec", () => {
  const e = premiere(
    "folder,favorite,type,name,notes,fields,login_uri,login_username,login_password,login_totp\n" +
      "Travail,,login,Serveur de bascule,Redémarrer avant 8h,,https://bascule.example,kevin,s3cr3t,JBSWY3DPEHPK3PXP\n",
  );
  assert.equal(e.note, "Redémarrer avant 8h");
  assert.equal(e.name, "Serveur de bascule");
  assert.equal(e.folder, "Travail");
  assert.equal(e.username, "kevin");
  assert.equal(e.password, "s3cr3t");
  assert.equal(e.url, "https://bascule.example");
  assert.equal(e.totp, "JBSWY3DPEHPK3PXP");
});

test("1Password : Notes et Tags, en majuscules dans le fichier", () => {
  const e = premiere(
    "Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes\n" +
      "Banque,https://banque.example,clara,motdepasse,otpauth://totp/x,,,Perso,Le conseiller est M. Roux\n",
  );
  assert.equal(e.note, "Le conseiller est M. Roux");
  assert.equal(e.name, "Banque");
  assert.equal(e.folder, "Perso");
  assert.equal(e.totp, "otpauth://totp/x");
});

// Premier piège nommé par le pair : LastPass n'écrit pas « notes ».
test("LastPass : la note s'appelle extra, et le dossier grouping", () => {
  const e = premiere(
    "url,username,password,totp,extra,name,grouping,fav\n" +
      "https://forum.example,clara,motdepasse,,Compte de secours,Forum,Loisirs,0\n",
  );
  assert.equal(e.note, "Compte de secours");
  assert.equal(e.folder, "Loisirs");
  assert.equal(e.name, "Forum");
});

// Second piège : le singulier. `notes` seul ne le trouve pas.
test("Dashlane : la note s'appelle note, au singulier, et le dossier category", () => {
  const e = premiere(
    "username,title,password,note,url,category,otpSecret\n" +
      "clara,Mutuelle,motdepasse,Numéro d'adhérent 44821,https://mutuelle.example,Santé,JBSWY3DPEHPK3PXP\n",
  );
  assert.equal(e.note, "Numéro d'adhérent 44821");
  assert.equal(e.folder, "Santé");
  assert.equal(e.totp, "JBSWY3DPEHPK3PXP");
});

test("Chrome : note au singulier là aussi", () => {
  const e = premiere(
    "name,url,username,password,note\n" +
      "example.com,https://example.com/login,clara,motdepasse,Compte créé en 2019\n",
  );
  assert.equal(e.note, "Compte créé en 2019");
  assert.equal(e.username, "clara");
});

test("KeePass : Group tient lieu de dossier, Notes de note", () => {
  const e = premiere(
    "Group,Title,Username,Password,URL,Notes\n" +
      "Racine/Réseau,Routeur,admin,motdepasse,https://10.0.0.1,Port 8443 depuis le VLAN 20\n",
  );
  assert.equal(e.note, "Port 8443 depuis le VLAN 20");
  assert.equal(e.folder, "Racine/Réseau");
  assert.equal(e.name, "Routeur");
});

// Une note réelle contient des retours à la ligne, des virgules et des
// guillemets. C'est le champ le plus exposé au découpage, et celui dont la
// mutilation ne se verrait qu'en le relisant.
test("une note de plusieurs lignes survit entière, virgules et guillemets compris", () => {
  const e = premiere(
    'name,username,password,notes\n' +
      'Hébergeur,clara,motdepasse,"Première ligne, avec virgule\n' +
      'Deuxième ligne avec ""guillemets""\n' +
      'Troisième ligne"\n',
  );
  assert.equal(
    e.note,
    'Première ligne, avec virgule\nDeuxième ligne avec "guillemets"\nTroisième ligne',
  );
});

// Sans cette garde, ajouter un alias trop gourmand ferait passer une colonne
// vide pour une note absente et inversement.
test("une colonne de note absente donne une note vide, pas un plantage", () => {
  const e = premiere("name,username,password\nSite,clara,motdepasse\n");
  assert.equal(e.note, "");
  assert.equal(e.name, "Site");
});

test("un export de GhostPass se relit lui-même", () => {
  const e = premiere(
    "name,folder,url,username,password,totp\n" +
      "Site,Travail,https://site.example,clara,motdepasse,JBSWY3DPEHPK3PXP\n",
  );
  assert.equal(e.name, "Site");
  assert.equal(e.folder, "Travail");
  assert.equal(e.note, "");
});
