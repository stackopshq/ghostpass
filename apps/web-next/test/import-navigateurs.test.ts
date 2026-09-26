import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyser, detecterNavigateur, nomDepuisUrl } from "../src/lib/importNavigateur.js";
import { traduire } from "../src/lib/i18n.js";

// L'import du fichier qu'un navigateur vient de cracher.
//
// CE QUE CES TESTS SURVEILLENT
// -----------------------------
// Les fichiers de `fixtures/` ne sont pas inventés : ce sont les en-têtes et
// les formes réellement produits par Chrome 131, Edge 131, Firefox 133 et
// Safari 18. Les deviner est exactement ce qui fait rater un import, parce
// qu'aucun des quatre n'écrit les mêmes colonnes et que Firefox n'écrit PAS de
// colonne de nom.
//
// Chaque cas affirme qu'une VALEUR précise est arrivée, ou qu'un rejet porte un
// MOTIF précis. Un test qui vérifierait seulement que l'import ne plante pas
// laisserait passer le seul défaut qui compte vraiment ici : des lignes perdues
// sous un « import réussi ».

const SANS_NOM = "(sans nom)";

function fixture(nom: string): string {
  return readFileSync(new URL(`./fixtures/${nom}`, import.meta.url), "utf8");
}

/// L'analyse d'un fichier importé dans un coffre vide.
function analyse(nom: string) {
  return analyser(fixture(nom), [], SANS_NOM);
}

// détection du format

test("Chrome est reconnu à ses seuls en-têtes", () => {
  assert.equal(analyse("chrome.csv").navigateur, "chromium");
});

// Edge n'a pas de format à lui : il écrit celui de Chromium, aux mêmes colonnes
// anglaises quelle que soit la langue de l'interface. Le test le fige, pour que
// personne n'aille inventer une distinction que le fichier ne porte pas.
test("Edge écrit le format de Chromium, à l'identique", () => {
  assert.equal(analyse("edge.csv").navigateur, "chromium");
});

test("Firefox est reconnu à ses colonnes techniques, en-têtes entre guillemets", () => {
  assert.equal(analyse("firefox.csv").navigateur, "firefox");
});

// Safari et 1Password se ressemblent à une colonne près (`Tags`). Confondre les
// deux serait sans conséquence sur l'import lui-même, mais donnerait un compte
// rendu qui ment sur ce qu'on vient de lire.
test("Safari n'est pas confondu avec 1Password", () => {
  assert.equal(analyse("safari.csv").navigateur, "safari");
  assert.equal(
    detecterNavigateur(["title", "url", "username", "password", "otpauth", "tags", "notes"]),
    "autre",
  );
});

test("un export Bitwarden reste lisible, sous l'étiquette « autre »", () => {
  const a = analyser(
    "folder,favorite,type,name,notes,fields,login_uri,login_username,login_password,login_totp\n" +
      "Travail,,login,Serveur,Redémarrer avant 8h,,https://bascule.example,kevin,s3cr3t,JBSWY3DPEHPK3PXP\n",
    [],
    SANS_NOM,
  );
  assert.equal(a.navigateur, "autre");
  assert.equal(a.formatReconnu, true);
  assert.equal(a.aImporter.length, 1);
  assert.equal(a.aImporter[0]!.note, "Redémarrer avant 8h");
});

test("un CSV qui n'a rien à voir se dit non reconnu, plutôt que de rejeter mille lignes", () => {
  const a = analyser("date,montant,libellé\n2026-01-02,12.40,Boulangerie\n", [], SANS_NOM);
  assert.equal(a.formatReconnu, false);
  assert.equal(a.aImporter.length, 0);
});

// ce qui entre dans le coffre

