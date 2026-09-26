"use client";

// La colonne de gauche : les dossiers du coffre.
//
// Un dossier n'est pas un objet stocké côté serveur — c'est un chemin « A/B/C »
// porté par chaque entrée, donc déduit. Les dossiers *vides* n'ont aucune
// entrée d'où être déduits : ils vivent dans un registre chiffré à part, sans
// quoi créer un dossier avant d'y ranger quoi que ce soit serait un geste sans
// effet visible.

import { useI18n } from "@/lib/i18n";
import { countItems, type TreeNode } from "@/lib/vault";
import { Chevron, Coffre, Dossier } from "@/components/Icones";

function Noeud({
  node,
  profondeur,
  choisi,
  deplie,
  onChoisir,
  onBasculer,
  onSupprimer,
}: {
  node: TreeNode;
  profondeur: number;
  choisi: string | null;
  deplie: (path: string) => boolean;
  onChoisir: (path: string) => void;
  onBasculer: (path: string) => void;
  onSupprimer: (path: string) => void;
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
        {n === 0 && (
          <button
            type="button"
            onClick={() => onSupprimer(node.path)}
            title={t("app.deleteFolder")}
            aria-label={t("app.deleteEmptyFolder")}
            className="cursor-pointer rounded px-1 text-muted opacity-0 transition group-hover:opacity-100 hover:text-accent focus-visible:opacity-100"
          >
            ×
          </button>
        )}
      </div>
      {ouvert &&
        node.children.map((c) => (
          <Noeud
            key={c.path}
            node={c}
            profondeur={profondeur + 1}
            choisi={choisi}
            deplie={deplie}
            onChoisir={onChoisir}
            onBasculer={onBasculer}
            onSupprimer={onSupprimer}
          />
        ))}
    </>
  );
}

export function ArbreDossiers({
  tree,
  total,
  choisi,
  recherche,
  replies,
  chemins,
  onChoisir,
  onBasculer,
  onCreer,
  onSupprimer,
}: {
  tree: TreeNode;
  total: number;
  choisi: string | null;
  recherche: string;
  replies: Set<string>;
  chemins: string[];
  onChoisir: (path: string | null) => void;
  onBasculer: (path: string) => void;
  onCreer: (path: string) => void;
  onSupprimer: (path: string) => void;
}) {
  const { t } = useI18n();
  // Une recherche déplie tout : un résultat caché dans un dossier replié est
  // un résultat que l'on croit absent.
  const deplie = (path: string) => recherche.trim() !== "" || !replies.has(path);

  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => onChoisir(null)}
        className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors ${choisi === null ? "bg-accent/12 font-medium text-accent" : "text-muted hover:bg-surface hover:text-foreground"}`}
      >
        <Coffre className="size-4 shrink-0" />
        <span className="flex-1 text-left">{t("app.allItems")}</span>
        <span className="text-2xs tabular-nums">{total}</span>
      </button>

      <div className="mt-5 mb-1 flex items-center justify-between px-3">
        <span className="text-2xs uppercase tracking-widest text-muted">{t("app.folders")}</span>
        <NouveauDossier chemins={chemins} onCreer={onCreer} />
      </div>

      {tree.children.map((f) => (
        <Noeud
          key={f.path}
          node={f}
          profondeur={0}
          choisi={choisi}
          deplie={deplie}
          onChoisir={onChoisir}
          onBasculer={onBasculer}
          onSupprimer={onSupprimer}
        />
      ))}
    </div>
  );
}

function NouveauDossier({ chemins, onCreer }: { chemins: string[]; onCreer: (p: string) => void }) {
  const { t } = useI18n();
  return (
    <details className="relative">
      <summary
        className="cursor-pointer list-none rounded p-0.5 text-muted hover:text-foreground"
        title={t("app.newFolder")}
        aria-label={t("app.newFolder")}
      >
        <Dossier className="size-4" />
      </summary>
      <form
        aria-label={t("app.newFolder")}
        // `verre-opaque` et non `bg-surface` : ce panneau se déroule SUR les noms
        // de dossiers, et `--color-surface` est translucide par conception (blanc
        // à 3 %). Il laissait donc lire l'arborescence à travers lui en thème
        // sombre — vu en capture, pas déduit du CSS.
        className="verre-opaque absolute right-0 z-10 mt-1 flex w-56 gap-1 rounded border border-border p-2 shadow-lg"
        onSubmit={(e) => {
          e.preventDefault();
          const champ = e.currentTarget.elements.namedItem("dossier") as HTMLInputElement;
          const v = champ.value.trim().replace(/^\/+|\/+$/g, "");
          if (v) onCreer(v);
          champ.value = "";
          (e.currentTarget.closest("details") as HTMLDetailsElement).open = false;
        }}
      >
        <input
          name="dossier"
          list="gp-dossiers"
          placeholder={t("app.folderPh")}
          className="min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 py-1 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <datalist id="gp-dossiers">
          {chemins.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <button type="submit" className="cursor-pointer rounded border border-border px-2 text-xs text-foreground hover:border-border-strong">
          {t("app.create")}
        </button>
      </form>
    </details>
  );
}
