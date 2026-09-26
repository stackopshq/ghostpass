"use client";

// Les adresses d'un identifiant : une liste de champs, avec ajout et retrait.
//
// POURQUOI UN COMPOSANT PLUTÔT QUE TROIS BLOCS
// --------------------------------------------
// Trois formulaires saisissent un identifiant — le coffre personnel
// (`FormulaireEntree`), le panneau d'une collection d'équipe (`CollectionPane`)
// et l'écran d'une organisation (`DetailOrg`). Chacun portait sa propre ligne
// « Site web », et c'est précisément cette triple écriture qui a permis à la
// troncature de survivre : corriger un endroit laissait les deux autres écraser
// la liste au premier enregistrement.
//
// Ici, la règle de saisie n'existe qu'une fois. Les trois écrans la partagent,
// donc un défaut se corrige une fois — et une réécriture d'un formulaire ne
// peut plus réintroduire `[url]` à l'insu des deux autres.
//
// CE QUE LE COMPOSANT REND
// ------------------------
// Toujours au moins UN champ, même quand l'entrée n'a aucune adresse : une
// liste vide sans champ visible obligerait à trouver le bouton « Ajouter »
// avant de pouvoir saisir la première adresse, pour un identifiant qui en a
// presque toujours une.
//
// Les vides ne sont pas filtrés ici mais à l'écriture (`adressesAEcrire` dans
// `lib/crypto`) : les filtrer pendant la frappe ferait disparaître le champ
// qu'on vient de vider, sous le curseur.

import { useI18n } from "@/lib/i18n";
import { Bouton, BoutonIcone, Saisie } from "@/components/champs";
import { Croix, Plus } from "@/components/Icones";

/// Les adresses telles qu'un formulaire les tient en état : au moins une case,
/// éventuellement vide. À appeler sur la liste qui vient d'une entrée déchiffrée.
export function adressesPourSaisie(urls: readonly string[]): string[] {
  return urls.length > 0 ? [...urls] : [""];
}

export function ChampsAdresses({
  valeurs,
  onChange,
  invite = "github.com",
}: {
  valeurs: string[];
  onChange: (suivantes: string[]) => void;
  invite?: string;
}) {
  const { t } = useI18n();
  const cases = valeurs.length > 0 ? valeurs : [""];

  const modifier = (i: number, valeur: string) =>
    onChange(cases.map((v, j) => (j === i ? valeur : v)));

  // Retirer la dernière case la vide au lieu de la supprimer : un formulaire
  // sans aucun champ d'adresse n'a pas de sens, et la case vide ne produit
  // aucune adresse à l'enregistrement.
  const retirer = (i: number) =>
    onChange(cases.length > 1 ? cases.filter((_, j) => j !== i) : [""]);

  return (
    <div className="mb-3 flex flex-col gap-1">
      <span className="text-xs text-muted">{t("app.websites")}</span>
      {cases.map((valeur, i) => (
        // L'index comme clé : les cases n'ont pas d'identité propre, et deux
        // adresses identiques sont une saisie légitime en cours de frappe.
        <div key={i} className="flex items-center gap-1">
          <Saisie
            value={valeur}
            onChange={(e) => modifier(i, e.target.value)}
            placeholder={invite}
            inputMode="url"
            aria-label={t("app.websiteNumber", { n: i + 1 })}
          />
          <BoutonIcone
            onClick={() => retirer(i)}
            title={t("app.removeWebsite")}
            aria-label={t("app.removeWebsite")}
          >
            <Croix className="size-4" />
          </BoutonIcone>
        </div>
      ))}
      <div>
        <Bouton
          type="button"
          variante="discret"
          // Une case vide de plus ne servirait à rien et laisserait croire que
          // le bouton ne répond pas.
          disabled={cases.some((v) => v.trim() === "")}
          onClick={() => onChange([...cases, ""])}
          className="mt-1 flex items-center gap-1.5 px-3 py-1 text-xs"
        >
          <Plus className="size-3.5" />
          {t("app.addWebsite")}
        </Bouton>
      </div>
    </div>
  );
}