test("Chrome : les quatre entrées arrivent, virgules et guillemets compris", () => {
  const a = analyse("chrome.csv");
  assert.equal(a.lues, 4);
  assert.equal(a.aImporter.length, 4);
  assert.equal(a.ignorees.length, 0);

  const mairie = a.aImporter[1]!;
  assert.equal(mairie.name, "mairie-pressins.fr");
  assert.equal(mairie.username, "clara");
  // Le mot de passe contient la virgule qui découpe les colonnes ET le
  // guillemet qui les protège. C'est le champ que le moindre parseur naïf
  // tronque, sans rien signaler.
  assert.equal(mairie.password, 'Zx,9"qw');
  assert.equal(mairie.note, "Compte de la mairie");
});

test("Chrome : un identifiant d'application Android n'est pas une URL, et passe quand même", () => {
  const a = analyse("chrome.csv");
  const appli = a.aImporter[2]!;
  assert.deepEqual(appli.urls, ["android://f4Kk9Q==@com.spotify.music/"]);
  assert.equal(appli.name, "com.spotify.music");
});

// Sans dérivation du nom, tout un coffre Firefox s'appelle « (sans nom) » :
// l'import est techniquement réussi et le coffre est inutilisable.
test("Firefox : le nom est tiré de l'adresse, puisque le fichier n'en donne aucun", () => {
  const a = analyse("firefox.csv");
  assert.equal(a.lues, 2);
  assert.equal(a.aImporter.length, 2);
  assert.equal(a.aImporter[0]!.name, "exemple.fr");
  assert.equal(a.aImporter[0]!.password, "secret-firefox");
  // Le port n'appartient pas au nom, et `www.` non plus.
  assert.equal(a.aImporter[1]!.name, "intranet.exemple.lan");
  assert.equal(a.aImporter[1]!.username, "admin");
});

test("Safari : la note et le code à usage unique suivent", () => {
  const a = analyse("safari.csv");
  assert.equal(a.aImporter.length, 2);
  assert.equal(a.aImporter[0]!.name, "Assurance");
  assert.equal(a.aImporter[0]!.note, "Numéro de contrat 44821");
  assert.equal(
    a.aImporter[0]!.totp,
    "otpauth://totp/Assurance:clara?secret=JBSWY3DPEHPK3PXP",
  );
});

// La marque d'ordre des octets ne se voit pas dans un éditeur. Sans son retrait,
// le premier en-tête s'appelle `<BOM>name` : SEULE la colonne du nom disparaît,
// tout le reste s'importe, et le coffre entier s'appelle « (sans nom) ».
test("une marque d'ordre des octets ne mange pas la première colonne", () => {
  const a = analyse("chrome-bom.csv");
  assert.equal(a.navigateur, "chromium");
  assert.equal(a.aImporter.length, 1);
  assert.equal(a.aImporter[0]!.name, "example.com");
});

test("une note de plusieurs lignes survit entière", () => {
  const a = analyse("chrome-penible.csv");
  const hebergeur = a.aImporter.find((e) => e.name === "Hébergeur")!;
  assert.equal(
    hebergeur.note,
    'Première ligne, avec virgule\nDeuxième ligne avec "guillemets"\nTroisième ligne',
  );
});

// Rogner un mot de passe fabrique un secret faux, que rien ne signale et qui se
// découvre à la première connexion refusée, des semaines après l'import.
test("les espaces d'un mot de passe sont gardées, celles d'une adresse non", () => {
  const a = analyse("edge.csv");
  const intranet = a.aImporter.find((e) => e.name === "intranet")!;
  assert.equal(intranet.password, "  espaces  ");

  const b = analyser(
    "name,url,username,password,note\nSite,  https://site.example  ,  clara  ,  mdp  ,\n",
    [],
    SANS_NOM,
  );
  assert.deepEqual(b.aImporter[0]!.urls, ["https://site.example"]);
  assert.equal(b.aImporter[0]!.username, "clara");
  assert.equal(b.aImporter[0]!.password, "  mdp  ");
});

// ce qui n'entre pas, et pourquoi

