// L'export du coffre, sans React ni DOM.
//
// Séparé pour une raison précise : cette fonction décide ce qui SORT du coffre
// en clair. C'est le seul endroit du produit où des secrets quittent le chiffré,
// et ça mérite d'être éprouvable avec un tableau en entrée et une chaîne en
// sortie.

import type { VaultEntry } from "@/lib/vault";

const echappe = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;

export const EN_TETE_CSV = "name,folder,url,username,password,totp";

/// Rend le CSV d'une liste d'entrées **personnelles**.
///
/// Le nom du paramètre n'est pas décoratif. L'application Svelte exportait
/// d'abord `items`, qui fusionne le coffre personnel et les éléments d'équipe :
/// un membre pouvait donc déposer les secrets de toute son organisation en clair
/// dans un fichier, sur sa machine, sans que l'équipe l'apprenne. Sortir un
/// secret partagé du coffre est une décision qui appartient à l'équipe, pas à
/// la personne qui clique.
///
/// Le trou avait été relevé par la session iOS le 2026-08-29 en cherchant qui
/// d'autre lisait la collection unifiée. Il est corrigé là-bas ; ici il ne peut
/// pas revenir, parce que la fonction ne reçoit que ce qu'on veut bien lui
/// donner et que son nom dit lequel.
export function versCsv(personnels: VaultEntry[]): string {
  const lignes = personnels.map((i) =>
    [i.name, i.folder, i.url, i.username, i.password, i.totp].map(echappe).join(","),
  );
  return [EN_TETE_CSV, ...lignes].join("\n");
}

/// Les colonnes qu'on sait lire, par ordre de préférence.
///
/// Les exports de 1Password, Bitwarden et Proton ne s'accordent sur aucun nom.
/// Plutôt que d'imposer le nôtre, on accepte les leurs : un import qui refuse
/// le fichier que l'utilisateur a sous la main ne sert à rien.
const ALIAS = {
  name: ["name", "title"],
  username: ["username", "login_username", "login"],
  password: ["password", "login_password"],
  url: ["url", "login_uri", "website", "uri"],
  folder: ["folder", "vault", "group"],
  totp: ["totp", "login_totp", "otpauth"],
} as const;

export function depuisLigneCsv(
  r: Record<string, string>,
  sansNom: string,
): { kind: "login"; name: string; username: string; password: string; url: string; folder: string; totp: string } {
  const prends = (champ: keyof typeof ALIAS) =>
    ALIAS[champ].map((k) => r[k]).find((v) => v) ?? "";
  return {
    kind: "login",
    name: prends("name") || sansNom,
    username: prends("username"),
    password: prends("password"),
    url: prends("url"),
    folder: prends("folder"),
    totp: prends("totp"),
  };
}
