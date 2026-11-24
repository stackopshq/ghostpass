"use client";

// L'écran du coffre : arbre des dossiers, liste, détail.
//
// Le déchiffrement a lieu ici et nulle part ailleurs. Le serveur ne renvoie que
// des enveloppes ; ce composant les ouvre avec le compte en mémoire, et rien de
// ce qu'il produit ne repart ni ne se persiste.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { sealSend } from "@/lib/send";
import {
  decryptOrgItem,
  encryptOrgLogin,
  openOrg,
  decryptVaultItem,
  encryptFolders,
  encryptIdList,
  encryptItem,
  encryptOrgColors,
  encryptShares,
  type PartageEnCours,
} from "@/lib/crypto";
import { couleurOrg, definirCouleur, effacerCouleur, type RegistreCouleurs } from "@/lib/couleursOrg";
import { aEcrire, ARCHIVED_ITEM_NAME, basculer as basculerId, FAVORITES_ITEM_NAME } from "@/lib/registres";
import { useI18n } from "@/lib/i18n";
import { approuverLHote, examinerLienDePartage, hotesApprouves } from "@/lib/lienDePartage";
import { useSession } from "@/lib/session";
import { copierPuisEffacer, useVerrouAuto } from "@/lib/verrouillage";
import {
  adresseOuvrable,
  buildTree,
  filtrerVisibles,
  coffreDuLot,
  folderPaths,
  lignesDeLArbre,
  historiqueApresModification,
  dansLaPortee,
  porteeDe,
  ecrireOrdre,
  lireOrdre,
  ORDRE_PAR_DEFAUT,
  TOUS,
  trierEntrees,
  type Filtre,
  type Ordre,
  type VaultEntry,
} from "@/lib/vault";
import { contexteCourant, quelRaccourci } from "@/lib/raccourcis";
import { EnTeteDeSection, EntreeDeNav } from "@/components/BarreLaterale";
import { ListeSecrets } from "@/components/ListeSecrets";
import { DetailSecret } from "@/components/DetailSecret";
import { depuisEntree, FormulaireEntree, vide, type SaisieEntree } from "@/components/FormulaireEntree";
import { Bouton } from "@/components/champs";
import { ChoixDossier } from "@/components/ChoixDossier";
import { Archive, Bouclier, Cadenas, Coffre, Copier, Corbeille as IconeCorbeille, Crayon, Croix, Dossier as IconeDossier, Etoile, LienSortant, Organisation, PanneauLateral, Partage, Plus, Pouls, Reglages as IconeReglages, Loupe } from "@/components/Icones";
import { Corbeille } from "@/components/Corbeille";
import { Securite } from "@/components/Securite";
import { Surveillance } from "@/components/Surveillance";
import { Administration } from "@/components/Administration";
import { Partages } from "@/components/Partages";
import { ImportNavigateur } from "@/components/ImportNavigateur";
import { MenuDuCompte } from "@/components/MenuDuCompte";
import { AideRaccourcis } from "@/components/AideRaccourcis";
import type { EntreeDeMenu } from "@/components/MenuEntree";
import { versCsv } from "@/lib/export";
import { ListeOrgs } from "@/components/orgs/ListeOrgs";
import { DetailOrg } from "@/components/orgs/DetailOrg";
import type { OrgSummary } from "@/lib/orgs";

/// L'ordre de la liste est un réglage de l'appareil, comme le thème.
const CLE_ORDRE = "gp_ordre_liste";

function lireOrdreStocke(): Ordre {
  try {
    return lireOrdre(localStorage.getItem(CLE_ORDRE));
  } catch {
    return ORDRE_PAR_DEFAUT;
  }
}

/// Une organisation dont on a pu lire le coffre, pour la section « Coffres ».
interface CoffreDEquipe {
  orgId: string;
  nom: string;
}

/// Une collection d'équipe où l'utilisateur peut écrire.
interface Destination {
  orgId: string;
  orgName: string;
  collectionId: string;
  collectionName: string;
}

