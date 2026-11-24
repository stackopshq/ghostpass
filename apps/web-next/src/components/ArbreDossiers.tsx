"use client";

// La colonne de gauche : les dossiers du coffre.
//
// Un dossier n'est pas un objet stocké côté serveur — c'est un chemin « A/B/C »
// porté par chaque entrée, donc déduit. Les dossiers *vides* n'ont aucune
// entrée d'où être déduits : ils vivent dans un registre chiffré à part, sans
// quoi créer un dossier avant d'y ranger quoi que ce soit serait un geste sans
// effet visible.

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { countItems, type TreeNode } from "@/lib/vault";
import { Chevron, Dossier, Plus } from "@/components/Icones";
import { EnTeteDeSection } from "@/components/BarreLaterale";

/// La ligne de saisie d'un nouveau dossier, posée là où il va apparaître :
/// en tête de l'arbre pour la racine, juste sous son parent pour un
/// sous-dossier, au retrait de ses futurs frères.
function SaisieDossier({
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
      className="py-1 pr-1.5"
      style={{ paddingLeft: profondeur * 14 + 6 }}
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
      <div className="flex items-center gap-1.5 rounded-lg border border-accent/60 bg-surface-2 px-2 py-1.5">
        <Dossier className="size-4 shrink-0 text-accent" />
        <input
          name="dossier"
          autoFocus
          placeholder={t("app.folderPh")}
          aria-label={parent ? t("app.newSubfolder") : t("app.newFolder")}
          onKeyDown={(e) => e.key === "Escape" && onFermer()}
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
    </form>
  );
}

type Creation = { parent: string } | null;

function Noeud({
  node,
  profondeur,
  choisi,
  deplie,
  creation,
  aide,
  onChoisir,
  onBasculer,
  onSupprimer,
  onCreation,
  onCreer,
}: {
  node: TreeNode;
  profondeur: number;
  choisi: string | null;
  deplie: (path: string) => boolean;
  creation: Creation;
  aide?: string;
  onChoisir: (path: string) => void;
  onBasculer: (path: string) => void;
  onSupprimer: (path: string) => void;
  onCreation: (c: Creation) => void;
  onCreer: (path: string) => void;
}) {
  const { t } = useI18n();
  const n = countItems(node);
  const ouvert = deplie(node.path);
  const actif = choisi === node.path;
  return (
    <>
      <div
        className={`group flex items-center gap-1.5 rounded-lg py-2 pr-2 text-sm transition-colors ${actif ? "bg-accent/12 text-accent" : "text-muted hover:bg-surface hover:text-foreground"}`}
        style={{ paddingLeft: profondeur * 14 + 10 }}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            onClick={() => onBasculer(node.path)}
            title={t("app.expandCollapse")}
            aria-label={t("app.expandCollapse")}
            aria-expanded={ouvert}
            className="cursor-pointer rounded p-0.5 text-muted hover:text-foreground"
          >
            <Chevron className={`size-3.5 transition-transform ${ouvert ? "rotate-90" : ""}`} />
          </button>
        ) : (
          <span className="inline-block size-4.5" />
        )}
        <button
          type="button"
          onClick={() => onChoisir(node.path)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
        >
          <Dossier className="size-4 shrink-0" />
          <span className="truncate">{node.name}</span>
        </button>
        <span className="shrink-0 text-2xs tabular-nums text-muted">{n}</span>
        <button
          type="button"
          onClick={() => {
            // Le parent se déplie : la saisie apparaît sous lui, au milieu de
            // ses enfants, et un dossier replié la cacherait.
            if (!ouvert && node.children.length > 0) onBasculer(node.path);
            onCreation({ parent: node.path });
          }}
          title={t("app.newSubfolder")}
          aria-label={t("app.newSubfolder")}
          className="cursor-pointer rounded text-muted opacity-0 transition group-hover:opacity-100 hover:text-accent focus-visible:opacity-100"
        >
          <Plus className="size-3.5" />
        </button>
        {n === 0 && (
          // Rouge : c'est le seul geste destructeur de l'arbre, il doit se
          // distinguer du « + » voisin autrement que par sa forme.
          <button
            type="button"
            onClick={() => onSupprimer(node.path)}
            title={t("app.deleteFolder")}
            aria-label={t("app.deleteEmptyFolder")}
            className="cursor-pointer rounded px-1 text-danger opacity-0 transition group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
          >
            ×
          </button>
        )}
      </div>
      {creation?.parent === node.path && (
        <SaisieDossier
          parent={node.path}
          profondeur={profondeur + 1}
          aide={aide}
          onCreer={onCreer}
          onFermer={() => onCreation(null)}
        />
      )}
      {ouvert &&
        node.children.map((c) => (
          <Noeud
            key={c.path}
            node={c}
            profondeur={profondeur + 1}
            choisi={choisi}
            deplie={deplie}
            creation={creation}
            aide={aide}
            onChoisir={onChoisir}
            onBasculer={onBasculer}
            onSupprimer={onSupprimer}
            onCreation={onCreation}
            onCreer={onCreer}
          />
        ))}
    </>
  );
}

