import type { DecryptedItem } from "@/lib/crypto";
import { adressesPourSaisie } from "@/components/ChampsAdresses";

/// La saisie des deux écrans d'équipe — `CollectionPane` et `orgs/DetailOrg`.
///
/// Elle vit ici et non dans chaque écran parce que c'est la duplication qui a
/// produit le défaut : les deux écrans déclaraient leur propre forme, aucune ne
/// portait `passwordHistory` ni `folder`, et `encryptOrgLogin` — qui prend la
/// saisie entière — les réécrivait à vide à chaque modification.
///
/// Deux champs n'ont donc AUCUNE case à l'écran, et c'est voulu : ce qui manque
/// ici est effacé, pas ignoré.
export interface SaisieEquipe {
  name: string;
  username: string;
  password: string;
  urls: string[];
  notes: string;
  totp: string;
  /// Aucun champ ne le montre — le web n'affiche l'historique nulle part. iOS
  /// et Android le construisent et l'affichent.
  passwordHistory: string[];
  /// Aucun champ ne le montre non plus. Les éléments d'équipe n'ont pas encore
  /// de dossier sur le web, mais un autre client peut en poser un.
  folder: string;
}

/// Une saisie vierge. La liste d'adresses est recopiée : sans cela, tous les
/// formulaires vierges partageraient le même tableau.
export function saisieEquipeVide(): SaisieEquipe {
  return {
    name: "", username: "", password: "", urls: [""], notes: "", totp: "",
    passwordHistory: [], folder: "",
  };
}

/// Ce que l'écran pré-remplit en ouvrant un élément à modifier. Tout ce que
/// cette fonction oublie est perdu au premier enregistrement.
export function saisieDepuisElement(item: DecryptedItem): SaisieEquipe {
  return {
    name: item.name,
    username: item.username,
    password: item.password,
    urls: adressesPourSaisie(item.urls),
    notes: item.note ?? "",
    totp: item.totp ?? "",
    passwordHistory: item.passwordHistory ?? [],
    folder: item.folder ?? "",
  };
}
