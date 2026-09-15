// La sécurité du compte, sans React.
//
// Une seule fonction pour l'instant, mais elle mérite d'être ici : elle est
// pure, elle a des cas limites, et elle était noyée dans un composant de deux
// mille lignes où personne ne l'aurait éprouvée.

/// Un libellé lisible depuis une chaîne d'agent utilisateur.
///
/// Sert à répondre à « est-ce que c'était moi ? » devant la liste des
/// connexions. On ne cherche donc pas l'exactitude d'une bibliothèque de
/// détection : on cherche à ce que quelqu'un reconnaisse SA machine.
///
/// L'ordre des tests n'est pas décoratif : tout navigateur moderne écrit
/// « Safari » dans sa chaîne, et Edge y écrit aussi « Chrome ». Tester du plus
/// spécifique au plus général est ce qui évite de rendre « Safari » pour
/// Chrome sous Windows.
export function libelleAppareil(ua: string, navigateurParDefaut: string): string {
  const os =
    /Windows/.test(ua) ? "Windows"
    : /Mac OS|Macintosh/.test(ua) ? "macOS"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iOS/.test(ua) ? "iOS"
    : /Linux/.test(ua) ? "Linux"
    : "";
  const navigateur =
    /Firefox/.test(ua) ? "Firefox"
    : /Edg\//.test(ua) ? "Edge"
    : /Chrome/.test(ua) ? "Chrome"
    : /Safari/.test(ua) ? "Safari"
    : navigateurParDefaut;
  // Le repli tronque l'agent brut : mieux vaut une chaîne illisible mais vraie
  // qu'un « Navigateur inconnu » qui n'aide personne à se reconnaître.
  return [navigateur, os].filter(Boolean).join(" · ") || ua.slice(0, 40);
}
