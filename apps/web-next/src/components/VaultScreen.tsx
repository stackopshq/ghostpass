"use client";

// L'écran du coffre : arbre des dossiers, liste, détail.
//
// Le déchiffrement a lieu ici et nulle part ailleurs. Le serveur ne renvoie que
// des enveloppes ; ce composant les ouvre avec le compte en mémoire, et rien de
// ce qu'il produit ne repart ni ne se persiste.

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { sealSend } from "@/lib/send";
import {
  decryptOrgItem,
  openOrg,
  decryptVaultItem,
  encryptFolders,
  encryptItem,
  encryptOrgColors,
  encryptShares,
  type PartageEnCours,
} from "@/lib/crypto";
import { definirCouleur, effacerCouleur, type RegistreCouleurs } from "@/lib/couleursOrg";
import { useI18n } from "@/lib/i18n";
import { approuverLHote, examinerLienDePartage, hotesApprouves } from "@/lib/lienDePartage";
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
import { Bouclier, Cadenas, Coffre, Corbeille as IconeCorbeille, Croix, Organisation, Partage, Plus } from "@/components/Icones";
import { Corbeille } from "@/components/Corbeille";
import { Securite } from "@/components/Securite";
import { Partages } from "@/components/Partages";
import { ImportExport } from "@/components/ImportExport";
import { ListeOrgs } from "@/components/orgs/ListeOrgs";
import { DetailOrg } from "@/components/orgs/DetailOrg";
import type { OrgSummary } from "@/lib/orgs";
import { Reglages } from "@/components/Reglages";

