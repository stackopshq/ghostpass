// Le tri de la liste, l'adresse qu'ouvre le menu « … », et la décision des
// raccourcis clavier : ce qui agit, et surtout ce qui ne doit pas agir.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  adresseOuvrable,
  ecrireOrdre,
  lireOrdre,
  ORDRE_PAR_DEFAUT,
  sensNaturel,
  trierEntrees,
  type VaultEntry,
} from "../src/lib/vault";
import { quelRaccourci, type Contexte, type Touche } from "../src/lib/raccourcis";
import { genreDe } from "../src/components/AffichageEnGrand";

function entree(name: string, updatedAt: number): VaultEntry {
  return { id: name, name, updatedAt } as VaultEntry;
}

test("les quatre ordres : nom dans les deux sens, date dans les deux sens", () => {
  const items = [entree("Banque", 100), entree("Agenda", 300), entree("Courriel", 300)];
  const noms = (critere: "nom" | "modification", sens: "asc" | "desc") =>
    trierEntrees(items, { critere, sens }).map((i) => i.name);
  assert.deepEqual(noms("nom", "asc"), ["Agenda", "Banque", "Courriel"]);
  assert.deepEqual(noms("nom", "desc"), ["Courriel", "Banque", "Agenda"]);
  // Égalité de date : départagée par le nom de A à Z, dans les deux sens.
  assert.deepEqual(noms("modification", "desc"), ["Agenda", "Courriel", "Banque"]);
  assert.deepEqual(noms("modification", "asc"), ["Banque", "Agenda", "Courriel"]);
});

test("le tri ne réordonne pas le tableau reçu", () => {
  const items = [entree("B", 1), entree("A", 2)];
  trierEntrees(items, ORDRE_PAR_DEFAUT);
  assert.deepEqual(items.map((i) => i.name), ["B", "A"]);
});

test("l'ordre relu du navigateur : chaque ordre revient, le reste retombe sur le défaut", () => {
  for (const critere of ["nom", "modification"] as const)
    for (const sens of ["asc", "desc"] as const)
      assert.deepEqual(lireOrdre(ecrireOrdre({ critere, sens })), { critere, sens });
  // `recent` et `nom` sont l'ancien format, d'avant le menu.
  for (const brut of [null, "", "nom", "recent", "nom:", "taille:asc", "nom:haut"])
    assert.deepEqual(lireOrdre(brut), ORDRE_PAR_DEFAUT, String(brut));
});

test("changer de critère reprend son sens attendu", () => {
  assert.equal(sensNaturel("nom"), "asc");
  assert.equal(sensNaturel("modification"), "desc");
});

test("une adresse sans schéma s'ouvre en https", () => {
  assert.equal(adresseOuvrable("github.com"), "https://github.com/");
  assert.equal(adresseOuvrable("http://intranet.local/x"), "http://intranet.local/x");
});

test("rien d'autre que http et https ne s'ouvre", () => {
  // Le cas qui motive le filtre : une adresse piégée dans une collection
  // d'équipe, que `window.open` exécuterait dans l'origine du coffre.
  for (const piege of ["javascript://%0aalert(1)", "JavaScript://x%0aalert(1)", "data://text/html,x", "file:///etc/passwd", "", "   "]) {
    assert.equal(adresseOuvrable(piege), null, piege);
  }
});