export function VaultScreen() {
  const { t } = useI18n();
  const { token, account, fermer } = useSession();
  // Monté avec l'écran du coffre, donc actif exactement tant qu'il est ouvert.
  useVerrouAuto(fermer);

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
  const [filtre, setFiltre] = useState<Filtre>(TOUS);
  const dossier = filtre.type === "dossier" ? filtre.chemin : null;
  // Le coffre dont on montre l'arborescence. Il suit ce qu'on a choisi : un
  // coffre, ou le coffre du dossier ouvert ; les vues transversales reviennent
  // à tous les coffres.
  const portee = porteeDe(filtre);
  const cleDePortee = portee.type === "organisation" ? `org:${portee.orgId}` : portee.type;
  // Favoris et archives : deux registres du coffre, partagés avec iOS et
  // Android (voir `lib/registres.ts`).
  const [favoris, setFavoris] = useState<Set<string>>(new Set());
  const [registreFavorisId, setRegistreFavorisId] = useState<string | null>(null);
  const [archives, setArchives] = useState<Set<string>>(new Set());
  const [registreArchivesId, setRegistreArchivesId] = useState<string | null>(null);
  const [coffresDEquipe, setCoffresDEquipe] = useState<CoffreDEquipe[]>([]);
  // Faux tant qu'une collection d'équipe a échoué à la lecture : élaguer les
  // registres effacerait alors les choix portant sur ses éléments.
  const [lectureComplete, setLectureComplete] = useState(false);
  // Les sections repliées de la barre latérale. Ouvertes par défaut : une
  // section fermée au premier lancement cache ce qu'elle contient à qui ne
  // sait pas encore qu'elle existe.
  const [sectionsRepliees, setSectionsRepliees] = useState<Set<string>>(new Set());
  // Les dossiers vides d'un coffre d'équipe, par organisation. En MÉMOIRE
  // seulement : le registre des dossiers vides est personnel, et y écrire ceux
  // d'une équipe les montrerait à soi seul, sur tous ses appareils, comme des
  // dossiers à soi. Un dossier d'équipe existe pour tous dès qu'un élément y
  // est rangé ; jusque-là, il n'existe que dans cet onglet, et la saisie le dit.
  const [dossiersEquipe, setDossiersEquipe] = useState<Record<string, string[]>>({});
  const [recherche, setRecherche] = useState("");
  /// Les dossiers dépliés dans la liste. Repliés par défaut, comme chez
  /// Keeper : un coffre de trois mille entrées déplié d'office noierait la
  /// première ligne qu'on cherche sous tout le reste.
  const [deplies, setDeplies] = useState<Set<string>>(new Set());
  /// Le dossier où ranger l'élément qu'on crée depuis le menu d'un dossier.
  const [dossierDeCreation, setDossierDeCreation] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  /// Les collections d'équipe où l'on peut écrire, rassemblées au chargement.
  const [destinations, setDestinations] = useState<Destination[]>([]);
  /// L'élément en cours de déplacement, `null` hors de ce geste.
  const [deplacement, setDeplacement] = useState<VaultEntry | null>(null);
  // Le déplacement d'une sélection entière. Un booléen et non une liste : la sélection
  // vit déjà dans `selection`, et en garder une copie ici les ferait diverger dès qu'on
  // coche une case de plus pendant que le panneau est ouvert.
  const [deplacementLot, setDeplacementLot] = useState(false);
  /// Le rangement d'une sélection dans un dossier : le chemin choisi tant que
  /// le panneau est ouvert, `null` sinon. Comme pour `deplacementLot`, les
  /// éléments eux-mêmes restent lus dans `selection`.
  const [rangementLot, setRangementLot] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  // Un message de succès s'efface tout seul.
  //
  // `setMessage(null)` n'était appelé **nulle part** : « Déplacé vers … » restait donc en
  // haut de l'écran pour le reste de la session, et le suivant le remplaçait sans que le
  // premier ait jamais disparu. Un bandeau permanent cesse d'être lu — et le jour où il
  // dit quelque chose d'important, personne ne le regarde plus.
  //
  // Le délai se réarme à chaque nouveau message, et se nettoie au démontage : sans cela,
  // deux actions rapprochées laisseraient le premier compte à rebours effacer le second.
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(t);
  }, [message]);
  // `null` = pas de formulaire ouvert ; sinon l'identifiant en cours de
  // modification, ou la chaîne vide pour une création.
  const [edition, setEdition] = useState<string | null>(null);
  // Les sections portées à ce jour. Les organisations et la sécurité
  // arrivent ensuite : tant qu'elles ne sont pas là, elles ne figurent pas
  // dans le rail — un onglet qui mène à « bientôt » est pire que son absence.
  const [section, setSection] = useState<
    "coffre" | "surveillance" | "orgs" | "partages" | "securite" | "corbeille" | "admin"
  >("coffre");
  // L'entrée « Administration » n'existe que pour les adresses de `GHOSTPASS_ADMIN_EMAILS`.
  // Indicatif : les routes `/api/admin/*` vérifient le rôle elles-mêmes.
  const [adminDeLInstance, setAdminDeLInstance] = useState(false);
  const [courriel, setCourriel] = useState<string | null>(null);
  const [barreOuverte, setBarreOuverte] = useState(true);
  const [importOuvert, setImportOuvert] = useState(false);
  const [aideOuverte, setAideOuverte] = useState(false);
  // Lu après le montage : `localStorage` n'existe pas pendant le rendu
  // statique que fait Next, et le lire plus tôt ferait diverger les deux.
  const [ordre, setOrdre] = useState<Ordre>(ORDRE_PAR_DEFAUT);
  useEffect(() => setOrdre(lireOrdreStocke()), []);
  const changerOrdre = (o: Ordre) => {
    setOrdre(o);
    try {
      localStorage.setItem(CLE_ORDRE, ecrireOrdre(o));
    } catch {
      /* L'ordre vaudra pour cette visite seulement. */
    }
  };
  const champRecherche = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!token) return;
    let vivant = true;
    api
      .accountInfo(token)
      .then((c) => {
        if (!vivant) return;
        setAdminDeLInstance(c.isInstanceAdmin === true);
        setCourriel(c.email);
      })
      .catch(() => {
        /* Sans l'information, l'entrée reste absente : rien n'est perdu. */
      });
    return () => {
      vivant = false;
    };
  }, [token]);
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
  const chargerElementsDEquipe = useCallback(async (): Promise<{
    items: VaultEntry[];
    destinations: Destination[];
    coffres: CoffreDEquipe[];
    complet: boolean;
  }> => {
    if (!token || !account) return { items: [], destinations: [], coffres: [], complet: false };
    const sortis: VaultEntry[] = [];
    const destinations: Destination[] = [];
    const coffres: CoffreDEquipe[] = [];
    let complet = true;
    let orgs: Awaited<ReturnType<typeof api.listOrgs>>["organizations"] = [];
    try {
      orgs = (await api.listOrgs(token)).organizations;
    } catch {
      return { items: [], destinations: [], coffres: [], complet: false };
    }
    for (const org of orgs) {
      if (org.status !== "active") continue;
      try {
        const m = await api.getMembership(token, org.orgId);
        if (!m.encryptedOrgKey || !m.sealedByPublicKey) continue;
        const handle = openOrg(account, m.sealedByPublicKey, m.encryptedOrgKey);
        coffres.push({ orgId: org.orgId, nom: org.name });
        const { collections } = await api.listCollections(token, org.orgId);
        for (const col of collections) {
          // Les destinations possibles d'un déplacement : seulement là où l'on peut
          // écrire. Proposer une collection en lecture seule ferait échouer l'envoi
          // après que l'utilisateur a choisi, ce qui est la pire façon de le lui dire.
          if (col.permission === "write" || col.permission === "manage") {
            destinations.push({
              orgId: org.orgId,
              orgName: org.name,
              collectionId: col.id,
              collectionName: col.name,
            });
          }
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
            complet = false;
          }
        }
      } catch {
        // Organisation illisible : les autres restent lisibles.
        complet = false;
      }
    }
    return { items: sortis, destinations, coffres, complet };
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
      let regFavorisId: string | null = null;
      let regFavoris: string[] = [];
      let regArchivesId: string | null = null;
      let regArchives: string[] = [];
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
        } else if (r.kind === "favorites") {
          regFavorisId = d.id;
          regFavoris = r.ids;
        } else if (r.kind === "archived") {
          regArchivesId = d.id;
          regArchives = r.ids;
        } else if (r.kind === "item") {
          entrees.push({ ...r.item, id: d.id, updatedAt: d.updatedAt });
        }
      }
      // Le coffre personnel d'abord, l'équipe ensuite : si les collections sont
      // lentes ou inaccessibles, la liste reste utilisable.
      setItems(entrees);
      const equipe = await chargerElementsDEquipe();
      setDestinations(equipe.destinations);
      setCoffresDEquipe(equipe.coffres);
      setLectureComplete(equipe.complet);
      if (equipe.items.length > 0) setItems([...entrees, ...equipe.items]);
      setRegistreFavorisId(regFavorisId);
      setFavoris(new Set(regFavoris));
      setRegistreArchivesId(regArchivesId);
      setArchives(new Set(regArchives));
      setRegistreId(regId);
      setDossiersVides(regChemins);
      setRegistrePartagesId(regPartagesId);
      setPartages(regPartages);
      setRegistreCouleursId(regCouleursId);
      setCouleursOrg(regCouleurs);
      setErreur(null);
      // Les deux coffres : l'appelant rouvre l'élément qu'il vient d'écrire,
      // et celui d'une équipe n'est pas dans `entrees`.
      return [...entrees, ...equipe.items];
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

  // Les archivés sortent aussi de l'arbre et de ses comptes : un dossier qui
  // annonce trois éléments et en montre deux enverrait chercher le troisième.
  const courants = useMemo(() => items.filter((i) => !archives.has(i.id)), [items, archives]);
  // Les dossiers vides vivent dans le registre PERSONNEL : ils n'ont rien à
  // faire dans l'arborescence d'une organisation.
  const tree = useMemo(
    () =>
      buildTree(
        courants.filter((i) => dansLaPortee(i, portee)),
        portee.type === "organisation" ? (dossiersEquipe[portee.orgId] ?? []) : dossiersVides,
      ),
    // `portee` est recréée à chaque rendu ; sa clé, non.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [courants, dossiersVides, dossiersEquipe, cleDePortee],
  );
  const visibles = useMemo(
    () => trierEntrees(filtrerVisibles(items, recherche, filtre, favoris, archives), ordre),
    [items, recherche, filtre, favoris, archives, ordre],
  );
  /// Les vues d'un coffre montrent leurs dossiers en arbre dans la liste. Une
  /// recherche, les favoris et les archives restent à plat : on y cherche un
  /// élément précis, et le dossier où il est rangé n'aide pas à le trouver.
  const enArbre =
    !recherche.trim() && (filtre.type === "tous" || filtre.type === "personnel" || filtre.type === "organisation");
  const lignesArbre = useMemo(
    () => (enArbre ? lignesDeLArbre(tree, deplies, ordre) : null),
    [enArbre, tree, deplies, ordre],
  );
  /// Ce que les flèches parcourent : les éléments qu'on voit. En arbre, ceux
  /// d'un dossier replié n'en sont pas, sinon la fiche changerait pour une
  /// ligne cachée.
  const navigables = useMemo(
    () => (lignesArbre ? lignesArbre.flatMap((l) => (l.type === "element" ? [l.item] : [])) : visibles),
    [lignesArbre, visibles],
  );

  /// Bascule un élément dans un registre « liste d'identifiants ».
  ///
  /// Comme pour les couleurs d'organisation, l'écran change AVANT l'aller-retour
  /// réseau : une étoile qui attend le serveur donne l'impression que le clic
  /// n'a pas porté. Un échec remet l'état précédent et le dit.
  ///
  /// Une sélection entière passe en UNE écriture : le registre est un seul
  /// élément chiffré, et onze écritures successives du même registre se
  /// marcheraient dessus. Rend `true` si l'écriture a abouti.
  const ecrireDansLeRegistre = useCallback(
    async (quel: "favoris" | "archives", calcul: (courant: Set<string>) => Set<string>) => {
      if (!token || !account) return false;
      const [courant, poser, registreId, poserId, nom] =
        quel === "favoris"
          ? ([favoris, setFavoris, registreFavorisId, setRegistreFavorisId, FAVORITES_ITEM_NAME] as const)
          : ([archives, setArchives, registreArchivesId, setRegistreArchivesId, ARCHIVED_ITEM_NAME] as const);
      const suivant = calcul(courant);
      poser(suivant);
      try {
        const vivants = new Set(items.map((i) => i.id));
        const enc = encryptIdList(account, nom, aEcrire(suivant, vivants, lectureComplete));
        if (registreId) await api.updateItem(token, registreId, enc);
        else poserId((await api.createItem(token, enc)).id);
        return true;
      } catch {
        poser(courant);
        setErreur(t("app.registryFailed"));
        return false;
      }
    },
    [token, account, favoris, archives, registreFavorisId, registreArchivesId, items, lectureComplete, t],
  );
  const basculerDansLeRegistre = useCallback(
    (quel: "favoris" | "archives", id: string) => ecrireDansLeRegistre(quel, (c) => basculerId(c, id)),
    [ecrireDansLeRegistre],
  );
  // Les chemins proposés par le formulaire sont ceux du coffre DE L'ÉLÉMENT :
  // celui de l'élément modifié, ou, pour une création, le coffre ouvert (le
  // personnel quand la vue les mêle tous). Ranger un élément personnel dans
  // un dossier d'équipe n'aurait pas de sens, et l'inverse non plus.
  const enEdition = edition ? items.find((i) => i.id === edition) : undefined;
  const orgDuFormulaire = enEdition
    ? enEdition.shared?.orgId
    : portee.type === "organisation"
      ? portee.orgId
      : undefined;
  const chemins = useMemo(
    () =>
      folderPaths(
        items.filter((i) => (orgDuFormulaire ? i.shared?.orgId === orgDuFormulaire : !i.shared)),
        orgDuFormulaire ? (dossiersEquipe[orgDuFormulaire] ?? []) : dossiersVides,
      ),
    [items, dossiersVides, dossiersEquipe, orgDuFormulaire],
  );

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
    // Ses parents se déplient : un dossier créé sous un parent replié
    // apparaîtrait nulle part, et le geste semblerait n'avoir rien fait.
    setDeplies((prec) => {
      const s = new Set(prec);
      const segments = path.split("/");
      for (let i = 1; i < segments.length; i++) s.add(segments.slice(0, i).join("/"));
      return s;
    });
    if (portee.type === "organisation") {
      const orgId = portee.orgId;
      setDossiersEquipe((prec) => ({
        ...prec,
        [orgId]: [...new Set([...(prec[orgId] ?? []), path])],
      }));
      return;
    }
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
    if (portee.type === "organisation") {
      const orgId = portee.orgId;
      setDossiersEquipe((prec) => ({
        ...prec,
        [orgId]: (prec[orgId] ?? []).filter((p) => p !== path && !p.startsWith(`${path}/`)),
      }));
      if (dossier === path) choisirFiltre(portee);
      return;
    }
    const suivant = dossiersVides.filter((p) => p !== path && !p.startsWith(`${path}/`));
    setDossiersVides(suivant);
    if (dossier === path) setFiltre(TOUS);
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
      // Un mot de passe remplacé n'est pas perdu. Sans cela, une modification
      // faite par erreur est définitive, et c'est exactement le moment où l'on
      // voudrait revenir en arrière. La règle est dans `vault.ts`, parce que les
      // deux écrans d'équipe doivent appliquer la même.
      const enCours = edition ? items.find((i) => i.id === edition) : undefined;
      const passwordHistory = historiqueApresModification(
        enCours?.password,
        v.password,
        enCours?.passwordHistory,
      );
      // UN ÉLÉMENT D'ÉQUIPE SE RÉÉCRIT SOUS LA CLÉ DE L'ÉQUIPE, PAR SA ROUTE.
      // La liste mêle les deux coffres ; l'enregistrer comme un élément
      // personnel envoyait la modification à une route qui ne le connaît pas.
      // Créer depuis un coffre d'équipe le crée dans ce coffre : on l'a ouvert
      // pour ça.
      const cible = enCours?.shared
        ? { orgId: enCours.shared.orgId, collectionId: enCours.shared.collectionId }
        : !edition && portee.type === "organisation"
          ? destinations.find((d) => d.orgId === portee.orgId)
          : undefined;
      if (!enCours?.shared && !edition && portee.type === "organisation" && !cible) {
        throw new Error(t("app.teamReadOnly"));
      }
      let id: string;
      if (cible) {
        const m = await api.getMembership(token, cible.orgId);
        if (!m.encryptedOrgKey || !m.sealedByPublicKey) throw new Error(t("org.keyUnavailable"));
        const poignee = openOrg(account, m.sealedByPublicKey, m.encryptedOrgKey);
        const enc = encryptOrgLogin(poignee, {
          name: v.name,
          username: v.username,
          password: v.password,
          urls: v.urls,
          totp: v.totp,
          notes: v.note,
          folder: v.folder,
          passwordHistory,
        });
        id = edition
          ? (await api.updateOrgItem(token, cible.orgId, cible.collectionId, edition, enc), edition)
          : (await api.createOrgItem(token, cible.orgId, cible.collectionId, enc)).id;
      } else {
        const enc = encryptItem(account, { ...v, passwordHistory });
        id = edition
          ? (await api.updateItem(token, edition, enc), edition)
          : (await api.createItem(token, enc)).id;
      }
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
      await copierPuisEffacer(lien).catch(() => undefined);
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

  /// Déplace un identifiant personnel vers une collection d'équipe.
  ///
  /// ─── L'ordre des opérations est la seule chose qui compte ici ───
  ///
  /// On **crée d'abord, on supprime ensuite**. Si la création échoue, rien n'a bougé. Si
  /// la suppression échoue après une création réussie, il reste un doublon — visible,
  /// corrigeable, et bien préférable à un secret perdu entre les deux. L'ordre inverse
  /// aurait une fenêtre où le mot de passe n'existe nulle part.
  ///
  /// ─── Ce que le serveur ne voit pas ───
  ///
  /// Le secret est déchiffré en mémoire depuis le coffre personnel, puis rechiffré sous
  /// la clé de l'équipe **avant** de partir. Le serveur reçoit deux chiffrés successifs
  /// et jamais le clair. La clé d'équipe est rouverte ici plutôt que gardée en mémoire
  /// depuis le chargement : un appel de plus, aucune clé qui traîne.
  const deplacerVersEquipe = async (item: VaultEntry, dest: Destination) => {
    if (!token || !account) return;
    setOccupe(true);
    setErreur(null);
    try {
      const m = await api.getMembership(token, dest.orgId);
      if (!m.encryptedOrgKey || !m.sealedByPublicKey) throw new Error(t("org.keyUnavailable"));
      const poignee = openOrg(account, m.sealedByPublicKey, m.encryptedOrgKey);
      const { encryptedKey, encryptedData } = encryptOrgLogin(poignee, {
        name: item.name,
        username: item.username,
        password: item.password,
        urls: item.urls,
        // Le dossier n'est pas repris : l'arborescence est celle du coffre personnel, et
        // la porter dans une collection d'équipe y créerait des dossiers que personne
        // d'autre n'a choisis.
        totp: item.totp,
        notes: item.note,
        passwordHistory: item.passwordHistory,
      });
      await api.createOrgItem(token, dest.orgId, dest.collectionId, {
        encryptedKey,
        encryptedData,
      });
      await api.deleteItem(token, item.id);
      setDeplacement(null);
      setChoisi(null);
      await charger();
      setMessage(t("app.moveDone", { collection: dest.collectionName }));
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
      // Même aiguillage qu'à l'enregistrement : un élément d'équipe a sa route.
      if (choisi.shared) {
        await api.deleteOrgItem(token, choisi.shared.orgId, choisi.shared.collectionId, choisi.id);
      } else {
        await api.deleteItem(token, choisi.id);
      }
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
  /** Ce qui, dans la sélection, peut aller dans un coffre d'équipe — et ce qui ne peut pas.
   *
   * Un coffre partagé ne prend que des **identifiants personnels**. Une note, une carte ou
   * un élément déjà d'équipe n'y a pas sa place, et les écarter en silence serait la pire
   * réponse : quelqu'un qui sélectionne onze lignes et en voit partir sept croirait à une
   * panne. L'écran annonce donc les deux nombres avant d'agir.
   */
  const triDeLaSelection = useMemo(() => {
    const retenus: VaultEntry[] = [];
    let ecartes = 0;
    for (const item of items) {
      if (!selection.has(item.id)) continue;
      if (!item.shared && item.kind === "login") retenus.push(item);
      else ecartes++;
    }
    return { retenus, ecartes };
  }, [items, selection]);

  /** Déplace la sélection retenue vers une collection d'équipe.
   *
   * **La clé d'équipe s'ouvre une fois**, pas une fois par élément : la déballer coûte une
   * requête et une opération cryptographique, et onze éléments n'en font pas onze coffres.
   *
   * Et comme pour un seul élément, **on dépose avant de retirer**. Entre les deux il y a un
   * réseau ; l'ordre inverse détruirait le seul exemplaire d'un mot de passe que le serveur
   * ne sait pas relire. Le pire cas laisse un doublon, jamais un trou.
   */
  const deplacerSelectionVersEquipe = async (dest: Destination) => {
    if (!token || !account) return;
    const { retenus } = triDeLaSelection;
    if (retenus.length === 0) return;
    setOccupe(true);
    setErreur(null);
    let ok = 0;
    let ko = 0;
    try {
      const m = await api.getMembership(token, dest.orgId);
      if (!m.encryptedOrgKey || !m.sealedByPublicKey) throw new Error(t("org.keyUnavailable"));
      const poignee = openOrg(account, m.sealedByPublicKey, m.encryptedOrgKey);

      for (const item of retenus) {
        try {
          const { encryptedKey, encryptedData } = encryptOrgLogin(poignee, {
            name: item.name,
            username: item.username,
            password: item.password,
            urls: item.urls,
            // Le dossier n'est pas repris : l'arborescence est celle du coffre personnel,
            // et la porter dans une collection d'équipe y créerait des dossiers que
            // personne d'autre n'a choisis.
            totp: item.totp,
            notes: item.note,
            passwordHistory: item.passwordHistory,
          });
          await api.createOrgItem(token, dest.orgId, dest.collectionId, {
            encryptedKey,
            encryptedData,
          });
          await api.deleteItem(token, item.id);
          ok++;
        } catch {
          // Un élément qui échoue ne doit pas emporter les suivants : ils sont
          // indépendants, et s'arrêter au premier laisserait un lot à moitié déplacé
          // sans dire lequel.
          ko++;
        }
      }

      setDeplacementLot(false);
      setSelection(new Set());
      setAncre(null);
      setChoisi(null);
      await charger();
      // Un lot à moitié déplacé n'est pas un succès : il reste des éléments dans le
      // coffre personnel, et c'est à l'utilisateur d'en faire quelque chose. Il passe
      // donc par le bandeau d'erreur, qui **ne s'efface pas tout seul** — contrairement
      // au message de réussite. Le vert qui disparaît et le rouge qui reste ne disent pas
      // la même chose, et c'est voulu.
      if (ko > 0) {
        setErreur(t("app.movedSome", { ok, ko, collection: dest.collectionName }));
      } else {
        setMessage(t("app.movedAll", { n: ok, collection: dest.collectionName }));
      }
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  const supprimerSelection = async () => {
    if (!token || selection.size === 0) return;
    if (!confirm(t("app.confirmDeleteMany", { n: selection.size }))) return;
    setOccupe(true);
    let ok = 0;
    let ko = 0;
    try {
      for (const id of selection) {
        try {
          // Un élément d'équipe se supprime par la route de sa collection :
          // envoyé à la route personnelle, il était refusé à chaque fois, et la
          // sélection mêle les deux coffres dans la vue « Tous les éléments ».
          const item = items.find((i) => i.id === id);
          if (item?.shared) {
            await api.deleteOrgItem(token, item.shared.orgId, item.shared.collectionId, id);
          } else {
            await api.deleteItem(token, id);
          }
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

  /// Les éléments sélectionnés, dans l'ordre de la liste.
  const lot = useMemo(() => items.filter((i) => selection.has(i.id)), [items, selection]);
  const coffreCommun = useMemo(() => coffreDuLot(lot), [lot]);
  /// Toute la sélection est déjà archivée (la vue Archives, typiquement) : le
  /// geste du lot est alors de l'en sortir. Une sélection mêlée s'archive.
  const lotArchive = lot.length > 0 && lot.every((i) => archives.has(i.id));

  const archiverSelection = async () => {
    const ids = lot.map((i) => i.id);
    const sortir = lotArchive;
    const fait = await ecrireDansLeRegistre("archives", (courant) => {
      const s = new Set(courant);
      for (const id of ids) {
        if (sortir) s.delete(id);
        else s.add(id);
      }
      return s;
    });
    if (!fait) return;
    // Les éléments quittent la vue qu'on regarde : garder leurs cases cochées
    // ferait agir le geste suivant sur des lignes qu'on ne voit plus.
    setSelection(new Set());
    setAncre(null);
    if (choisi && ids.includes(choisi.id)) setChoisi(null);
    setMessage(t(sortir ? "app.unarchivedMany" : "app.archivedMany", { n: ids.length }));
  };

  /// Les dossiers proposés pour ranger le lot : ceux de SON coffre.
  const cheminsDuLot = useMemo(() => {
    if (!coffreCommun) return [];
    return coffreCommun.type === "organisation"
      ? folderPaths(
          items.filter((i) => i.shared?.orgId === coffreCommun.orgId),
          dossiersEquipe[coffreCommun.orgId] ?? [],
        )
      : folderPaths(items.filter((i) => !i.shared), dossiersVides);
  }, [coffreCommun, items, dossiersEquipe, dossiersVides]);

  /// Range la sélection dans un dossier.
  ///
  /// Le dossier est DANS le chiffré : changer de dossier, c'est rechiffrer
  /// l'élément entier et le renvoyer, un par un, faute de route de lot. Comme
  /// pour la suppression, on compte, et un élément refusé n'arrête pas les
  /// suivants. La clé d'équipe s'ouvre une fois pour tout le lot.
  const rangerSelection = async (chemin: string) => {
    if (!token || !account || !coffreCommun) return;
    const aRanger = lot.filter((i) => i.folder !== chemin);
    setOccupe(true);
    setErreur(null);
    let ok = lot.length - aRanger.length;
    let ko = 0;
    try {
      let poignee: ReturnType<typeof openOrg> | null = null;
      if (coffreCommun.type === "organisation") {
        const m = await api.getMembership(token, coffreCommun.orgId);
        if (!m.encryptedOrgKey || !m.sealedByPublicKey) throw new Error(t("org.keyUnavailable"));
        poignee = openOrg(account, m.sealedByPublicKey, m.encryptedOrgKey);
      }
      for (const item of aRanger) {
        try {
          if (item.shared && poignee) {
            const enc = encryptOrgLogin(poignee, {
              name: item.name,
              username: item.username,
              password: item.password,
              urls: item.urls,
              totp: item.totp,
              notes: item.note,
              folder: chemin,
              passwordHistory: item.passwordHistory,
            });
            await api.updateOrgItem(token, item.shared.orgId, item.shared.collectionId, item.id, enc);
          } else {
            await api.updateItem(token, item.id, encryptItem(account, { ...item, folder: chemin }));
          }
          ok++;
        } catch {
          ko++;
        }
      }
      setRangementLot(null);
      setSelection(new Set());
      setAncre(null);
      await charger();
      // Même partage que pour le déplacement vers une équipe : le vert
      // s'efface, le rouge reste, parce qu'un lot à moitié rangé demande
      // qu'on y revienne.
      if (ko > 0) setErreur(t("app.filedSome", { ok, ko }));
      else setMessage(t("app.filedAll", { n: ok, folder: chemin ? chemin.split("/").join(" / ") : t("app.noFolder") }));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  /// Copie un champ depuis la liste ou le clavier, sans passer par la fiche.
  /// Le bandeau confirme, puisqu'aucun bouton de copie n'est là pour afficher
  /// sa coche.
  const copierChamp = async (item: VaultEntry, quoi: "identifiant" | "motDePasse") => {
    const [valeur, cle] =
      item.kind === "card"
        ? quoi === "identifiant"
          ? [item.cardholder, "app.copiedCardholder"]
          : [item.cardNumber, "app.copiedCardNumber"]
        : item.kind === "login"
          ? quoi === "identifiant"
            ? [item.username, "app.copiedUsername"]
            : [item.password, "app.copiedPassword"]
          : ["", ""];
    if (!valeur) return false;
    try {
      await copierPuisEffacer(valeur);
      setMessage(t(cle));
    } catch {
      setErreur(t("app.copyFailed"));
    }
    return true;
  };

  /// Le menu « … » d'une ligne. Chaque entrée n'existe que si elle aboutit :
  /// pas de « copier » sur un champ vide, pas de « modifier » en lecture seule.
  const actionsDe = (item: VaultEntry): EntreeDeMenu[] => {
    const e: EntreeDeMenu[] = [];
    const icone = "size-4";
    if (item.kind === "login") {
      if (item.username)
        e.push({ cle: "id", libelle: t("app.copyUsername"), icone: <Copier className={icone} />, agir: () => void copierChamp(item, "identifiant") });
      if (item.password)
        e.push({ cle: "mdp", libelle: t("app.copyPassword"), icone: <Copier className={icone} />, agir: () => void copierChamp(item, "motDePasse") });
      const adresse = item.urls.map(adresseOuvrable).find((a) => a !== null);
      if (adresse)
        e.push({
          cle: "site",
          libelle: t("app.openWebsite"),
          icone: <LienSortant className={icone} />,
          agir: () => void window.open(adresse, "_blank", "noopener,noreferrer"),
        });
    } else if (item.kind === "card" && item.cardNumber) {
      e.push({ cle: "num", libelle: t("app.copyCardNumber"), icone: <Copier className={icone} />, agir: () => void copierChamp(item, "motDePasse") });
    }
    const favori = favoris.has(item.id);
    e.push({
      cle: "favori",
      libelle: t(favori ? "app.removeFavorite" : "app.addFavorite"),
      icone: <Etoile plein={favori} className={icone} />,
      agir: () => void basculerDansLeRegistre("favoris", item.id),
    });
    e.push({
      cle: "archive",
      libelle: t(archives.has(item.id) ? "app.unarchive" : "app.archive"),
      icone: <Archive className={icone} />,
      agir: () => void basculerDansLeRegistre("archives", item.id),
    });
    if (item.shared?.permission !== "read") {
      e.push({
        cle: "modifier",
        libelle: t("app.edit"),
        icone: <Crayon className={icone} />,
        agir: () => {
          setChoisi(item);
          setEdition(item.id);
        },
      });
    }
    return e;
  };

  // ─── Les raccourcis clavier ───
  //
  // Un seul écouteur, posé une fois ; il lit l'état du dernier rendu par une
  // référence. Le reposer à chaque rendu le ferait disparaître un instant à
  // chaque frappe dans la recherche.
  const surTouche = useRef<(e: KeyboardEvent) => void>(() => undefined);
  surTouche.current = (e: KeyboardEvent) => {
    // Une touche déjà prise (Échap d'un menu ouvert) ou une saisie en cours
    // de composition (accents, japonais) n'est pas une commande.
    if (e.defaultPrevented || e.isComposing) return;
    // Une fenêtre ouverte (import, aide, affichage en grand) a la main.
    if (document.querySelector('[aria-modal="true"]')) return;
    const action = quelRaccourci(e, contexteCourant(champRecherche.current));
    if (!action) return;
    const surLaListe = section === "coffre" && edition === null;
    switch (action) {
      case "chercher":
        e.preventDefault();
        champRecherche.current?.focus();
        champRecherche.current?.select();
        return;
      case "suivant":
      case "precedent": {
        if (!surLaListe || navigables.length === 0) return;
        e.preventDefault();
        const i = choisi ? navigables.findIndex((x) => x.id === choisi.id) : -1;
        const j = action === "suivant" ? Math.min(i + 1, navigables.length - 1) : Math.max(i - 1, 0);
        setChoisi(navigables[j]);
        return;
      }
      case "copierMotDePasse":
      case "copierIdentifiant":
        if (!surLaListe || !choisi) return;
        // Rien à copier : on laisse la touche au navigateur.
        if (!(choisi.kind === "login" || choisi.kind === "card")) return;
        e.preventDefault();
        void copierChamp(choisi, action === "copierIdentifiant" ? "identifiant" : "motDePasse");
        return;
      case "verrouiller":
        e.preventDefault();
        fermer();
        return;
      case "aide":
        e.preventDefault();
        setAideOuverte(true);
        return;
      case "echap":
        // Le formulaire n'est pas fermé par Échap : un geste réflexe
        // y perdrait une saisie.
        if (document.activeElement === champRecherche.current && recherche) {
          e.preventDefault();
          setRecherche("");
        } else if (surLaListe && choisi) {
          e.preventDefault();
          setChoisi(null);
        }
        return;
    }
  };
  useEffect(() => {
    const ecoute = (e: KeyboardEvent) => surTouche.current(e);
    window.addEventListener("keydown", ecoute);
    return () => window.removeEventListener("keydown", ecoute);
  }, []);

  /// Une vue du coffre : elle ramène toujours à l'écran du coffre, et vide la
  /// sélection, qui ne porterait plus sur ce qu'on regarde.
  const choisirFiltre = (f: Filtre) => {
    setSection("coffre");
    setOrgOuverte(null);
    setFiltre(f);
    setSelection(new Set());
  };

  const ouvrirSection = (cle: "surveillance" | "orgs" | "partages" | "securite" | "corbeille" | "admin") => {
    setSection(cle);
    if (cle !== "orgs") setOrgOuverte(null);
  };

  const [titreDuFiltre, videDuFiltre] = ((): [string, string] => {
    switch (filtre.type) {
      case "tous":
        return [t("app.allItems"), t("app.noneInVault")];
      case "favoris":
        return [t("app.favorites"), t("app.noFavorites")];
      case "archives":
        return [t("app.archives"), t("app.noArchived")];
      case "personnel":
        return [t("app.personalVault"), t("app.noneInVault")];
      case "organisation":
        return [filtre.nom, t("app.noneInVault")];
      case "dossier":
        return [filtre.chemin.split("/").pop() ?? "", t("app.noneInFolder")];
    }
  })();

  /// L'export ne porte QUE sur le coffre personnel. `items` contient aussi les
  /// éléments d'équipe : les passer tels quels déposerait les secrets de toute
  /// une organisation en clair sur la machine d'un seul membre, sans que
  /// l'équipe l'apprenne (voir `lib/export.ts`).
  const exporterCsv = () => {
    const blob = new Blob([versCsv(items.filter((i) => !i.shared))], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ghostpass-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const basculerSectionRepliee = (cle: string) => {
    setSectionsRepliees((prec) => basculerId(prec, cle));
  };

  const basculer = (path: string) => setDeplies((prec) => basculerId(prec, path));

  const nouvelElement = () => {
    // Le dossier ouvert pré-remplit le champ : on ajoute presque toujours là
    // où l'on est en train de regarder.
    setSection("coffre");
    setChoisi(null);
    setDossierDeCreation(null);
    setEdition("");
  };

  return (
    <div className="flex h-dvh flex-col text-foreground">
      {aideOuverte && <AideRaccourcis onFermer={() => setAideOuverte(false)} />}

      {erreur && (
        <p role="alert" className="shrink-0 border-b border-border bg-danger/10 px-4 py-2 text-sm text-danger">
          {erreur}
        </p>
      )}
      {message && (
        // Cliquable autant qu'éphémère : six secondes suffisent à lire « Déplacé vers … »
        // et sont longues quand le bandeau masque ce qu'on regarde.
        <button
          type="button"
          onClick={() => setMessage(null)}
          className="shrink-0 cursor-pointer border-b border-border bg-success/10 px-4 py-2 text-left text-sm text-success"
        >
          {message}
        </button>
      )}

      {/* LA BARRE DU HAUT
          La recherche au centre, sur toute la largeur, et le compte à droite,
          où on le cherche (Keeper, 1Password, la plupart des applications web).
          « Nouvel élément » est passé en tête de la barre latérale le
          2026-11-24, disposition de Keeper ; il ne revient ici que quand la
          barre n'est pas affichée. ghostcal garde tout dans son rail, et les
          deux produits ne s'alignent plus sur ce point. */}
      {/* Barre du haut et barre latérale forment UN cadre, du même fond et sans
          trait entre elles ; la liste et la fiche se posent dedans comme un
          panneau, arrondi au coin où les deux barres se rejoignent. C'est ce
          coin qui dit que le cadre entoure le contenu, au lieu de trois bandes
          juxtaposées. */}
      <header className="flex h-14 shrink-0 items-center gap-3 px-3">
        <button
          type="button"
          onClick={() => setBarreOuverte((o) => !o)}
          aria-pressed={barreOuverte}
          title={t("app.toggleSidebar")}
          aria-label={t("app.toggleSidebar")}
          className="cursor-pointer rounded-lg p-2 text-muted transition-colors hover:bg-surface hover:text-foreground"
        >
          <PanneauLateral className="size-5" />
        </button>
        {/* `text-foreground` explicite : hérité, le mot-marque sortait en
            `rgb(11,15,25)`, la couleur du FOND, noir sur noir. Logo de la
            charte servi tel quel, comme chez ghostcal. */}
        <span className="hidden w-48 shrink-0 items-center gap-2 text-lg font-semibold tracking-tight text-foreground sm:flex">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={28} height={28} className="h-7 w-7" />
          GhostPass
        </span>
        {/* La loupe est posée DANS le champ, pas dans son texte d'aide : elle
            reste quand on tape, et le lecteur d'écran ne la lit pas (le champ
            a déjà son `aria-label`). `pointer-events-none` laisse le clic
            atteindre le champ à travers elle. */}
        <div className="relative mx-auto w-full max-w-3xl">
          <Loupe className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            ref={champRecherche}
            type="search"
            value={recherche}
            onChange={(e) => {
              setRecherche(e.target.value);
              // Taper dans la recherche depuis la corbeille ou les partages
              // ne doit pas chercher dans le vide : les résultats sont au coffre.
              setSection("coffre");
            }}
            placeholder={t("app.searchVault")}
            aria-label={t("app.searchVault")}
            className="w-full rounded border border-border bg-surface-2 py-2 pl-9 pr-3.5 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
        </div>
        {/* « Nouvel élément » vit en tête de la barre latérale. Quand elle
            n'est pas là (repliée, ou écran étroit), il revient ici en bouton
            compact : la barre ne doit jamais emporter le geste principal. */}
        <Bouton
          className={`shrink-0 ${barreOuverte ? "md:hidden" : ""}`}
          onClick={nouvelElement}
          aria-label={t("app.newItem")}
          title={t("app.newItem")}
        >
          <Plus className="size-4" />
        </Bouton>
        <MenuDuCompte
          courriel={courriel}
          onSecurite={() => ouvrirSection("securite")}
          onImporter={() => setImportOuvert(true)}
          onExporter={exporterCsv}
          exportPossible={items.some((i) => !i.shared)}
          onRaccourcis={() => setAideOuverte(true)}
          onVerrouiller={fermer}
        />
      </header>

      <div
        className={`grid min-h-0 flex-1 grid-cols-1 ${barreOuverte ? "md:grid-cols-[16rem_1fr]" : ""}`}
      >
        <nav
          className={`min-h-0 flex-col overflow-y-auto p-3 pt-1 ${barreOuverte ? "hidden md:flex" : "hidden"}`}
        >
          {/* Le geste principal en tête de la barre, au-dessus des vues :
              disposition de Keeper, demandée le 2026-11-24. */}
          <Bouton className="mb-5 mt-2 w-full" onClick={nouvelElement}>
            <span className="flex items-center justify-center gap-2">
              <Plus className="size-4" />
              {t("app.newItem")}
            </span>
          </Bouton>
          {/* LA BARRE PAR SECTIONS
              En haut, les vues qui traversent tout le coffre ; puis les coffres
              (le personnel et ceux des organisations) ; puis les dossiers ; en
              pied, ce qu'on visite rarement. Les espacements restent ceux de
              ghostcal : 4 px entre deux entrées, 24 px avant la navigation. */}
          <div className="flex flex-col gap-1">
            <EntreeDeNav
              icone={Coffre}
              libelle={t("app.allItems")}
              compte={courants.length}
              actif={section === "coffre" && filtre.type === "tous"}
              onClick={() => choisirFiltre(TOUS)}
            />
            <EntreeDeNav
              icone={Etoile}
              libelle={t("app.favorites")}
              compte={courants.filter((i) => favoris.has(i.id)).length}
              actif={section === "coffre" && filtre.type === "favoris"}
              onClick={() => choisirFiltre({ type: "favoris" })}
            />
            <EntreeDeNav
              icone={Pouls}
              libelle={t("app.watch")}
              actif={section === "surveillance"}
              onClick={() => ouvrirSection("surveillance")}
            />
          </div>

          <EnTeteDeSection
            titre={t("app.vaults")}
            ouvert={!sectionsRepliees.has("coffres")}
            onBasculer={() => basculerSectionRepliee("coffres")}
            action={
              // Les organisations se gèrent (membres, collections, couleur)
              // depuis leur écran ; la section ne fait que filtrer.
              <button
                type="button"
                onClick={() => ouvrirSection("orgs")}
                title={t("app.manageOrgs")}
                aria-label={t("app.manageOrgs")}
                className={`cursor-pointer rounded p-0.5 hover:text-foreground ${section === "orgs" ? "text-accent" : "text-muted"}`}
              >
                <Organisation className="size-4" />
              </button>
            }
          />
          {!sectionsRepliees.has("coffres") && (
            <div className="flex flex-col gap-0.5">
              <EntreeDeNav
                icone={Cadenas}
                libelle={t("app.personalVault")}
                compte={courants.filter((i) => !i.shared).length}
                actif={section === "coffre" && filtre.type === "personnel"}
                onClick={() => choisirFiltre({ type: "personnel" })}
              />
              {coffresDEquipe.map((c) => (
                <EntreeDeNav
                  key={c.orgId}
                  pastille={couleurOrg(couleursOrg, c.orgId)}
                  libelle={c.nom}
                  compte={courants.filter((i) => i.shared?.orgId === c.orgId).length}
                  actif={section === "coffre" && filtre.type === "organisation" && filtre.orgId === c.orgId}
                  onClick={() => choisirFiltre({ type: "organisation", orgId: c.orgId, nom: c.nom })}
                />
              ))}
            </div>
          )}


          <div className="mt-6 flex flex-col gap-1">
            <EntreeDeNav
              icone={Partage}
              libelle={t("app.shares")}
              actif={section === "partages"}
              onClick={() => ouvrirSection("partages")}
            />
            {adminDeLInstance && (
              <EntreeDeNav
                icone={IconeReglages}
                libelle={t("app.admin")}
                actif={section === "admin"}
                onClick={() => ouvrirSection("admin")}
              />
            )}
            <EntreeDeNav
              icone={Archive}
              libelle={t("app.archives")}
              compte={items.filter((i) => archives.has(i.id)).length}
              actif={section === "coffre" && filtre.type === "archives"}
              onClick={() => choisirFiltre({ type: "archives" })}
            />
            <EntreeDeNav
              icone={IconeCorbeille}
              libelle={t("app.trash")}
              actif={section === "corbeille"}
              onClick={() => ouvrirSection("corbeille")}
            />
          </div>
        </nav>

        {importOuvert && (
          <ImportNavigateur
            personnels={items.filter((i) => !i.shared)}
            onFerme={() => setImportOuvert(false)}
            onImporte={() => void charger().then(() => setChoisi(null))}
          />
        )}

        {/* `overflow-hidden` et non seulement `min-h-0` : sans lui, une section
            plus haute que l'écran déborde cette colonne, déborde la grille, et
            c'est la PAGE qui se met à défiler — emportant le rail de gauche,
            qui devrait rester fixe. Signalé par Clara sur l'écran de sécurité,
            dont l'historique de connexions dépasse vite la hauteur d'écran.

            `flex flex-col` donne aux sections un contexte où `flex-1` a un
            sens : `min-h-0 overflow-y-auto` sur un bloc sans hauteur définie ne
            déclenche jamais de défilement, il grandit. */}
        {/* Le panneau : liste et fiche. `overflow-hidden` pour que le coin
            arrondi coupe aussi ce qui défile dessous.

            LA LISTE S'ÉLARGIT AVEC L'ÉCRAN
            21rem suffisait à une liste plate. Avec les dossiers en arbre, le
            retrait de chaque niveau et la pastille de collection mangeaient
            le nom : « Base de d… » dès le premier niveau. Elle grandit par
            paliers ; la fiche garde au moins la moitié de la place. */}
        <div className="verre-dense grid min-h-0 grid-cols-1 overflow-hidden border-border md:grid-cols-[21rem_1fr] md:rounded-tl-lg md:border-l md:border-t lg:grid-cols-[27rem_1fr] xl:grid-cols-[32rem_1fr]">
        <div
          className={`flex min-h-0 flex-col overflow-hidden border-r border-border ${section !== "coffre" ? "col-span-2" : ""}`}
        >
          {section === "partages" ? (
            <Partages partages={partages} occupe={occupe} onRevoquer={revoquerPartage} />
          ) : section === "securite" ? (
            <Securite />
          ) : section === "surveillance" ? (
            <Surveillance
              items={courants}
              onOuvrir={(item) => {
                choisirFiltre(TOUS);
                setChoisi(item);
              }}
            />
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
          ) : section === "admin" ? (
            <Administration />
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
                  {/* Ranger dans un dossier : seulement si toute la sélection
                      est dans un même coffre où l'on peut écrire (`coffreDuLot`). */}
                  {coffreCommun && (
                    <button
                      type="button"
                      aria-label={t("app.fileSelected")}
                      title={t("app.fileSelected")}
                      onClick={() => {
                        setDeplacementLot(false);
                        setEdition(null);
                        // Le dossier commun du lot s'il en a un, sinon la racine.
                        const premier = lot[0]?.folder ?? "";
                        setRangementLot(lot.every((i) => i.folder === premier) ? premier : "");
                      }}
                      disabled={occupe}
                      className="cursor-pointer rounded-lg p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                    >
                      <IconeDossier className="size-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={t(lotArchive ? "app.unarchiveSelected" : "app.archiveSelected")}
                    title={t(lotArchive ? "app.unarchiveSelected" : "app.archiveSelected")}
                    aria-pressed={lotArchive}
                    onClick={() => void archiverSelection()}
                    disabled={occupe}
                    className={`cursor-pointer rounded-lg p-2 transition-colors hover:bg-surface-2 hover:text-foreground ${lotArchive ? "text-accent" : "text-muted"}`}
                  >
                    <Archive className="size-4" />
                  </button>
                  {/* Déplacer la sélection vers un coffre d'équipe.
                      Offert seulement s'il peut aboutir : au moins un identifiant personnel
                      dans la sélection, et au moins une collection où l'on puisse écrire.
                      Un bouton qui mène toujours à un refus vaut moins qu'un bouton absent. */}
                  {triDeLaSelection.retenus.length > 0 && destinations.length > 0 && (
                    <button
                      type="button"
                      aria-label={t("app.moveSelected")}
                      title={t("app.moveSelected")}
                      onClick={() => {
                        setRangementLot(null);
                        setDeplacementLot(true);
                      }}
                      disabled={occupe}
                      className="cursor-pointer rounded-lg p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                    >
                      <Organisation className="size-4" />
                    </button>
                  )}
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
                titre={titreDuFiltre}
                vide={videDuFiltre}
                favoris={favoris}
                choisi={choisi}
                onChoisir={setChoisi}
                selection={selection}
                onBasculerSelection={basculerSelection}
                onToutSelectionner={(ids) => {
                  setSelection(new Set(ids));
                  setAncre(null);
                }}
                ordre={ordre}
                onOrdre={changerOrdre}
                actions={actionsDe}
                arbre={
                  lignesArbre
                    ? {
                        lignes: lignesArbre,
                        onBasculer: basculer,
                        onCreer: (p) => void creerDossier(p),
                        onSupprimer: (p) => void supprimerDossier(p),
                        onNouvelElement: (p) => {
                          setChoisi(null);
                          setDossierDeCreation(p);
                          setEdition("");
                        },
                        aideCreation: portee.type === "organisation" ? t("app.teamFolderHint") : undefined,
                      }
                    : undefined
                }
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
                  : (dossierDeCreation ?? dossier)
                    ? { ...vide(), folder: dossierDeCreation ?? dossier ?? "" }
                    : undefined
              }
              edition={edition !== ""}
              // Un coffre d'équipe ne prend que des identifiants : ni l'écran
              // d'équipe ni l'aiguillage d'enregistrement ne savent écrire
              // une note ou une carte sous la clé d'une organisation.
              identifiantSeul={
                edition ? !!items.find((i) => i.id === edition)?.shared : portee.type === "organisation"
              }
              occupe={occupe}
              chemins={chemins}
              onValider={enregistrer}
              onAnnuler={() => setEdition(null)}
            />
            ) : rangementLot !== null && coffreCommun ? (
              // En ligne dans le panneau, comme le déplacement : la colonne
              // voisine porte `backdrop-filter`, qui enferme les `fixed`.
              <div className="flex min-h-0 flex-col gap-3 p-5">
                <h2 className="text-base font-semibold text-foreground">{t("app.fileSelected")}</h2>
                <p className="text-sm text-muted">{t("app.fileManyCount", { n: lot.length })}</p>
                <ChoixDossier valeur={rangementLot} chemins={cheminsDuLot} onChange={setRangementLot} />
                <div className="flex gap-2">
                  <Bouton onClick={() => void rangerSelection(rangementLot)} disabled={occupe}>
                    {t("app.fileHere")}
                  </Bouton>
                  <Bouton variante="discret" onClick={() => setRangementLot(null)} disabled={occupe}>
                    {t("app.cancelBack")}
                  </Bouton>
                </div>
              </div>
            ) : deplacementLot ? (
              // Même placement en ligne que pour un seul élément, et pour la même
              // raison : la colonne voisine porte `backdrop-filter`, qui capture les
              // éléments en `position: fixed` et les enferme dans leur conteneur.
              <div className="flex min-h-0 flex-col gap-3 p-5">
                <h2 className="text-base font-semibold text-foreground">
                  {t("app.moveToShared")}
                </h2>
                <p className="text-sm text-muted">
                  {t("app.moveManyCount", { n: triDeLaSelection.retenus.length })}
                </p>
                {triDeLaSelection.ecartes > 0 && (
                  // Dit avant d'agir, et non après. Un coffre d'équipe ne prend que des
                  // identifiants personnels ; quelqu'un qui en sélectionne onze et en
                  // voit partir sept croirait à une panne si on ne l'avait pas prévenu.
                  <p className="text-xs leading-relaxed text-muted">
                    {t("app.moveManyExcluded", { n: triDeLaSelection.ecartes })}
                  </p>
                )}
                <p className="text-xs leading-relaxed text-muted">{t("app.moveToSharedPick")}</p>
                <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
                  {destinations.map((d) => (
                    <button
                      key={`${d.orgId}/${d.collectionId}`}
                      type="button"
                      disabled={occupe}
                      onClick={() => void deplacerSelectionVersEquipe(d)}
                      className="cursor-pointer rounded-lg border border-border px-3 py-2.5 text-left text-sm transition-colors hover:border-border-strong hover:bg-surface-2 disabled:opacity-60"
                    >
                      <span className="block font-medium">{d.collectionName}</span>
                      <span className="block text-xs text-muted">{d.orgName}</span>
                    </button>
                  ))}
                </div>
                <Bouton
                  variante="discret"
                  onClick={() => setDeplacementLot(false)}
                  disabled={occupe}
                >
                  {t("app.cancelBack")}
                </Bouton>
              </div>
          ) : deplacement ? (
            // En ligne dans le panneau, et non en superposition : la colonne voisine
            // porte `verre-dense`, donc `backdrop-filter`, qui capture les éléments en
            // `position: fixed` et les enferme dans leur conteneur. Le panneau d'import
            // y est tombé ; on ne recommence pas.
            <div className="flex min-h-0 flex-col gap-3 p-5">
              <h2 className="text-base font-semibold text-foreground">
                {t("app.moveToShared")}
              </h2>
              <p className="text-sm text-muted">{deplacement.name}</p>
              <p className="text-xs leading-relaxed text-muted">{t("app.moveToSharedPick")}</p>
              <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
                {destinations.map((d) => (
                  <button
                    key={`${d.orgId}/${d.collectionId}`}
                    type="button"
                    disabled={occupe}
                    onClick={() => void deplacerVersEquipe(deplacement, d)}
                    className="cursor-pointer rounded-lg border border-border px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="block font-medium">{d.collectionName}</span>
                    <span className="block text-xs text-muted">{d.orgName}</span>
                  </button>
                ))}
              </div>
              <Bouton variante="discret" onClick={() => setDeplacement(null)} disabled={occupe}>
                {t("app.cancelBack")}
              </Bouton>
            </div>
          ) : choisi ? (
            <DetailSecret
              item={choisi}
              // Le déplacement n'est proposé que s'il peut aboutir : un identifiant
              // personnel, et au moins une collection où l'on puisse écrire. Un bouton
              // qui mène toujours à un refus vaut moins qu'un bouton absent.
              onDeplacer={
                !choisi.shared && choisi.kind === "login" && destinations.length > 0
                  ? () => setDeplacement(choisi)
                  : undefined
              }
              // En lecture seule sur une collection, ni modifier ni supprimer :
              // le serveur refuserait, après que l'on a tout saisi.
              onModifier={choisi.shared?.permission === "read" ? undefined : () => setEdition(choisi.id)}
              onSupprimer={choisi.shared?.permission === "read" ? undefined : supprimerEntree}
              onPartager={() => void partager(choisi)}
              favori={favoris.has(choisi.id)}
              onFavori={() => void basculerDansLeRegistre("favoris", choisi.id)}
              archive={archives.has(choisi.id)}
              onArchive={() => void basculerDansLeRegistre("archives", choisi.id)}
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
    </div>
  );
}
