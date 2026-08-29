"use client";

// L'écran du coffre : arbre des dossiers, liste, détail.
//
// Le déchiffrement a lieu ici et nulle part ailleurs. Le serveur ne renvoie que
// des enveloppes ; ce composant les ouvre avec le compte en mémoire, et rien de
// ce qu'il produit ne repart ni ne se persiste.

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { decryptVaultItem, encryptFolders, encryptItem } from "@/lib/crypto";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import {
  buildTree,
  filtrerVisibles,
  folderPaths,
  type VaultEntry,
} from "@/lib/vault";
import { ArbreDossiers } from "@/components/ArbreDossiers";
import { ListeSecrets } from "@/components/ListeSecrets";
import { DetailSecret } from "@/components/DetailSecret";
import { depuisEntree, FormulaireEntree, vide, type SaisieEntree } from "@/components/FormulaireEntree";
import { Bouton } from "@/components/champs";
import { Cadenas, Coffre, Corbeille as IconeCorbeille, Plus } from "@/components/Icones";
import { Corbeille } from "@/components/Corbeille";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export function VaultScreen() {
  const { t } = useI18n();
  const { token, account, fermer } = useSession();

  const [items, setItems] = useState<VaultEntry[]>([]);
  const [dossiersVides, setDossiersVides] = useState<string[]>([]);
  const [registreId, setRegistreId] = useState<string | null>(null);
  const [choisi, setChoisi] = useState<VaultEntry | null>(null);
  const [dossier, setDossier] = useState<string | null>(null);
  const [recherche, setRecherche] = useState("");
  const [replies, setReplies] = useState<Set<string>>(new Set());
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [chargement, setChargement] = useState(true);
  // `null` = pas de formulaire ouvert ; sinon l'identifiant en cours de
  // modification, ou la chaîne vide pour une création.
  const [edition, setEdition] = useState<string | null>(null);
  // Les sections portées à ce jour. Les organisations et la sécurité
  // arrivent ensuite : tant qu'elles ne sont pas là, elles ne figurent pas
  // dans le rail — un onglet qui mène à « bientôt » est pire que son absence.
  const [section, setSection] = useState<"coffre" | "corbeille">("coffre");

  const charger = useCallback(async (): Promise<VaultEntry[]> => {
    if (!token || !account) return [];
    setChargement(true);
    try {
      const { items: dtos } = await api.listItems(token);
      const entrees: VaultEntry[] = [];
      let regId: string | null = null;
      let regChemins: string[] = [];
      for (const d of dtos) {
        const r = decryptVaultItem(account, d.encryptedKey, d.encryptedData);
        if (r.kind === "folders") {
          regId = d.id;
          regChemins = r.paths;
        } else {
          entrees.push({ ...r.item, id: d.id, updatedAt: d.updatedAt });
        }
      }
      setItems(entrees);
      setRegistreId(regId);
      setDossiersVides(regChemins);
      setErreur(null);
      return entrees;
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
      return [];
    } finally {
      setChargement(false);
    }
  }, [token, account]);

  useEffect(() => {
    void charger().then(() => setChoisi(null));
  }, [charger]);

  const tree = useMemo(() => buildTree(items, dossiersVides), [items, dossiersVides]);
  const visibles = useMemo(
    () => filtrerVisibles(items, recherche, dossier),
    [items, recherche, dossier],
  );
  const chemins = useMemo(() => folderPaths(items, dossiersVides), [items, dossiersVides]);

  const enregistrerDossiers = useCallback(
    async (chemins: string[]) => {
      if (!token || !account) return;
      const enc = encryptFolders(account, chemins);
      if (registreId) await api.updateItem(token, registreId, enc);
      else setRegistreId((await api.createItem(token, enc)).id);
    },
    [token, account, registreId],
  );

  const creerDossier = async (path: string) => {
    if (dossiersVides.includes(path)) return;
    const suivant = [...dossiersVides, path].sort((a, b) => a.localeCompare(b));
    setDossiersVides(suivant);
    try {
      await enregistrerDossiers(suivant);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  const supprimerDossier = async (path: string) => {
    const suivant = dossiersVides.filter((p) => p !== path && !p.startsWith(`${path}/`));
    setDossiersVides(suivant);
    if (dossier === path) setDossier(null);
    try {
      await enregistrerDossiers(suivant);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  const enregistrer = async (v: SaisieEntree) => {
    if (!token || !account) return;
    setOccupe(true);
    try {
      // Un mot de passe remplacé n'est pas perdu : on en garde vingt versions.
      // Sans cela, une modification faite par erreur est définitive, et c'est
      // exactement le moment où l'on voudrait revenir en arrière.
      const enCours = edition ? items.find((i) => i.id === edition) : undefined;
      let passwordHistory = enCours?.passwordHistory ?? [];
      if (enCours?.password && v.password !== enCours.password) {
        passwordHistory = [enCours.password, ...passwordHistory].slice(0, 20);
      }
      const enc = encryptItem(account, { ...v, passwordHistory });
      const id = edition
        ? (await api.updateItem(token, edition, enc), edition)
        : (await api.createItem(token, enc)).id;
      setEdition(null);
      // On rouvre l'entrée enregistrée : refermer sur une liste sans rien de
      // sélectionné donnerait l'impression que le geste n'a pas abouti.
      const frais = await charger();
      setChoisi(frais.find((i) => i.id === id) ?? null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  const supprimerEntree = async () => {
    if (!token || !choisi) return;
    setOccupe(true);
    try {
      await api.deleteItem(token, choisi.id);
      setChoisi(null);
      await charger();
      setEdition(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  const basculer = (path: string) => {
    setReplies((prec) => {
      const s = new Set(prec);
      if (s.has(path)) s.delete(path);
      else s.add(path);
      return s;
    });
  };

  return (
    <div className="flex h-dvh flex-col text-foreground">
      <header className="verre flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <span className="flex items-center gap-2 font-semibold">
          <Coffre className="size-5 text-accent" />
          GhostPass
        </span>
        {section === "coffre" && (
        <input
          type="search"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder={t("app.searchVault")}
          aria-label={t("app.searchVault")}
          className="ml-auto w-full max-w-md rounded-pill border border-border bg-surface-2 px-4 py-2.5 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
        )}
        {section === "coffre" && (
        <Bouton
          onClick={() => {
            // Le dossier ouvert pré-remplit le champ : on ajoute presque
            // toujours là où l'on est en train de regarder.
            setChoisi(null);
            setEdition("");
          }}
        >
          <span className="flex items-center gap-1.5">
            <Plus className="size-4" />
            <span className="min-w-[13ch] text-center">{t("app.newItem")}</span>
          </span>
        </Bouton>
        )}
        <div className={section === "coffre" ? "" : "ml-auto"} />
        <LanguageSwitcher />
        <Bouton variante="discret" onClick={fermer}>
          <span className="flex items-center gap-1.5">
            <Cadenas className="size-4" />
            {t("app.lock")}
          </span>
        </Bouton>
      </header>

      {erreur && (
        <p role="alert" className="shrink-0 border-b border-border bg-danger-soft px-4 py-2 text-sm text-danger">
          {erreur}
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[15rem_20rem_1fr]">
        <nav className="verre-dense hidden min-h-0 flex-col overflow-y-auto border-r border-border p-3 md:flex">
          <div className="mb-4 flex flex-col gap-0.5">
            {([
              ["coffre", "app.myVault", Coffre],
              ["corbeille", "app.trash", IconeCorbeille],
            ] as const).map(([cle, libelle, Icone]) => (
              <button
                key={cle}
                type="button"
                onClick={() => setSection(cle)}
                aria-current={section === cle ? "page" : undefined}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors ${section === cle ? "bg-accent/12 font-medium text-accent" : "text-muted hover:bg-surface hover:text-foreground"}`}
              >
                <Icone className="size-4 shrink-0" />
                {t(libelle)}
              </button>
            ))}
          </div>

          {section === "coffre" && (
          <ArbreDossiers
            tree={tree}
            total={items.length}
            choisi={dossier}
            recherche={recherche}
            replies={replies}
            chemins={chemins}
            onChoisir={setDossier}
            onBasculer={basculer}
            onCreer={creerDossier}
            onSupprimer={supprimerDossier}
          />
          )}
          {/* Le pied de la colonne dit l'état du coffre. C'est la seule chose
              qui rappelle, à tout moment, que les clés sont en mémoire. */}
          <div className="mt-auto pt-4">
            <span className="flex items-center gap-2 rounded-pill bg-success/10 px-3 py-2 text-xs text-success">
              <span className="size-1.5 rounded-pill bg-success" />
              {t("app.unlocked")}
            </span>
          </div>
        </nav>

        <div className={`verre-dense min-h-0 border-r border-border ${section === "corbeille" ? "col-span-2" : ""}`}>
          {section === "corbeille" ? (
            <Corbeille onRestaure={() => void charger().then(() => setChoisi(null))} />
          ) : chargement ? (
            <p className="p-4 text-sm text-muted">{t("app.loadingCrypto")}</p>
          ) : (
            <ListeSecrets
              items={visibles}
              total={items.length}
              recherche={recherche}
              dossier={dossier}
              choisi={choisi}
              onChoisir={setChoisi}
            />
          )}
        </div>

        <div className={`min-h-0 overflow-y-auto ${section === "corbeille" ? "hidden" : ""}`}>
          {edition !== null ? (
            <FormulaireEntree
              // La clé force un formulaire neuf quand on passe d'une entrée à
              // une autre : sans elle, React réutilise l'état et l'on édite la
              // seconde avec les valeurs de la première.
              key={edition || "creation"}
              initial={
                edition
                  ? (() => {
                      const e = items.find((i) => i.id === edition);
                      return e ? depuisEntree(e) : undefined;
                    })()
                  : dossier
                    ? { ...vide(), folder: dossier }
                    : undefined
              }
              edition={edition !== ""}
              occupe={occupe}
              chemins={chemins}
              onValider={enregistrer}
              onAnnuler={() => setEdition(null)}
            />
          ) : choisi ? (
            <DetailSecret
              item={choisi}
              onModifier={() => setEdition(choisi.id)}
              onSupprimer={supprimerEntree}
              occupe={occupe}
            />
          ) : (
            <div className="grid h-full place-items-center px-6 text-center">
              <div className="flex flex-col items-center gap-3">
                <Coffre className="size-7 text-muted opacity-30" />
                <p className="max-w-xs text-sm text-muted">{t("app.pickOrCreate")}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
