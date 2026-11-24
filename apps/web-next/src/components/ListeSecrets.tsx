"use client";

// La colonne du milieu : les entrées du dossier choisi, ou les résultats de
// recherche.

import { Fragment, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { type LigneArbre, type Ordre, type VaultEntry } from "@/lib/vault";
import { Avatar } from "@/components/Avatar";
import { MenuEntree, type EntreeDeMenu } from "@/components/MenuEntree";
import { MenuTri } from "@/components/MenuTri";
import { Coffre, Etoile, Plus } from "@/components/Icones";
import { LigneDossier, RETRAIT, SaisieDossier } from "@/components/LigneDossier";

/// Ce que la liste reçoit pour montrer les dossiers en arbre. Absent, elle
/// montre une liste plate : résultats de recherche, favoris, archives.
export interface ArbreDeLaListe {
  lignes: LigneArbre[];
  onBasculer: (chemin: string) => void;
  onCreer: (chemin: string) => void;
  onSupprimer: (chemin: string) => void;
  /// Ouvre le formulaire d'un nouvel élément, rangé dans ce dossier.
  onNouvelElement: (chemin: string) => void;
  /// Une précision sous la saisie d'un nouveau dossier (dans un coffre
  /// d'équipe : quand le dossier sera partagé).
  aideCreation?: string;
}

function sousTitre(item: VaultEntry, t: (k: string) => string): string {
  if (item.kind === "note") return t("app.secureNote");
  if (item.kind === "card" && item.cardNumber) return `•••• ${item.cardNumber.slice(-4)}`;
  return item.username;
}

export function ListeSecrets({
  items,
  total,
  recherche,
  titre,
  vide,
  favoris,
  choisi,
  onChoisir,
  selection,
  onBasculerSelection,
  onToutSelectionner,
  ordre,
  onOrdre,
  actions,
  arbre,
}: {
  items: VaultEntry[];
  total: number;
  recherche: string;
  /// Le nom de ce que la barre latérale a choisi : dossier, coffre, favoris…
  titre: string;
  /// La phrase d'une liste vide quand le coffre, lui, ne l'est pas. Chaque vue
  /// a la sienne : « aucun favori » n'est pas « aucun secret dans ce dossier ».
  vide: string;
  favoris: ReadonlySet<string>;
  choisi: VaultEntry | null;
  onChoisir: (item: VaultEntry) => void;
  selection: Set<string>;
  onBasculerSelection: (id: string, jusqua?: VaultEntry[]) => void;
  onToutSelectionner: (ids: string[]) => void;
  ordre: Ordre;
  onOrdre: (o: Ordre) => void;
  /// Les gestes du menu « … » d'une ligne ; liste vide, pas de menu.
  actions: (item: VaultEntry) => EntreeDeMenu[];
  arbre?: ArbreDeLaListe;
}) {
  const { t } = useI18n();
  /// Le dossier sous lequel une saisie de dossier est ouverte ; "" : la racine.
  const [creation, setCreation] = useState<{ parent: string } | null>(null);
  /// Les éléments dans l'ordre où on les voit : celui qu'étend Maj+clic.
  /// En arbre, ceux des dossiers repliés n'en font pas partie.
  const affiches = arbre
    ? arbre.lignes.flatMap((l) => (l.type === "element" ? [l.item] : []))
    : items;
  const tousChoisis = items.length > 0 && items.every((i) => selection.has(i.id));

  // Parcourue aux flèches, la liste doit suivre : un élément choisi hors de
  // vue laisserait la fiche changer sans qu'on voie de quelle ligne elle vient.
  useEffect(() => {
    if (!choisi) return;
    document.querySelector(`[data-entree="${CSS.escape(choisi.id)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [choisi]);

  const ligneElement = (item: VaultEntry, profondeur: number) => {
    const actif = choisi?.id === item.id;
    const sous = sousTitre(item, t);
    const coche = selection.has(item.id);
    return (
      <div
        key={item.id}
        data-entree={item.id}
        // Séparation par surface et par espace, pas par un trait : c'est
        // ce qui distingue une liste d'un tableur.
        className={`group flex items-center gap-3 rounded-lg px-3 py-3 transition-colors ${actif ? "bg-accent/12" : coche ? "bg-surface" : "hover:bg-surface"}`}
      >
        {/* La case est HORS du bouton : imbriquer un contrôle dans un
            bouton le rend inatteignable : le clic déclenche le bouton,
            jamais la case. Elle n'apparaît qu'au survol ou dès qu'une
            sélection existe, pour ne pas alourdir la lecture courante. */}
        <label
          className={`flex w-4 shrink-0 cursor-pointer items-center justify-center transition-opacity ${coche || selection.size > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"}`}
        >
          <input
            type="checkbox"
            checked={coche}
            onChange={(e) =>
              // Maj enfoncée : on étend depuis la dernière case cochée,
              // ce qu'on attend d'une liste dès qu'elle dépasse dix
              // lignes.
              onBasculerSelection(item.id, (e.nativeEvent as MouseEvent).shiftKey ? affiches : undefined)
            }
            aria-label={t("app.selectItem", { name: item.name })}
            className="accent-accent"
          />
        </label>
        <button
          type="button"
          onClick={() => onChoisir(item)}
          aria-current={actif ? "true" : undefined}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
          // Sous un dossier, le contenu se décale ; la case, non : elle reste
          // dans la colonne de « tout sélectionner ».
          style={profondeur > 0 ? { paddingLeft: profondeur * RETRAIT } : undefined}
        >
          {/* La vignette de liste montre le favicon de la première
              adresse : une pastille ne peut en porter qu'une. */}
          <Avatar nom={item.name} url={item.urls[0]} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className={`truncate text-sm ${actif ? "text-accent" : "text-foreground"}`}>{item.name}</span>
              {favoris.has(item.id) && (
                <Etoile plein className="size-3 shrink-0 text-warn" />
              )}
            </span>
            {sous && <span className="truncate text-xs text-muted">{sous}</span>}
          </span>
          {/* D'OÙ VIENT CETTE ENTRÉE.
              La liste mêle le coffre personnel et les collections
              d'équipe : sans cette marque, rien ne distingue un secret
              qu'on possède d'un secret que l'équipe partage, et les
              deux ne se suppriment pas, ne s'exportent pas et ne se
              modifient pas de la même façon.

              `block` et non `inline-flex` : `text-overflow: ellipsis`
              ne s'applique qu'à un conteneur de bloc. Sur `inline-flex`
              les trois propriétés sont là et aucune n'agit, et le nom de
              collection était coupé net, sans points de suite. */}
          {item.shared && (
            <span
              className="ml-2 hidden max-w-[9rem] shrink-0 truncate rounded-pill bg-accent/12 px-2 py-0.5 text-2xs text-accent sm:block"
              title={`${item.shared.orgName} · ${item.shared.collectionName}`}
            >
              {item.shared.collectionName}
            </span>
          )}
        </button>
        <MenuEntree nom={item.name} entrees={actions(item)} />
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-col">
      {/* L'EN-TÊTE, SUR DEUX LIGNES
          Le titre seul en haut, à sa taille. Dessous, une barre d'outils :
          la case « tout sélectionner », le compte, le tri. La case tenait à
          droite du titre avec son libellé, à une autre hauteur que le tri qui
          flottait sous elle, et rien ne s'alignait (capture du 2026-11-24).

          La case est désormais SANS libellé visible et posée dans la colonne
          des cases des lignes : `px-5` ici vaut `px-2` de la liste plus `px-3`
          d'une ligne. Alignée sur elles, elle se lit comme leur en-tête de
          colonne, ce que le libellé « Tout sélectionner » disait en mots ; il
          reste pour les lecteurs d'écran et dans l'infobulle. */}
      <div className="px-5 pb-2 pt-5">
        <h2 className="truncate text-lg font-semibold text-foreground">
          {recherche.trim() ? t("app.results") : titre}
        </h2>
        <div className="mt-1 flex h-7 items-center gap-3">
          {/* La colonne `w-4` des cases des lignes, même vide. */}
          <span className="flex w-4 shrink-0 justify-center">
          {items.length > 0 && (
            <input
              type="checkbox"
              checked={tousChoisis}
              onChange={() => onToutSelectionner(tousChoisis ? [] : items.map((i) => i.id))}
              aria-label={t("app.selectAll")}
              title={t("app.selectAll")}
              className="shrink-0 cursor-pointer accent-accent"
            />
          )}
          </span>
          <p className="flex-1 text-xs text-muted">{t("app.itemCount", { n: items.length })}</p>
          {arbre && (
            <button
              type="button"
              onClick={() => setCreation({ parent: "" })}
              aria-label={t("app.newFolder")}
              title={t("app.newFolder")}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted transition-colors hover:bg-surface hover:text-foreground"
            >
              <Plus className="size-3.5" />
              {t("app.folder")}
            </button>
          )}
          {items.length > 1 && <MenuTri ordre={ordre} onOrdre={onOrdre} />}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {items.length === 0 && !(arbre && (arbre.lignes.length > 0 || creation)) ? (
          <div className="grid place-items-center gap-3 px-6 py-16 text-center text-sm text-muted">
            <Coffre className="size-7 opacity-30" />
            <p>
              {/* Trois vides différents, trois phrases : « aucun résultat » sur un
                  coffre vide enverrait chercher un défaut de recherche. */}
              {total === 0 ? (
                <>
                  {t("app.emptyVault")}
                  <br />
                  {t("app.emptyVaultSub")}
                </>
              ) : recherche.trim() ? (
                t("app.noResult")
              ) : (
                vide
              )}
            </p>
          </div>
        ) : (
          <>
            {creation?.parent === "" && arbre && (
              <SaisieDossier
                parent=""
                profondeur={0}
                aide={arbre.aideCreation}
                onCreer={arbre.onCreer}
                onFermer={() => setCreation(null)}
              />
            )}
            {arbre
              ? arbre.lignes.map((l) =>
                  l.type === "element" ? (
                    ligneElement(l.item, l.profondeur)
                  ) : (
                    <Fragment key={`d:${l.chemin}`}>
                      <LigneDossier
                        nom={l.nom}
                        chemin={l.chemin}
                        profondeur={l.profondeur}
                        total={l.total}
                        deplie={l.deplie}
                        onBasculer={() => arbre.onBasculer(l.chemin)}
                        onNouvelElement={() => arbre.onNouvelElement(l.chemin)}
                        onNouveauSousDossier={() => {
                          // Le parent se déplie : la saisie apparaît sous lui,
                          // et un dossier replié la cacherait.
                          if (!l.deplie) arbre.onBasculer(l.chemin);
                          setCreation({ parent: l.chemin });
                        }}
                        onSupprimer={() => arbre.onSupprimer(l.chemin)}
                      />
                      {creation?.parent === l.chemin && (
                        <SaisieDossier
                          parent={l.chemin}
                          profondeur={l.profondeur + 1}
                          aide={arbre.aideCreation}
                          onCreer={arbre.onCreer}
                          onFermer={() => setCreation(null)}
                        />
                      )}
                    </Fragment>
                  ),
                )
              : items.map((item) => ligneElement(item, 0))}
          </>
        )}
      </div>
    </div>
  );
}