export function VaultScreen() {
  const { t } = useI18n();
  const { token, account, fermer } = useSession();

  const [items, setItems] = useState<VaultEntry[]>([]);
  const [dossiersVides, setDossiersVides] = useState<string[]>([]);
  const [registreId, setRegistreId] = useState<string | null>(null);
  // Le registre des partages : les jetons de révocation rendus par ghostbit.
  // Chiffré comme le reste, jamais confié au serveur.
  const [registrePartagesId, setRegistrePartagesId] = useState<string | null>(null);
  const [partages, setPartages] = useState<PartageEnCours[]>([]);
  // Le registre des couleurs d'organisation : un objet plat `{ orgId: "#RRGGBB" }`,
  // partagé avec iOS. Il ne porte aucun secret, mais il vit dans le coffre
  // parce que c'est le seul endroit que les deux clients lisent.
  const [registreCouleursId, setRegistreCouleursId] = useState<string | null>(null);
  const [couleursOrg, setCouleursOrg] = useState<RegistreCouleurs>({});
  const [choisi, setChoisi] = useState<VaultEntry | null>(null);
  const [dossier, setDossier] = useState<string | null>(null);
  const [recherche, setRecherche] = useState("");
  const [replies, setReplies] = useState<Set<string>>(new Set());
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  // `null` = pas de formulaire ouvert ; sinon l'identifiant en cours de
  // modification, ou la chaîne vide pour une création.
  const [edition, setEdition] = useState<string | null>(null);
  // Les sections portées à ce jour. Les organisations et la sécurité
  // arrivent ensuite : tant qu'elles ne sont pas là, elles ne figurent pas
  // dans le rail — un onglet qui mène à « bientôt » est pire que son absence.
  const [section, setSection] = useState<"coffre" | "orgs" | "partages" | "securite" | "corbeille">("coffre");
  // L'organisation ouverte. Nulle = la liste. La clé d'org vit dans le
  // composant de détail, pas ici : quitter l'écran doit la laisser partir.
  const [orgOuverte, setOrgOuverte] = useState<OrgSummary | null>(null);
  // La sélection multiple. `ancre` retient la dernière case cochée, pour que
  // Maj-clic étende une plage — sans elle, la touche n'a rien d'où partir.
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [ancre, setAncre] = useState<string | null>(null);

  /// Les éléments des collections d'équipe, pour qu'ils rejoignent la liste
  /// principale.
  ///
  /// POURQUOI ILS Y ENTRENT
  /// Un compte dont tout le contenu vit dans une équipe affichait « 0 mot de
  /// passe » et une recherche sans résultat. Le coffre n'était pas vide : on
  /// n'en regardait qu'une moitié. C'était le cas de Clara ce soir, et c'est le
  /// portage qui l'avait perdu — le Svelte le faisait, le Next ne le faisait
  /// plus.
  ///
  /// POURQUOI ILS ÉCHOUENT EN SILENCE
  /// Une organisation dont la clé n'a pas été remise, une collection devenue
  /// inaccessible : on passe. L'alternative afficherait une erreur de coffre à
  /// quelqu'un dont le coffre va très bien — et le coffre personnel, lui, est
  /// déjà chargé. Le silence porte sur un supplément, jamais sur le tout.
  const chargerElementsDEquipe = useCallback(async (): Promise<VaultEntry[]> => {
    if (!token || !account) return [];
    const sortis: VaultEntry[] = [];
    let orgs: Awaited<ReturnType<typeof api.listOrgs>>["organizations"] = [];
    try {
      orgs = (await api.listOrgs(token)).organizations;
    } catch {
      return [];
    }
    for (const org of orgs) {
      if (org.status !== "active") continue;
      try {
        const m = await api.getMembership(token, org.orgId);
        if (!m.encryptedOrgKey || !m.sealedByPublicKey) continue;
        const handle = openOrg(account, m.sealedByPublicKey, m.encryptedOrgKey);
        const { collections } = await api.listCollections(token, org.orgId);
        for (const col of collections) {
          try {
            const { items: dtos } = await api.listCollectionItems(token, org.orgId, col.id);
            for (const d of dtos) {
              sortis.push({
                ...decryptOrgItem(handle, d.encryptedKey, d.encryptedData),
                id: d.id,
                updatedAt: d.updatedAt,
                shared: {
                  orgId: org.orgId,
                  orgName: org.name,
                  collectionId: col.id,
                  collectionName: col.name,
                  permission: col.permission,
                },
              });
            }
          } catch {
            // Collection inaccessible : les autres restent lisibles.
          }
        }
      } catch {
        // Organisation illisible : les autres restent lisibles.
      }
    }
    return sortis;
  }, [token, account]);

  const charger = useCallback(async (): Promise<VaultEntry[]> => {
    if (!token || !account) return [];
    setChargement(true);
    try {
      const { items: dtos } = await api.listItems(token);
      const entrees: VaultEntry[] = [];
      let regId: string | null = null;
      let regChemins: string[] = [];
      let regPartagesId: string | null = null;
      let regPartages: PartageEnCours[] = [];
      let regCouleursId: string | null = null;
      let regCouleurs: RegistreCouleurs = {};
      for (const d of dtos) {
        const r = decryptVaultItem(account, d.encryptedKey, d.encryptedData);
        if (r.kind === "folders") {
          regId = d.id;
          regChemins = r.paths;
        } else if (r.kind === "shares") {
          regPartagesId = d.id;
          regPartages = r.shares;
        } else if (r.kind === "orgcolors") {
          regCouleursId = d.id;
          regCouleurs = r.couleurs;
        } else {
          entrees.push({ ...r.item, id: d.id, updatedAt: d.updatedAt });
        }
      }
      // Le coffre personnel d'abord, l'équipe ensuite : si les collections sont
      // lentes ou inaccessibles, la liste reste utilisable.
      setItems(entrees);
      const equipe = await chargerElementsDEquipe();
      if (equipe.length > 0) setItems([...entrees, ...equipe]);
      setRegistreId(regId);
      setDossiersVides(regChemins);
      setRegistrePartagesId(regPartagesId);
      setPartages(regPartages);
      setRegistreCouleursId(regCouleursId);
      setCouleursOrg(regCouleurs);
      setErreur(null);
      return entrees;
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
      return [];
    } finally {
      setChargement(false);
    }
  }, [token, account, chargerElementsDEquipe]);

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

  /// Choisir — ou reprendre — la couleur d'une organisation.
  ///
  /// L'écran est peint AVANT l'aller-retour réseau : la teinte est un repère,
  /// pas une donnée, et la faire attendre le serveur donnerait l'impression
  /// que le clic n'a pas porté. Un échec repeint l'ancienne valeur et le dit.
  const changerCouleurOrg = useCallback(
    async (orgId: string, couleur: string | null) => {
      if (!token || !account) return;
      const precedent = couleursOrg;
      const suivant =
        couleur === null ? effacerCouleur(precedent, orgId) : definirCouleur(precedent, orgId, couleur);
      setCouleursOrg(suivant);
      try {
        const enc = encryptOrgColors(account, suivant);
        if (registreCouleursId) await api.updateItem(token, registreCouleursId, enc);
        else setRegistreCouleursId((await api.createItem(token, enc)).id);
      } catch (e) {
        setCouleursOrg(precedent);
        setErreur(e instanceof Error ? e.message : String(e));
      }
    },
    [token, account, couleursOrg, registreCouleursId],
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

  /// Enregistre le registre des partages, comme celui des dossiers.
  const enregistrerPartages = async (liste: PartageEnCours[]) => {
    if (!token || !account) return;
    const enc = encryptShares(account, liste);
    if (registrePartagesId) await api.updateItem(token, registrePartagesId, enc);
    else setRegistrePartagesId((await api.createItem(token, enc)).id);
  };

  /// Partager l'entrée affichée.
  ///
  /// Le chiffrement a lieu ici, avec une clé jetable ; le serveur relaie vers
  /// ghostbit et ne voit que du chiffré. Le jeton de révocation revient au
  /// client et va DANS LE COFFRE — le confier au serveur lui donnerait un
  /// pouvoir sur des partages qu'il ne peut pas lire.
  const partager = async (item: VaultEntry) => {
    if (!token) return;
    const secret =
      item.kind === "note" ? item.note : item.kind === "card" ? item.cardNumber : item.password;
    if (!secret) return;
    setOccupe(true);
    try {
      const scelle = await sealSend(secret);
      const cree = await api.createSend(token, {
        ciphertext: scelle.ciphertext,
        iv: scelle.iv,
        expiresInHours: 24,
        maxViews: 1,
      });
      // L'URL vient du serveur, le fragment est ajouté ici : la clé ne doit
      // jamais traverser le réseau, donc le serveur ne peut pas composer le
      // lien complet lui-même.
      //
      // Mais elle ne s'y ajoute pas les yeux fermés. Le fragment ne part pas
      // sur le réseau — et la PAGE servie par ce domaine, elle, lit
      // `location.hash`. Un serveur compromis qui rendrait l'adresse d'un
      // relais hostile obtiendrait donc la clé, alors qu'il détient déjà le
      // chiffré. Voir `lib/lienDePartage.ts` pour le raisonnement complet.
      const verdict = examinerLienDePartage(
        cree.url,
        scelle.keyFragment,
        location.origin,
        hotesApprouves(),
      );

      if (verdict.statut === "refuse") {
        // Le partage existe déjà côté serveur : le révoquer est ce qui évite de
        // laisser derrière soi un secret déposé que plus personne ne peut
        // effacer.
        await api.revokeSend(token, cree.id, cree.deleteToken).catch(() => undefined);
        setErreur(t(`app.shareRefused.${verdict.raison}`));
        return;
      }

      if (verdict.statut === "demander") {
        // `confirm` natif, et non une fenêtre de l'application : une décision de
        // sécurité rendue dans le cadre du navigateur ne peut pas être imitée
        // par du code de la page.
        if (!confirm(t("app.confirmShareHost", { host: verdict.hote }))) {
          await api.revokeSend(token, cree.id, cree.deleteToken).catch(() => undefined);
          setErreur(t("app.shareCancelled"));
          return;
        }
        approuverLHote(verdict.hote);
      }

      const lien = verdict.lien;
      const suivant = [
        {
          id: cree.id,
          url: lien,
          deleteToken: cree.deleteToken,
          name: item.name,
          createdAt: Math.floor(Date.now() / 1000),
          expiresAt: cree.expiresAt,
        },
        ...partages,
      ];
      setPartages(suivant);
      await enregistrerPartages(suivant);
      await navigator.clipboard.writeText(lien).catch(() => undefined);
      setErreur(null);
      setMessage(t("app.shareCreated"));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  const revoquerPartage = async (p: PartageEnCours) => {
    if (!token) return;
    setOccupe(true);
    try {
      await api.revokeSend(token, p.id, p.deleteToken);
      const suivant = partages.filter((x) => x.id !== p.id);
      setPartages(suivant);
      await enregistrerPartages(suivant);
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

  const basculerSelection = (id: string, plage?: VaultEntry[]) => {
    setSelection((prec) => {
      const s = new Set(prec);
      if (plage && ancre && ancre !== id) {
        const i = plage.findIndex((x) => x.id === ancre);
        const j = plage.findIndex((x) => x.id === id);
        if (i >= 0 && j >= 0) {
          // On ajoute la plage sans jamais rien retirer : une extension qui
          // décoche au passage surprend, et on ne s'en aperçoit qu'après avoir
          // supprimé.
          for (const it of plage.slice(Math.min(i, j), Math.max(i, j) + 1)) s.add(it.id);
          return s;
        }
      }
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
    setAncre(id);
  };

  /// Supprimer la sélection.
  ///
  /// Il n'existe pas de route de suppression en lot : on enchaîne les appels et
  /// on COMPTE. Annoncer « supprimés » alors que l'un a échoué serait pire que
  /// l'échec lui-même, puisque personne n'irait vérifier.
  const supprimerSelection = async () => {
    if (!token || selection.size === 0) return;
    if (!confirm(t("app.confirmDeleteMany", { n: selection.size }))) return;
    setOccupe(true);
    let ok = 0;
    let ko = 0;
    try {
      for (const id of selection) {
        try {
          await api.deleteItem(token, id);
          ok++;
        } catch {
          ko++;
        }
      }
      setSelection(new Set());
      setAncre(null);
      setChoisi(null);
      await charger();
      setErreur(ko > 0 ? t("app.deletedSome", { ok, ko }) : null);
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

      {erreur && (
        <p role="alert" className="shrink-0 border-b border-border bg-danger/10 px-4 py-2 text-sm text-danger">
          {erreur}
        </p>
      )}
      {message && (
        <p className="shrink-0 border-b border-border bg-success/10 px-4 py-2 text-sm text-success">
          {message}
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[16rem_21rem_1fr]">
        <nav className="verre-dense hidden min-h-0 flex-col overflow-y-auto border-r border-border p-3 md:flex">
          {/* Tout vit dans le rail — marque, action principale, recherche,
              navigation, identité — comme chez ghostcal. Une barre horizontale
              en plus coupait l'écran en deux et éloignait l'action principale
              de la navigation qu'elle sert. */}
          {/* `text-foreground` explicite : hérité, le mot-marque sortait en
              `rgb(11,15,25)` — la couleur du FOND. Noir sur noir, invisible, et
              la capture d'écran ne montrait qu'une icône. Une couleur qui porte
              du sens se déclare, elle ne s'hérite pas. */}
          {/* Aligné au pixel près sur ghostcal, `dashboard/layout.tsx:107-116` :
              `text-lg tracking-tight`, logo de 28 px, `gap-2`, `mb-6`.
              GhostPass en avait TROIS de moins — 16 px, interlettrage normal,
              logo de 24 px — et c'est leur cumul qui se voyait : plus petit ET
              plus espacé d'un côté, plus grand ET plus resserré de l'autre.
              Aucun des trois n'aurait sauté aux yeux seul.

              Ces valeurs devront cesser d'être recopiées : le mot-marque est
              exactement ce qu'un gabarit partagé doit porter (ghostsuite #176),
              sans quoi la question se reposera au produit suivant. */}
          <span className="mb-6 flex items-center gap-2 px-2 pt-1 text-lg font-semibold tracking-tight text-foreground">
            {/* Le logo de la charte, servi tel quel — même traitement que
                ghostcal. C'est une IMAGE et non un SVG recopié dans le
                balisage : le fichier est une sortie de `tools/brand/`, et le
                dupliquer ici rouvrirait la dérive de teintes qu'on a refermée. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" width={28} height={28} className="h-7 w-7" />
            GhostPass
          </span>

          {section === "coffre" && (
            <>
              <Bouton
                className="mb-4 w-full"
                onClick={() => {
                  // Le dossier ouvert pré-remplit le champ : on ajoute presque
                  // toujours là où l'on est en train de regarder.
                  setChoisi(null);
                  setEdition("");
                }}
              >
                <span className="flex items-center justify-center gap-2">
                  <Plus className="size-4" />
                  {t("app.newItem")}
                </span>
              </Bouton>
              <input
                type="search"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder={t("app.searchVault")}
                aria-label={t("app.searchVault")}
                className="mb-6 w-full rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
              />
            </>
          )}

          {/* Les espacements du rail sont ceux de ghostcal, mesurés dans
              `dashboard/layout.tsx` : 16 px sous le bouton principal, 24 px
              avant la navigation, 4 px entre ses éléments. GhostPass en avait
              12, 16 et 2 — chaque écart est petit, leur somme donne un rail
              serré là où l'autre respire.

              `gap-1` plutôt que `gap-0.5` : à 2 px, deux lignes de navigation
              se touchent presque et la liste se lit comme un bloc. */}
          <div className="mb-6 flex flex-col gap-1">
            {([
              ["coffre", "app.myVault", Coffre],
              ["orgs", "app.orgs", Organisation],
              ["partages", "app.shares", Partage],
              ["securite", "app.security", Bouclier],
              ["corbeille", "app.trash", IconeCorbeille],
            ] as const).map(([cle, libelle, Icone]) => (
              <button
                key={cle}
                type="button"
                onClick={() => {
                  setSection(cle);
                  if (cle !== "orgs") setOrgOuverte(null);
                }}
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
            onChoisir={(p) => {
            setDossier(p);
            setSelection(new Set());
          }}
            onBasculer={basculer}
            onCreer={creerDossier}
            onSupprimer={supprimerDossier}
          />
          )}
          {section === "coffre" && (
            <ImportExport
              // `items` porte AUSSI les éléments d'équipe, ajoutés juste après
              // le coffre personnel par `charger()`. Les passer tels quels
              // faisait exactement ce que `lib/export.ts` dit empêcher : un
              // membre déposait les secrets de toute son organisation en clair
              // dans un fichier, sur sa machine, sans que l'équipe l'apprenne.
              // Le nom du paramètre disait « personnels » et la valeur ne
              // l'était pas ; le filtre est ici, au seul endroit qui connaît
              // les deux listes.
              personnels={items.filter((i) => !i.shared)}
              onImporte={() => void charger().then(() => setChoisi(null))}
            />
          )}
          {/* Le pied de la colonne dit l'état du coffre. C'est la seule chose
              qui rappelle, à tout moment, que les clés sont en mémoire. */}
          <div className="mt-auto space-y-2 border-t border-border pt-4">
            <span className="flex items-center gap-2 rounded-pill bg-success/10 px-3 py-2 text-xs text-success">
              <span className="size-1.5 rounded-pill bg-success" />
              {t("app.unlocked")}
            </span>
            <Bouton variante="discret" className="w-full" onClick={fermer}>
              <span className="flex items-center justify-center gap-1.5">
                <Cadenas className="size-4" />
                {t("app.lock")}
              </span>
            </Bouton>
          </div>
        </nav>

        {/* `overflow-hidden` et non seulement `min-h-0` : sans lui, une section
            plus haute que l'écran déborde cette colonne, déborde la grille, et
            c'est la PAGE qui se met à défiler — emportant le rail de gauche,
            qui devrait rester fixe. Signalé par Clara sur l'écran de sécurité,
            dont l'historique de connexions dépasse vite la hauteur d'écran.

            `flex flex-col` donne aux sections un contexte où `flex-1` a un
            sens : `min-h-0 overflow-y-auto` sur un bloc sans hauteur définie ne
            déclenche jamais de défilement, il grandit. */}
        <div
          className={`verre-dense flex min-h-0 flex-col overflow-hidden border-r border-border ${section !== "coffre" ? "col-span-2" : ""}`}
        >
          {section === "partages" ? (
            <Partages partages={partages} occupe={occupe} onRevoquer={revoquerPartage} />
          ) : section === "securite" ? (
            <Securite />
          ) : section === "orgs" ? (
            orgOuverte ? (
              <DetailOrg org={orgOuverte} onRetour={() => setOrgOuverte(null)} />
            ) : (
              <ListeOrgs
                onOuvrir={setOrgOuverte}
                couleurs={couleursOrg}
                onCouleur={changerCouleurOrg}
              />
            )
          ) : section === "corbeille" ? (
            <Corbeille onRestaure={() => void charger().then(() => setChoisi(null))} />
          ) : chargement ? (
            <p className="p-4 text-sm text-muted">{t("app.loadingCrypto")}</p>
          ) : (
            <div className="flex min-h-0 flex-col">
              {selection.size > 0 && (
                // Une barre qui n'existe que pendant la sélection : un rang
                // permanent porterait des boutons inertes la plupart du temps.
                <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
                  <span className="text-xs text-muted">{t("app.selected", { n: selection.size })}</span>
                  <span className="flex-1" />
                  {/* Des icônes plutôt que des intitulés : « Annuler la sélection » et
                      « Supprimer la sélection » se repliaient sur trois lignes dans cette
                      barre étroite, donnant deux pastilles énormes. Le libellé vit
                      désormais dans `aria-label` et dans l'infobulle — il n'est pas perdu,
                      il n'occupe simplement plus la place. */}
                  <button
                    type="button"
                    aria-label={t("app.clearSelection")}
                    title={t("app.clearSelection")}
                    onClick={() => {
                      setSelection(new Set());
                      setAncre(null);
                    }}
                    className="cursor-pointer rounded-lg p-2 text-muted transition-colors hover:bg-surface hover:text-foreground"
                  >
                    <Croix className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("app.deleteSelected")}
                    title={t("app.deleteSelected")}
                    onClick={supprimerSelection}
                    disabled={occupe}
                    className="cursor-pointer rounded-lg p-2 text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {/* `IconeCorbeille` et non `Corbeille` : ce dernier nom désigne
                        l'écran de la corbeille, importé juste en dessous. */}
                    <IconeCorbeille className="size-4" />
                  </button>
                </div>
              )}
              <ListeSecrets
                items={visibles}
                total={items.length}
                recherche={recherche}
                dossier={dossier}
                choisi={choisi}
                onChoisir={setChoisi}
                selection={selection}
                onBasculerSelection={basculerSelection}
                onToutSelectionner={(ids) => {
                  setSelection(new Set(ids));
                  setAncre(null);
                }}
              />
            </div>
          )}
        </div>

        <div className={`min-h-0 overflow-y-auto ${section !== "coffre" ? "hidden" : ""}`}>
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
              onPartager={() => void partager(choisi)}
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
      <Reglages />
    </div>
  );
}
