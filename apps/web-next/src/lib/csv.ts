// Parseur CSV minimal (gère les guillemets et les retours à la ligne échappés).
// Renvoie une ligne par enregistrement, sous forme d'objet indexé par en-tête (en minuscules).

/// Marque d'ordre des octets. Excel et plusieurs navigateurs la posent en tête
/// du fichier ; sans ce retrait, le premier en-tête s'appelle `<BOM>name` et
/// aucun alias ne le trouve. Le symptôme est silencieux et trompeur : tout le
/// fichier s'importe, et toutes les entrées portent « (sans nom) » parce que
/// SEULE la première colonne a disparu.
const BOM = "\u{FEFF}";

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = (text.startsWith(BOM) ? text.slice(BOM.length) : text).replace(/\r\n?/g, "\n");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseRows(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length < 2) return [];
  const headers = rows[0]!.map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (cells[i] ?? "").trim();
    });
    return obj;
  });
}

/// Un enregistrement du fichier, avec de quoi rendre compte de son sort.
export type LigneCsv = {
  /// Rang de l'enregistrement parmi les lignes de données, à partir de 1.
  ///
  /// Ce n'est PAS le numéro de ligne physique : une note sur trois lignes
  /// occupe trois lignes du fichier et un seul enregistrement. Le compte rendu
  /// parle donc d'« entrée n° N », pas de « ligne N » : dire l'un pour l'autre
  /// enverrait l'utilisateur chercher au mauvais endroit dans son tableur.
  numero: number;
  /// Les cellules telles que découpées, avant tout rognage.
  cellules: string[];
  /// Les champs indexés par en-tête minuscule, valeurs BRUTES.
  ///
  /// Volontairement non rognées, à la différence de `parseCsv` : un mot de
  /// passe peut commencer ou finir par une espace, et la rogner produit un
  /// secret faux que rien ne signale, le pire des échecs d'import, puisqu'il
  /// se découvre à la première connexion refusée, des semaines plus tard.
  /// C'est à l'appelant de rogner les champs pour lesquels c'est anodin.
  champs: Record<string, string>;
  /// Faux quand le nombre de cellules ne correspond pas à l'en-tête : guillemet
  /// non refermé, séparateur exotique, fichier tronqué.
  conforme: boolean;
};

export type FichierCsv = { entetes: string[]; lignes: LigneCsv[] };

/// Le même découpage que `parseCsv`, mais qui rend compte de ce qu'il a vu.
///
/// `parseCsv` écrase deux informations dont un compte rendu d'import honnête a
/// besoin : la position de l'enregistrement, et le fait qu'une ligne était
/// malformée. Sans elles, une ligne illisible se présente comme une entrée vide
/// et se compte parmi les réussites.
export function parseCsvDetaille(text: string): FichierCsv {
  const rows = parseRows(text);
  const utiles = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (utiles.length < 1) return { entetes: [], lignes: [] };

  const entetes = utiles[0]!.map((h) => h.trim().toLowerCase());
  const lignes = utiles.slice(1).map((cellules, i) => {
    const champs: Record<string, string> = {};
    entetes.forEach((h, j) => {
      // La première occurrence gagne : un fichier qui répète un en-tête ne doit
      // pas voir sa colonne pleine écrasée par une colonne vide du même nom.
      if (champs[h] === undefined || champs[h] === "") champs[h] = cellules[j] ?? "";
    });
    return { numero: i + 1, cellules, champs, conforme: cellules.length === entetes.length };
  });
  return { entetes, lignes };
}
