"use client";

// Un dossier dans la liste, et la saisie d'un nouveau dossier.
//
// Un dossier n'est pas un objet stocké côté serveur : c'est un chemin « A/B/C »
// porté par chaque entrée, donc déduit. Les dossiers *vides* n'ont aucune
// entrée d'où être déduits : ils vivent dans un registre chiffré à part, sans
// quoi créer un dossier avant d'y ranger quoi que ce soit serait un geste sans
// effet visible.
//
// Ces lignes vivaient dans un arbre de la barre latérale ; elles sont
// passées dans la liste, voir `lignesDeLArbre` pour la raison.

import { useI18n } from "@/lib/i18n";
import { Chevron, Corbeille, Dossier, Plus } from "@/components/Icones";
import { MenuEntree } from "@/components/MenuEntree";

/// Le retrait d'un niveau d'arbre, en pixels. Celui d'un chevron et de son
/// écart : le contenu d'un dossier commence sous son icône.
export const RETRAIT = 28;

export function LigneDossier({
  nom,
  chemin,
  profondeur,
  total,
  deplie,
  onBasculer,
  onNouvelElement,
  onNouveauSousDossier,
  onSupprimer,
}: {
  nom: string;
  chemin: string;
  profondeur: number;
  total: number;
  deplie: boolean;
  onBasculer: () => void;
  onNouvelElement: () => void;
  onNouveauSousDossier: () => void;
  onSupprimer: () => void;
}) {
  const { t } = useI18n();
  const entrees = [
    { cle: "element", libelle: t("app.newItemHere"), icone: <Plus className="size-4" />, agir: onNouvelElement },
    { cle: "sous", libelle: t("app.newSubfolder"), icone: <Dossier className="size-4" />, agir: onNouveauSousDossier },
    // Seul un dossier vide se supprime : un dossier plein emporterait ses
    // éléments, et le chemin est dans leur chiffré, pas dans un objet à part.
    ...(total === 0
      ? [{ cle: "suppr", libelle: t("app.deleteEmptyFolder"), icone: <Corbeille className="size-4" />, agir: onSupprimer, danger: true }]
      : []),
  ];
  return (
    <div className="group flex items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-surface">
      {/* La place de la case à cocher : le nom d'un dossier commence au même
          endroit que celui d'un élément du même niveau. */}
      <span className="w-4 shrink-0" aria-hidden="true" />
      <button
        type="button"
        onClick={onBasculer}
        aria-expanded={deplie}
        // Le chemin entier, pas le seul nom : deux sous-dossiers « Dev » dans
        // deux dossiers différents se distinguent au lecteur d'écran.
        aria-label={chemin.split("/").join(" / ")}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
        style={{ paddingLeft: profondeur * RETRAIT }}
      >
        <Chevron className={`size-4 shrink-0 text-muted transition-transform ${deplie ? "rotate-90" : ""}`} />
        <span className="grid size-8 shrink-0 place-items-center rounded-sm border border-border bg-surface-2 text-accent">
          <Dossier className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{nom}</span>
          <span className="truncate text-xs text-muted">{t("app.itemCount", { n: total })}</span>
        </span>
      </button>
      <MenuEntree nom={nom} entrees={entrees} libelle={t("app.folderActions", { name: nom })} />
    </div>
  );
}

/// La ligne de saisie d'un nouveau dossier, posée là où il va apparaître : en
/// tête de liste pour la racine, juste sous son parent pour un sous-dossier, au
/// retrait de ses futurs frères.
export function SaisieDossier({
  parent,
  profondeur,
  aide,
  onCreer,
  onFermer,
}: {
  parent: string;
  profondeur: number;
  aide?: string;
  onCreer: (path: string) => void;
  onFermer: () => void;
}) {
  const { t } = useI18n();
  return (
    <form
      aria-label={parent ? t("app.newSubfolder") : t("app.newFolder")}
      className="px-3 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        const champ = e.currentTarget.elements.namedItem("dossier") as HTMLInputElement;
        const nom = champ.value
          .split("/")
          .map((x) => x.trim())
          .filter(Boolean)
          .join("/");
        if (nom) onCreer(parent ? `${parent}/${nom}` : nom);
        onFermer();
      }}
    >
      <div style={{ paddingLeft: 28 + profondeur * RETRAIT }}>
        <div className="flex items-center gap-2 rounded-lg border border-accent/60 bg-surface-2 px-2.5 py-2">
          <Dossier className="size-4 shrink-0 text-accent" />
          <input
            name="dossier"
            autoFocus
            placeholder={t("app.folderPh")}
            aria-label={parent ? t("app.newSubfolder") : t("app.newFolder")}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              // Échap referme la saisie, et elle seule : sans `preventDefault`,
              // les raccourcis du coffre fermeraient aussi la fiche ouverte.
              e.preventDefault();
              onFermer();
            }}
            // Quitter le champ vide, c'est renoncer ; le quitter rempli ne doit
            // pas jeter ce qui a été tapé.
            onBlur={(e) => {
              if (!e.currentTarget.value.trim()) onFermer();
            }}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none"
          />
        </div>
        <p className="mt-1 px-1 text-2xs leading-relaxed text-muted">
          {t("app.newFolderKeys")}
          {aide && <> {aide}</>}
        </p>
      </div>
    </form>
  );
}