test("une entrée sans mot de passe mais avec une note entre, et se compte à part", () => {
  const a = analyse("chrome.csv");
  assert.equal(a.sansMotDePasse, 1);
  const forum = a.aImporter[3]!;
  assert.equal(forum.password, "");
  assert.equal(forum.note, "Compte créé en 2019 puis mot de passe oublié");
});

test("une entrée sans mot de passe NI note ni code n'a rien à protéger", () => {
  const a = analyse("chrome-penible.csv");
  const motifs = a.ignorees.map((i) => i.motif);
  assert.ok(motifs.includes("sansSecret"));
});

// Une adresse vide ne suffit PAS à jeter une ligne : le code d'un portail
// d'immeuble n'a pas d'adresse et reste un secret qu'on tient à garder. On ne
// rejette que ce qui n'a plus rien pour être retrouvé.
test("une adresse vide n'empêche pas l'import quand l'entrée a un nom", () => {
  const a = analyse("chrome-penible.csv");
  const portail = a.aImporter.find((e) => e.name === "Code du portail")!;
  assert.deepEqual(portail.urls, []);
  assert.equal(portail.password, "4821");
});

test("une ligne sans nom, sans adresse et sans identifiant est rejetée pour ça", () => {
  const a = analyse("chrome-penible.csv");
  assert.ok(a.ignorees.some((i) => i.motif === "sansIdentifiant"));
});

test("une ligne dont les colonnes ne tombent pas juste est rejetée comme illisible", () => {
  const a = analyse("chrome-penible.csv");
  assert.ok(a.ignorees.some((i) => i.motif === "illisible"));
});

test("un doublon strict dans le fichier n'entre qu'une fois", () => {
  const a = analyse("edge.csv");
  assert.equal(a.lues, 3);
  assert.equal(a.aImporter.length, 2);
  assert.deepEqual(
    a.ignorees.map((i) => i.motif),
    ["doublonFichier"],
  );
});

test("un doublon strict de ce qui est déjà au coffre n'entre pas non plus", () => {
  const a = analyser(fixture("chrome.csv"), [
    { urls: ["https://example.com/"], username: "clara@example.com", password: "3XnP-quatre" },
  ], SANS_NOM);
  assert.deepEqual(
    a.ignorees.map((i) => i.motif),
    ["doublonCoffre"],
  );
  assert.equal(a.aImporter.length, 3);
});

// Le piège du dédoublonnage : deux lignes de même adresse et même identifiant
// mais de mots de passe différents sont DEUX informations, dont l'une est
// peut-être la seule à jour. Les confondre perd un secret en silence, ce qu'un
// doublon n'est jamais censé coûter.
test("deux mots de passe différents pour le même compte ne sont pas un doublon", () => {
  const a = analyser(
    "name,url,username,password,note\n" +
      "Site,https://site.example/,clara,ancien-mot-de-passe,\n" +
      "Site,https://site.example/,clara,nouveau-mot-de-passe,\n",
    [],
    SANS_NOM,
  );
  assert.equal(a.aImporter.length, 2);
  assert.equal(a.ignorees.length, 0);
});

// le compte rendu
// L'invariant qui interdit le « import réussi » qui masque des pertes : tout ce
// qui a été lu est soit importé, soit rejeté avec un motif. Rien ne s'évapore.
test("tout ce qui est lu est soit importé, soit rejeté avec un motif", () => {
  for (const nom of ["chrome.csv", "edge.csv", "firefox.csv", "safari.csv", "chrome-penible.csv"]) {
    const a = analyse(nom);
    assert.equal(
      a.lues,
      a.aImporter.length + a.ignorees.length,
      `${nom} : ${a.lues} lues pour ${a.aImporter.length} importées et ${a.ignorees.length} rejetées`,
    );
  }
});

