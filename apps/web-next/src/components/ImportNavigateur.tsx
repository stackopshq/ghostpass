"use client";

// L'écran qui fait entrer un coffre de navigateur dans celui-ci.
//
// LA VRAIE DIFFICULTÉ N'EST PAS LE FICHIER
// ----------------------------------------
// Découper un CSV est l'affaire de `lib/importNavigateur.ts`. Ce que cet écran
// résout est le pas d'avant, celui où l'on perd les gens : personne ne sait
// que Chrome exporte ses mots de passe, encore moins où. Les instructions ne
// sont donc pas une aide contextuelle repliée quelque part, elles SONT l'écran,
// et la personne n'a pas à choisir son navigateur dans une liste : elle dépose
// son fichier, et le format se reconnaît tout seul.
//
// TROIS TEMPS, ET UN COMPTE RENDU AVANT D'ÉCRIRE
// ----------------------------------------------
// « choix » → « aperçu » → « fait ». L'aperçu existe parce qu'un import est
// difficile à défaire : on montre ce qui entrera et ce qui sera écarté, avec le
// motif, AVANT de toucher au coffre. Un écran qui écrit d'abord et rend compte
// ensuite laisse pour seule issue de supprimer trois cents entrées à la main.
//
// CE QUI NE SORT PAS D'ICI
// ------------------------
// Le fichier ne quitte jamais l'onglet : il est lu par `File.text()`, découpé
// en mémoire, chiffré, et seul le chiffré part vers le serveur. Rien du contenu
// n'est journalisé, ni affiché, ni glissé dans un message d'erreur ; les rejets
// se désignent par leur numéro d'entrée et leur motif, jamais par leur valeur.

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { encryptItem } from "@/lib/crypto";
import { analyser, parMotif, type Analyse } from "@/lib/importNavigateur";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import type { VaultEntry } from "@/lib/vault";
import { Bouton } from "@/components/champs";
import { Televerser } from "@/components/Icones";

/// Les quatre marches à suivre, une phrase chacune.
///
/// Une phrase, et pas trois : la personne lit celle de SON navigateur et ignore
/// les autres. Les adresses `chrome://` et consorts sont montrées en code et
/// non en lien, parce qu'un navigateur refuse de suivre un lien vers ses pages
/// internes depuis une page web, et un lien mort ici passerait pour une panne du
/// produit.
const NAVIGATEURS = ["chrome", "edge", "firefox", "safari"] as const;

type Etape =
  | { nom: "choix" }
  | { nom: "apercu"; analyse: Analyse }
  | { nom: "envoi"; total: number; faites: number }
  | { nom: "fait"; analyse: Analyse; importees: number; echecs: number };