export function ArbreDossiers({
  tree,
  ouvert,
  onBasculerSection,
  choisi,
  recherche,
  replies,
  aideCreation,
  onChoisir,
  onBasculer,
  onCreer,
  onSupprimer,
}: {
  tree: TreeNode;
  ouvert: boolean;
  onBasculerSection: () => void;
  choisi: string | null;
  recherche: string;
  replies: Set<string>;
  /// Une précision sous la saisie d'un nouveau dossier, quand il y a quelque
  /// chose à savoir (dans un coffre d'équipe : quand le dossier sera partagé).
  aideCreation?: string;
  onChoisir: (path: string) => void;
  onBasculer: (path: string) => void;
  onCreer: (path: string) => void;
  onSupprimer: (path: string) => void;
}) {
  const { t } = useI18n();
  const [creation, setCreation] = useState<Creation>(null);
  // Une recherche déplie tout : un résultat caché dans un dossier replié est
  // un résultat que l'on croit absent.
  const deplie = (path: string) => recherche.trim() !== "" || !replies.has(path);

  // LA CRÉATION SE FAIT DANS L'ARBRE
  // Elle passait par une petite fenêtre ouverte depuis une icône de dossier, à
  // côté d'un titre en capitales : on ne trouvait pas le geste, et une fois
  // trouvé on tapait loin de l'endroit où le dossier allait apparaître. Le
  // « + » ouvre une ligne de saisie là où le dossier apparaîtra : celui du
  // titre en tête de l'arbre, celui d'un dossier juste sous lui.
  return (
    <div className="flex flex-col gap-0.5">
      <EnTeteDeSection
        titre={t("app.folders")}
        ouvert={ouvert}
        onBasculer={onBasculerSection}
        action={
          <button
            type="button"
            onClick={() => {
              if (!ouvert) onBasculerSection();
              setCreation({ parent: "" });
            }}
            title={t("app.newFolder")}
            aria-label={t("app.newFolder")}
            className="cursor-pointer rounded p-0.5 text-muted hover:bg-surface hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
        }
      />

      {creation?.parent === "" && (
        <SaisieDossier
          parent=""
          profondeur={0}
          aide={aideCreation}
          onCreer={onCreer}
          onFermer={() => setCreation(null)}
        />
      )}

      {ouvert &&
        tree.children.map((f) => (
          <Noeud
            key={f.path}
            node={f}
            profondeur={0}
            choisi={choisi}
            deplie={deplie}
            creation={creation}
            aide={aideCreation}
            onChoisir={onChoisir}
            onBasculer={onBasculer}
            onSupprimer={onSupprimer}
            onCreation={setCreation}
            onCreer={onCreer}
          />
        ))}
    </div>
  );
}