// Le compte rendu s'affiche, se recopie dans un ticket, et finit parfois dans
// une console. Il ne doit donc porter que des nombres. Ce test échoue si
// quelqu'un ajoute un jour « l'URL en cause » à un motif de rejet, ce qui est
// la première chose qu'on a envie de faire pour rendre l'écran plus utile.
test("le compte rendu ne transporte aucune valeur du fichier", () => {
  const a = analyse("chrome-penible.csv");
  const rendu = JSON.stringify(a.ignorees);
  for (const secret of ["motdepasse", "4821", "clara", "hebergeur.exemple.ch", "casse"]) {
    assert.ok(!rendu.includes(secret), `le motif de rejet contient « ${secret} »`);
  }
  for (const i of a.ignorees) assert.equal(typeof i.numero, "number");
});

// dérivation du nom

test("nomDepuisUrl retire le schéma, le www, le chemin, le port et les identifiants", () => {
  assert.equal(nomDepuisUrl("https://www.exemple.fr/connexion?x=1#a"), "exemple.fr");
  assert.equal(nomDepuisUrl("http://intranet.exemple.lan:8443/"), "intranet.exemple.lan");
  assert.equal(nomDepuisUrl("https://clara:motdepasse@exemple.fr/"), "exemple.fr");
  assert.equal(nomDepuisUrl("android://f4Kk9Q==@com.spotify.music/"), "com.spotify.music");
  assert.equal(nomDepuisUrl("exemple.fr"), "exemple.fr");
  assert.equal(nomDepuisUrl("   "), "");
  assert.equal(nomDepuisUrl(""), "");
});

test("une entrée sans nom et sans adresse exploitable garde le libellé de repli", () => {
  const a = analyser("name,url,username,password\n,,clara,motdepasse\n", [], SANS_NOM);
  assert.equal(a.aImporter[0]!.name, SANS_NOM);
});

// les libellés de l'écran

// Une clé absente ne plante pas : `traduire` rend la CLÉ elle-même, et
// « import.reason.doublonCoffre » s'affiche à l'utilisateur comme si c'était
// une phrase. Le repli du français vers l'anglais est du même genre, en plus
// discret : la moitié de l'écran passe en anglais sans que rien ne le signale.
// Ce test tient donc la liste des clés dont l'écran a besoin, dans les deux
// langues.
const CLES = [
  "import.title",
  "import.intro",
  "import.howto",
  "import.warning",
  "import.deleteFile",
  "import.choose",
  "import.cancel",
  "import.back",
  "import.close",
  "import.readError",
  "import.notRecognised",
  "import.summary",
  "import.noPassword",
  "import.confirm",
  "import.nothing",
  "import.progress",
  "import.done",
  "import.failed",
  ...["chromium", "firefox", "safari", "autre"].map((n) => `import.detected.${n}`),
  ...["doublonCoffre", "doublonFichier", "sansSecret", "sansIdentifiant", "illisible"].map(
    (m) => `import.reason.${m}`,
  ),
  ...["chrome", "edge", "firefox", "safari"].flatMap((n) => [
    `import.${n}.nom`,
    `import.${n}.etapes`,
  ]),
];

// Les noms propres se disent pareil dans les deux langues ; les exclure évite
// de les traduire pour satisfaire un test.
const IDENTIQUES = new Set(
  ["chrome", "edge", "firefox", "safari"].map((n) => `import.${n}.nom`),
);

test("l'écran d'import a tous ses libellés, en français comme en anglais", () => {
  for (const cle of CLES) {
    const fr = traduire("fr", cle);
    const en = traduire("en", cle);
    assert.notEqual(fr, cle, `libellé manquant : ${cle}`);
    assert.notEqual(en, cle, `libellé manquant (en) : ${cle}`);
    if (!IDENTIQUES.has(cle)) {
      // Égalité stricte = le français retombe sur l'anglais, faute de clé `fr`.
      assert.notEqual(fr, en, `traduction française absente : ${cle}`);
    }
  }
});

test("les nombres du compte rendu sont bien substitués", () => {
  assert.equal(
    traduire("fr", "import.summary", { lues: 340, aImporter: 312, ignorees: 28 }),
    "340 entrée(s) lue(s), 312 à importer, 28 ignorée(s).",
  );
});