const RIEN: Touche = { key: "", code: "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
const LIBRE: Contexte = { dansUnChamp: false, dansLaRecherche: false, texteSelectionne: false };
const CHAMP: Contexte = { dansUnChamp: true, dansLaRecherche: false, texteSelectionne: false };
const RECHERCHE: Contexte = { dansUnChamp: true, dansLaRecherche: true, texteSelectionne: false };

const touche = (t: Partial<Touche>): Touche => ({ ...RIEN, ...t });

test("Ctrl+C copie le mot de passe, sauf dans un champ ou sur une sélection", () => {
  const ctrlC = touche({ key: "c", code: "KeyC", ctrlKey: true });
  assert.equal(quelRaccourci(ctrlC, LIBRE), "copierMotDePasse");
  assert.equal(quelRaccourci(touche({ key: "c", code: "KeyC", metaKey: true }), LIBRE), "copierMotDePasse");
  // Le texte qu'on a sélectionné à la souris passe avant le mot de passe.
  assert.equal(quelRaccourci(ctrlC, { ...LIBRE, texteSelectionne: true }), null);
  assert.equal(quelRaccourci(ctrlC, CHAMP), null);
  assert.equal(quelRaccourci(ctrlC, RECHERCHE), null);
});

test("Alt+C se lit par la touche physique, pour l'Option+C d'un Mac", () => {
  assert.equal(quelRaccourci(touche({ key: "ç", code: "KeyC", altKey: true }), LIBRE), "copierIdentifiant");
  assert.equal(quelRaccourci(touche({ key: "ç", code: "KeyC", altKey: true }), CHAMP), null);
});

test("les lettres seules sont du texte dans un champ, des commandes ailleurs", () => {
  assert.equal(quelRaccourci(touche({ key: "/" }), LIBRE), "chercher");
  assert.equal(quelRaccourci(touche({ key: "?", shiftKey: true }), LIBRE), "aide");
  assert.equal(quelRaccourci(touche({ key: "/" }), CHAMP), null);
  assert.equal(quelRaccourci(touche({ key: "?", shiftKey: true }), RECHERCHE), null);
});

test("les flèches parcourent la liste depuis la recherche, pas depuis un autre champ", () => {
  assert.equal(quelRaccourci(touche({ key: "ArrowDown" }), RECHERCHE), "suivant");
  assert.equal(quelRaccourci(touche({ key: "ArrowUp" }), LIBRE), "precedent");
  assert.equal(quelRaccourci(touche({ key: "ArrowDown" }), CHAMP), null);
});

test("chercher et verrouiller marchent partout, même dans un champ", () => {
  assert.equal(quelRaccourci(touche({ key: "k", ctrlKey: true }), CHAMP), "chercher");
  assert.equal(quelRaccourci(touche({ key: "L", ctrlKey: true, shiftKey: true }), CHAMP), "verrouiller");
  // Ctrl+L seul est la barre d'adresse : il reste au navigateur.
  assert.equal(quelRaccourci(touche({ key: "l", ctrlKey: true }), LIBRE), null);
});

test("une touche ordinaire, ou modifiée sans sens ici, ne fait rien", () => {
  assert.equal(quelRaccourci(touche({ key: "a" }), LIBRE), null);
  assert.equal(quelRaccourci(touche({ key: "c", code: "KeyC", ctrlKey: true, shiftKey: true }), LIBRE), null);
  assert.equal(quelRaccourci(touche({ key: "/", ctrlKey: true }), LIBRE), null);
});

test("l'affichage en grand sépare lettres, chiffres et symboles", () => {
  assert.equal(genreDe("l"), "lettre");
  assert.equal(genreDe("I"), "lettre");
  assert.equal(genreDe("é"), "lettre");
  assert.equal(genreDe("1"), "chiffre");
  assert.equal(genreDe("0"), "chiffre");
  assert.equal(genreDe("O"), "lettre");
  assert.equal(genreDe("!"), "symbole");
  assert.equal(genreDe(" "), "symbole");
});

import { coffreDuLot } from "../src/lib/vault";

const perso = (id: string) => ({ id, name: id, updatedAt: 0 }) as VaultEntry;
const equipe = (id: string, orgId: string, permission = "write") =>
  ({ id, name: id, updatedAt: 0, shared: { orgId, orgName: orgId, collectionId: "c", collectionName: "c", permission } }) as VaultEntry;

test("un lot se range dans son coffre quand il n'en a qu'un, où l'on peut écrire", () => {
  assert.deepEqual(coffreDuLot([perso("a"), perso("b")]), { type: "personnel" });
  assert.deepEqual(coffreDuLot([equipe("a", "o1"), equipe("b", "o1", "manage")]), { type: "organisation", orgId: "o1" });
});

test("un lot mêlé, ou touchant une collection en lecture seule, ne se range pas", () => {
  assert.equal(coffreDuLot([]), null);
  assert.equal(coffreDuLot([perso("a"), equipe("b", "o1")]), null);
  assert.equal(coffreDuLot([equipe("a", "o1"), equipe("b", "o2")]), null);
  assert.equal(coffreDuLot([equipe("a", "o1"), equipe("b", "o1", "read")]), null);
});

import { buildTree, lignesDeLArbre, type LigneArbre } from "../src/lib/vault";

const range = (name: string, folder: string, updatedAt = 0) => ({ id: name, name, folder, updatedAt }) as VaultEntry;
const lire = (l: LigneArbre[]) =>
  l.map((x) => (x.type === "dossier" ? `${"  ".repeat(x.profondeur)}[${x.nom} ${x.total}${x.deplie ? " -" : " +"}]` : `${"  ".repeat(x.profondeur)}${x.item.name}`));

const COFFRE = [
  range("Zèbre", ""),
  range("Agenda", ""),
  range("Banque", "Perso"),
  range("Serveur", "Travail/Dev"),
  range("Wiki", "Travail"),
];

test("l'arbre dans la liste : dossiers d'abord, repliés par défaut, avec leur compte", () => {
  const arbre = buildTree(COFFRE, ["Vide"]);
  assert.deepEqual(lire(lignesDeLArbre(arbre, new Set(), ORDRE_PAR_DEFAUT)), [
    "[Perso 1 +]",
    "[Travail 2 +]",
    "[Vide 0 +]",
    "Agenda",
    "Zèbre",
  ]);
});

test("un dossier déplié montre ses sous-dossiers puis ses éléments, en retrait", () => {
  const arbre = buildTree(COFFRE, []);
  assert.deepEqual(lire(lignesDeLArbre(arbre, new Set(["Travail", "Travail/Dev"]), ORDRE_PAR_DEFAUT)), [
    "[Perso 1 +]",
    "[Travail 2 -]",
    "  [Dev 1 -]",
    "    Serveur",
    "  Wiki",
    "Agenda",
    "Zèbre",
  ]);
  // Un sous-dossier déplié sous un parent replié ne montre rien.
  assert.deepEqual(lire(lignesDeLArbre(arbre, new Set(["Travail/Dev"]), ORDRE_PAR_DEFAUT)).length, 4);
});

test("le tri de Z à A retourne aussi les dossiers ; le tri par date, non", () => {
  const arbre = buildTree(COFFRE, []);
  assert.deepEqual(lire(lignesDeLArbre(arbre, new Set(), { critere: "nom", sens: "desc" })), [
    "[Travail 2 +]",
    "[Perso 1 +]",
    "Zèbre",
    "Agenda",
  ]);
  const parDate = lignesDeLArbre(buildTree([range("A", "", 1), range("B", "", 2), range("C", "X")], []), new Set(), {
    critere: "modification",
    sens: "desc",
  });
  assert.deepEqual(lire(parDate), ["[X 1 +]", "B", "A"]);
});

import { duGenre, lireVue } from "../src/lib/vault";

const deGenre = (name: string, kind: "login" | "card" | "note") => ({ id: name, name, kind, updatedAt: 0 }) as VaultEntry;

test("le filtre « Afficher » garde un type et écarte les autres", () => {
  const coffre = [deGenre("Banque", "login"), deGenre("Visa", "card"), deGenre("Wifi", "note")];
  assert.deepEqual(duGenre(coffre, "card").map((i) => i.name), ["Visa"]);
  assert.deepEqual(duGenre(coffre, "login").map((i) => i.name), ["Banque"]);
  // « Toutes les entrées » ne retire rien, et rend une copie.
  const tout = duGenre(coffre, "tous");
  assert.deepEqual(tout.map((i) => i.name), ["Banque", "Visa", "Wifi"]);
  assert.notEqual(tout, coffre);
});

test("la vue relue du navigateur : chaque vue revient, le reste retombe sur les dossiers", () => {
  for (const v of ["dossiers", "liste", "tuiles"] as const) assert.equal(lireVue(v), v);
  for (const brut of [null, "", "grille", "Liste", "tuiles "]) assert.equal(lireVue(brut), "dossiers", String(brut));
});
