// Le rendu du document légal, éprouvé sur le document réel.
//
// POURQUOI CE TEST EXISTE
// -----------------------
// `renduMarkdown` est un analyseur écrit à la main. Il ne peut pas produire
// d'injection — sa sortie est un arbre React, jamais une chaîne de HTML — mais
// il peut parfaitement produire du TEXTE FAUX, et c'est ce qui est arrivé : la
// première version ne descendait pas dans le gras, si bien que
// `**après le \`#\`**` s'affichait avec ses accents graves sur la page que lit
// un juriste. Rien n'a échoué ; la page était simplement laide et fausse.
//
// D'où la seconde assertion, qui est la vraie garantie : le document RÉEL,
// celui qui est publié, ne doit laisser aucune syntaxe Markdown visible. Ce
// contrôle attrape la prochaine construction que ce rendu ne connaît pas, sans
// qu'il faille l'avoir prévue.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { rendreMarkdown } from "../src/lib/renduMarkdown";

const html = (source: string) => renderToStaticMarkup(<>{rendreMarkdown(source)}</>);
const texte = (source: string) =>
  html(source)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

test("les marques imbriquées dans du gras sont rendues, pas recopiées", () => {
  const rendu = html("La clé vit **après le `#`**, et *pas `ailleurs`*.");
  assert.match(rendu, /<strong[^>]*>après le <code/, "le littéral dans du gras reste littéral");
  assert.match(rendu, /<em>pas <code/, "le littéral dans de l'italique aussi");
  assert.ok(!texte(rendu).includes("`"), "un accent grave est resté visible");
});

test("un libellé de lien porte ses propres marques", () => {
  const rendu = html("Voir [le **registre**](https://exemple.fr/r).");
  assert.match(rendu, /<a [^>]*href="https:\/\/exemple\.fr\/r"[^>]*>le <strong/);
});

test("le document publié ne laisse aucune syntaxe Markdown visible", () => {
  // Le fichier que sert `/confidentialite`, lu au même endroit que la page.
  const source = readFileSync(
    path.join(process.cwd(), "..", "..", "docs", "legal", "politique-de-confidentialite.md"),
    "utf8",
  );
  const rendu = texte(source);

  assert.ok(rendu.length > 2000, "le document semble vide : le test ne mesure rien");
  for (const [marque, nom] of [
    ["`", "accent grave"],
    ["|", "barre de tableau"],
    ["**", "double astérisque"],
  ] as const) {
    assert.ok(
      !rendu.includes(marque),
      `${nom} visible dans la page rendue — une construction du document n'est pas comprise`,
    );
  }
  // Et le fond : ce que la page doit porter pour être utile.
  for (const attendu of ["privacy@stackops.ch", "PFPDT", "ghostbit"]) {
    assert.ok(rendu.includes(attendu), `« ${attendu} » a disparu du rendu`);
  }
});