export function ImportNavigateur({
  personnels,
  onFerme,
  onImporte,
}: {
  /// Le coffre personnel déjà déchiffré, pour reconnaître les doublons sans
  /// rien demander au serveur. Voir `lib/importNavigateur.ts` : un doublon est
  /// une entrée STRICTEMENT identique, mot de passe compris.
  personnels: VaultEntry[];
  onFerme: () => void;
  onImporte: () => void;
}) {
  const { t } = useI18n();
  const { token, account } = useSession();
  const champ = useRef<HTMLInputElement>(null);
  const [etape, setEtape] = useState<Etape>({ nom: "choix" });
  const [erreur, setErreur] = useState<string | null>(null);

  // Échap ferme, comme partout ailleurs. Un panneau qui couvre l'écran sans
  // cette touche donne l'impression d'un produit qui a pris la main.
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape" && etape.nom !== "envoi") onFerme();
    };
    document.addEventListener("keydown", surTouche);
    return () => document.removeEventListener("keydown", surTouche);
  }, [etape.nom, onFerme]);

  const lire = async (fichier: File) => {
    setErreur(null);
    try {
      const texte = await fichier.text();
      setEtape({ nom: "apercu", analyse: analyser(texte, personnels, t("app.noName")) });
    } catch {
      // Volontairement sans le détail de l'erreur : le message d'un lecteur de
      // fichier peut citer le contenu, et ce contenu est une liste de mots de
      // passe en clair.
      setErreur(t("import.readError"));
    } finally {
      if (champ.current) champ.current.value = "";
    }
  };

  const importer = async (analyse: Analyse) => {
    if (!token || !account) return;
    const total = analyse.aImporter.length;
    setEtape({ nom: "envoi", total, faites: 0 });
    let importees = 0;
    let echecs = 0;
    let dAffilee = 0;
    for (const entree of analyse.aImporter) {
      try {
        await api.createItem(token, encryptItem(account, entree));
        importees++;
        dAffilee = 0;
      } catch {
        echecs++;
        dAffilee++;
        // Trois échecs de suite ne sont plus un accident de ligne : le serveur
        // est tombé, le jeton a expiré, le quota est atteint. Continuer, c'est
        // trois cents requêtes vouées à échouer et un compte rendu illisible.
        if (dAffilee >= 3) {
          echecs += total - importees - echecs;
          break;
        }
      }
      setEtape({ nom: "envoi", total, faites: importees + echecs });
    }
    onImporte();
    setEtape({ nom: "fait", analyse, importees, echecs });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      // Le fond ferme le panneau, sauf pendant l'envoi : un clic distrait au
      // milieu d'un import de trois cents entrées ne doit pas l'interrompre.
      onClick={() => etape.nom !== "envoi" && onFerme()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titre-import"
        onClick={(e) => e.stopPropagation()}
        className="verre-dense max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border border-border p-6"
      >
        <h2 id="titre-import" className="text-lg font-semibold text-foreground">
          {t("import.title")}
        </h2>

        {etape.nom === "choix" && (
          <div className="mt-4 space-y-4">
            <p className="text-sm leading-relaxed text-muted">{t("import.intro")}</p>

            <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
                {t("import.howto")}
              </h3>
              <ul className="space-y-2 text-sm leading-relaxed text-foreground">
                {NAVIGATEURS.map((n) => (
                  <li key={n}>
                    <span className="font-medium">{t(`import.${n}.nom`)}</span>{" "}
                    <span className="text-muted">{t(`import.${n}.etapes`)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <Avertissement texte={t("import.warning")} />

            <div className="flex items-center gap-2">
              <Bouton onClick={() => champ.current?.click()}>
                <span className="flex items-center gap-1.5">
                  <Televerser className="size-4" />
                  {t("import.choose")}
                </span>
              </Bouton>
              <Bouton variante="discret" onClick={onFerme}>
                {t("import.cancel")}
              </Bouton>
            </div>
            <input
              ref={champ}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              aria-label={t("import.choose")}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void lire(f);
              }}
            />
          </div>
        )}

        {etape.nom === "apercu" && (
          <Apercu
            analyse={etape.analyse}
            onRetour={() => setEtape({ nom: "choix" })}
            onValider={() => void importer(etape.analyse)}
          />
        )}

        {etape.nom === "envoi" && (
          <p className="mt-4 text-sm text-muted" role="status">
            {t("import.progress", { n: etape.faites, total: etape.total })}
          </p>
        )}

        {etape.nom === "fait" && (
          <Bilan
            analyse={etape.analyse}
            importees={etape.importees}
            echecs={etape.echecs}
            onFerme={onFerme}
          />
        )}

        {erreur && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {erreur}
          </p>
        )}
      </div>
    </div>
  );
}

/// Le rappel qui compte plus que le reste de l'écran.
///
/// Un export de navigateur est un fichier de mots de passe en clair, posé dans
/// le dossier des téléchargements, qui y reste indéfiniment et que la moindre
/// synchronisation recopie ailleurs. C'est, à cet instant, le plus gros risque
/// de la migration, plus grand que tout ce que le produit protège par
/// ailleurs. Il est donc affiché deux fois : avant l'import, et après.
function Avertissement({ texte }: { texte: string }) {
  return (
    <p className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm leading-relaxed text-danger">
      {texte}
    </p>
  );
}

/// Ce que l'import fera, dit avant de le faire.
function Apercu({
  analyse,
  onRetour,
  onValider,
}: {
  analyse: Analyse;
  onRetour: () => void;
  onValider: () => void;
}) {
  const { t } = useI18n();
  const rien = analyse.aImporter.length === 0;

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-muted">
        {analyse.formatReconnu
          ? t(`import.detected.${analyse.navigateur}`)
          : t("import.notRecognised")}
      </p>
      <Comptes analyse={analyse} />
      <div className="flex items-center gap-2">
        <Bouton onClick={onValider} disabled={rien}>
          {rien ? t("import.nothing") : t("import.confirm", { n: analyse.aImporter.length })}
        </Bouton>
        <Bouton variante="discret" onClick={onRetour}>
          {t("import.back")}
        </Bouton>
      </div>
    </div>
  );
}

/// Ce que l'import a fait.
function Bilan({
  analyse,
  importees,
  echecs,
  onFerme,
}: {
  analyse: Analyse;
  importees: number;
  echecs: number;
  onFerme: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-success">
        {t("import.done", { n: importees, lues: analyse.lues })}
      </p>
      {echecs > 0 && (
        <p role="alert" className="text-sm text-danger">
          {t("import.failed", { n: echecs })}
        </p>
      )}
      <Comptes analyse={analyse} />
      <Avertissement texte={t("import.deleteFile")} />
      <Bouton onClick={onFerme}>{t("import.close")}</Bouton>
    </div>
  );
}

/// Le décompte, motif par motif.
///
/// C'est la pièce qui empêche le « import réussi » qui masque des pertes : le
/// nombre lu, le nombre retenu, et chaque rejet sous son motif. Aucune valeur
/// du fichier n'y figure, par construction : `Ignoree` ne porte qu'un numéro.
function Comptes({ analyse }: { analyse: Analyse }) {
  const { t } = useI18n();
  const motifs = parMotif(analyse.ignorees);
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
      <p className="text-sm text-foreground">
        {t("import.summary", {
          lues: analyse.lues,
          aImporter: analyse.aImporter.length,
          ignorees: analyse.ignorees.length,
        })}
      </p>
      {analyse.sansMotDePasse > 0 && (
        <p className="text-xs text-muted">
          {t("import.noPassword", { n: analyse.sansMotDePasse })}
        </p>
      )}
      {motifs.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
          {motifs.map(({ motif, n }) => (
            <li key={motif}>{t(`import.reason.${motif}`, { n })}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
