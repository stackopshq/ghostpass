// Rendu Markdown des documents de `docs/legal/`, au moment de la CONSTRUCTION.
//
// POURQUOI PAS UNE BIBLIOTHÈQUE
// -----------------------------
// Ajouter `marked` ou `remark` à un gestionnaire de mots de passe, c'est ajouter
// une dépendance — et sa chaîne transitive — pour lire cinq constructions dans
// un fichier que nous écrivons nous-mêmes. Le sous-ensemble ci-dessous couvre
// exactement ce que `docs/legal/` utilise, et rien de plus : un jour où un
// document emploiera autre chose, il faudra l'ajouter ici, ce qui est le bon
// moment pour se demander si le document en avait besoin.
//
// POURQUOI C'EST SÛR MALGRÉ UN ANALYSEUR ÉCRIT À LA MAIN
// ------------------------------------------------------
// Un analyseur Markdown maison est d'ordinaire une source d'injection. Ici il
// ne peut pas en être une, pour deux raisons cumulées :
//
//   1. l'entrée n'est pas une donnée d'utilisateur — c'est un fichier du dépôt,
//      lu au moment de la construction, jamais à l'exécution ;
//   2. la sortie est un arbre d'ÉLÉMENTS REACT, pas une chaîne de HTML. Aucun
//      `dangerouslySetInnerHTML` n'apparaît dans ce fichier, donc `<script>`
//      écrit dans le Markdown ressortirait comme du texte visible, pas comme
//      une balise.
//
// Le second point est la garantie qui compte : elle tient même si l'analyseur
// est faux.

import type { ReactNode } from "react";

// Les documents de `docs/legal/` se citent l'un l'autre par des chemins
// relatifs (`dpa.md`), ce qui n'a de sens qu'à l'intérieur du dépôt. Servis
// dans l'application, ces liens tomberaient dans le repli de nginx et
// rendraient le coffre. On les fait donc pointer vers le dépôt public, qui est
// l'endroit où ces documents sont réellement consultables.
const BASE_DOCUMENTS =
  "https://git.stackops.ch/stackops/ghostpass/src/branch/main/docs/legal/";

function resoudreLien(url: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("/")
    ? url
    : BASE_DOCUMENTS + url;
}

// `code` d'abord : les autres marques n'ont aucune valeur à l'intérieur d'une
// portion littérale. `**` avant `*`, sinon le gras se lit comme deux italiques.
const MARQUES =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))|(<https?:\/\/[^>\s]+>)|(\*[^*]+\*)/g;

function lien(url: string, contenu: ReactNode, cle: number) {
  // `noreferrer` implique `noopener` : l'onglet ouvert ne peut pas reprendre la
  // main sur celui du coffre.
  return (
    <a
      key={cle}
      href={resoudreLien(url)}
      target="_blank"
      rel="noreferrer"
      className="text-accent underline underline-offset-2 hover:text-accent-hover"
    >
      {contenu}
    </a>
  );
}

/** Les marques de niveau ligne : gras, italique, littéral, liens. */
function rendreInline(texte: string): ReactNode[] {
  const sortie: ReactNode[] = [];
  let curseur = 0;
  let cle = 0;

  for (const m of texte.matchAll(MARQUES)) {
    const debut = m.index;
    if (debut > curseur) sortie.push(texte.slice(curseur, debut));
    const brut = m[0];

    if (m[1]) {
      sortie.push(
        <code
          key={cle++}
          className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs text-foreground"
        >
          {brut.slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      sortie.push(
        <strong key={cle++} className="font-semibold text-foreground">
          {brut.slice(2, -2)}
        </strong>,
      );
    } else if (m[3]) {
      const coupe = brut.indexOf("](");
      sortie.push(lien(brut.slice(coupe + 2, -1), brut.slice(1, coupe), cle++));
    } else if (m[4]) {
      const url = brut.slice(1, -1);
      sortie.push(lien(url, url, cle++));
    } else {
      sortie.push(<em key={cle++}>{brut.slice(1, -1)}</em>);
    }

    curseur = debut + brut.length;
  }

  if (curseur < texte.length) sortie.push(texte.slice(curseur));
  return sortie;
}

const CELLULE = "border-b border-border px-3 py-2 align-top";

function cellules(ligne: string): string[] {
  return ligne
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

const estSeparateur = (l: string) => /^\|[\s:|-]+\|$/.test(l.trim());

/**
 * Rend un document Markdown en éléments React.
 *
 * Constructions reconnues : titres `#` à `###`, citations `>`, filets `---`,
 * listes `-`, tableaux à barres verticales, et paragraphes. Tout le reste est
 * rendu comme du texte, ce qui est visible à la relecture — un document qui
 * emploierait une construction inconnue ne disparaît pas, il s'affiche mal.
 */
export function rendreMarkdown(source: string): ReactNode[] {
  const lignes = source.replace(/\r\n/g, "\n").split("\n");
  const blocs: ReactNode[] = [];
  let i = 0;
  let cle = 0;

  while (i < lignes.length) {
    const ligne = lignes[i];

    if (!ligne.trim()) {
      i += 1;
      continue;
    }

    // Filet horizontal. Le séparateur d'un tableau commence par `|` et n'arrive
    // donc jamais ici.
    if (/^-{3,}$/.test(ligne.trim())) {
      blocs.push(<hr key={cle++} className="my-8 border-border" />);
      i += 1;
      continue;
    }

    const titre = /^(#{1,3})\s+(.*)$/.exec(ligne);
    if (titre) {
      const contenu = rendreInline(titre[2]);
      const niveau = titre[1].length;
      if (niveau === 1) {
        blocs.push(
          <h1 key={cle++} className="text-2xl font-semibold tracking-tight text-foreground">
            {contenu}
          </h1>,
        );
      } else if (niveau === 2) {
        blocs.push(
          <h2 key={cle++} className="mt-10 mb-3 text-xl font-semibold text-foreground">
            {contenu}
          </h2>,
        );
      } else {
        blocs.push(
          <h3 key={cle++} className="mt-6 mb-2 text-lg font-semibold text-foreground">
            {contenu}
          </h3>,
        );
      }
      i += 1;
      continue;
    }

    // Citation : toutes les lignes consécutives préfixées par `>`, recollées en
    // un seul paragraphe comme le fait Markdown.
    if (ligne.startsWith(">")) {
      const corps: string[] = [];
      while (i < lignes.length && lignes[i].startsWith(">")) {
        corps.push(lignes[i].replace(/^>\s?/, ""));
        i += 1;
      }
      blocs.push(
        <blockquote
          key={cle++}
          className="my-5 border-l-2 border-accent/60 bg-surface-2 px-4 py-3 text-sm text-muted"
        >
          {rendreInline(corps.join(" ").trim())}
        </blockquote>,
      );
      continue;
    }

    // Tableau : une ligne à barres suivie d'un séparateur. Sans le séparateur,
    // ce n'est pas un tableau — c'est du texte qui contient des barres.
    if (ligne.trim().startsWith("|") && estSeparateur(lignes[i + 1] ?? "")) {
      const entetes = cellules(ligne);
      i += 2;
      const corps: string[][] = [];
      while (i < lignes.length && lignes[i].trim().startsWith("|")) {
        corps.push(cellules(lignes[i]));
        i += 1;
      }
      // Plusieurs tableaux du dossier n'ont pas d'en-tête (`| | |`) : ce sont
      // des listes de définitions. Coiffer ces colonnes d'une bande vide
      // donnerait un tableau qui a l'air cassé.
      const avecEntete = entetes.some((c) => c !== "");
      blocs.push(
        <div key={cle++} className="my-5 overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-sm text-muted">
            {avecEntete && (
              <thead>
                <tr>
                  {entetes.map((c, n) => (
                    <th
                      key={n}
                      scope="col"
                      className={`${CELLULE} border-border-strong text-left font-semibold text-foreground`}
                    >
                      {rendreInline(c)}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {corps.map((r, n) => (
                <tr key={n}>
                  {r.map((c, m) => (
                    <td key={m} className={CELLULE}>
                      {rendreInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Liste à puces. Une ligne indentée prolonge l'élément précédent : les
    // documents coupent leurs lignes à 80 colonnes, et sans cette reprise
    // chaque repli deviendrait une puce de plus.
    if (/^[-*]\s+/.test(ligne)) {
      const items: string[] = [];
      while (i < lignes.length && lignes[i].trim()) {
        if (/^[-*]\s+/.test(lignes[i])) items.push(lignes[i].replace(/^[-*]\s+/, ""));
        else if (/^\s+/.test(lignes[i]) && items.length)
          items[items.length - 1] += ` ${lignes[i].trim()}`;
        else break;
        i += 1;
      }
      blocs.push(
        <ul key={cle++} className="my-4 list-disc space-y-1.5 pl-5 text-sm text-muted">
          {items.map((t, n) => (
            <li key={n}>{rendreInline(t)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Paragraphe : jusqu'à la ligne vide, ou jusqu'à ce qu'une autre
    // construction commence.
    const corps: string[] = [];
    while (i < lignes.length && lignes[i].trim()) {
      const l = lignes[i];
      if (
        corps.length &&
        (/^(#{1,3})\s/.test(l) || l.startsWith(">") || l.trim().startsWith("|") || /^[-*]\s+/.test(l))
      )
        break;
      corps.push(l.trim());
      i += 1;
    }
    blocs.push(
      <p key={cle++} className="my-4 text-sm leading-relaxed text-muted">
        {rendreInline(corps.join(" "))}
      </p>,
    );
  }

  return blocs;
}
