"use client";

// La surveillance du coffre : un score, la robustesse d'ensemble, et une carte
// par défaut à corriger, chacune menant aux éléments concernés.
//
// Tout est calculé dans l'onglet (`lib/surveillance.ts`). Un seul appel sort :
// la vérification des fuites, en k-anonymat, et seulement quand on la lance.
// Elle n'est pas automatique parce qu'elle interroge un service tiers ; même
// s'il ne reçoit que le début d'une empreinte, c'est à la personne d'en décider.

import { useEffect, useMemo, useState } from "react";
import { pwnedCount } from "@/lib/breach";
import { useI18n } from "@/lib/i18n";
import {
  appreciation,
  constater,
  dansLAnnuaire,
  hoteDe,
  score as calculerScore,
  type Annuaire,
} from "@/lib/surveillance";
import type { VaultEntry } from "@/lib/vault";
import { Avatar } from "@/components/Avatar";
import { Bouton } from "@/components/champs";
import { Chevron } from "@/components/Icones";

type CleDeCarte =
  | "reutilises"
  | "faibles"
  | "nonSecurises"
  | "compromis"
  | "cartes"
  | "clesDisponibles"
  | "totpDisponible";

/// Les teintes de la jauge et de la barre, du plus faible au plus fort. La
/// couleur double l'information, elle ne la porte pas seule : la barre a sa
/// légende, la jauge son nombre et son mot.
const TEINTES_FORCE = ["bg-danger", "bg-danger/60", "bg-warn", "bg-success/60", "bg-success"];
const TEINTE_APPRECIATION = {
  excellent: "var(--color-success)",
  bon: "var(--color-success)",
  moyen: "var(--color-warn)",
  faible: "var(--color-danger)",
} as const;

function Jauge({ valeur }: { valeur: number | null }) {
  const { t } = useI18n();
  // Un arc de 240° : la jauge se lit d'un coup d'œil, et le nombre tient au centre.
  const rayon = 52;
  const circonference = 2 * Math.PI * rayon;
  const arc = (circonference * 240) / 360;
  const plein = valeur === null ? 0 : (arc * valeur) / 100;
  const mot = valeur === null ? null : appreciation(valeur);
  return (
    <div className="relative grid size-36 shrink-0 place-items-center">
      <svg viewBox="0 0 120 120" className="absolute inset-0 rotate-[150deg]" aria-hidden="true">
        <circle cx="60" cy="60" r={rayon} fill="none" stroke="var(--color-border)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${arc} ${circonference}`} />
        {mot && (
          <circle cx="60" cy="60" r={rayon} fill="none" stroke={TEINTE_APPRECIATION[mot]} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${plein} ${circonference}`} />
        )}
      </svg>
      <div className="text-center">
        <p className="text-2xl font-semibold tabular-nums text-foreground">{valeur ?? "-"}</p>
        <p className="text-2xs uppercase tracking-widest text-muted">
          {mot ? t(`watch.grade.${mot}`) : t("watch.grade.none")}
        </p>
      </div>
    </div>
  );
}

export function Surveillance({
  items,
  onOuvrir,
}: {
  /// Les éléments courants : l'archive est déjà retirée par l'appelant.
  items: VaultEntry[];
  onOuvrir: (item: VaultEntry) => void;
}) {
  const { t } = useI18n();
  const [annuaire, setAnnuaire] = useState<Annuaire | null>(null);
  const [ouverte, setOuverte] = useState<CleDeCarte | null>(null);
  // `null` : pas encore vérifié. On ne présente pas « 0 compromis » avant
  // d'avoir regardé, ce serait rassurer sans savoir.
  const [compromis, setCompromis] = useState<Set<string> | null>(null);
  const [verification, setVerification] = useState<{ fait: number; total: number } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    // Servi avec l'interface, même origine : le lire ne dit rien à personne.
    fetch("/annuaire-2fa.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((a) => vivant && setAnnuaire(a))
      .catch(() => {
        /* Sans annuaire, les deux cartes qui en dépendent restent absentes. */
      });
    return () => {
      vivant = false;
    };
  }, []);

  const constat = useMemo(() => constater(items, annuaire), [items, annuaire]);
  const valeur = calculerScore(constat, compromis ?? new Set());
  const elementsCompromis = useMemo(
    () => (compromis ? items.filter((i) => compromis.has(i.id)) : []),
    [items, compromis],
  );

  /// Chaque mot de passe DISTINCT n'est vérifié qu'une fois : un mot de passe
  /// réutilisé sur dix sites ne fait pas dix requêtes.
  const verifierLesFuites = async () => {
    const parMotDePasse = new Map<string, string[]>();
    for (const i of items) {
      if (i.kind !== "login" || !i.password) continue;
      parMotDePasse.set(i.password, [...(parMotDePasse.get(i.password) ?? []), i.id]);
    }
    const lots = [...parMotDePasse.entries()];
    const trouves = new Set<string>();
    setErreur(null);
    setVerification({ fait: 0, total: lots.length });
    try {
      for (let n = 0; n < lots.length; n++) {
        const [motDePasse, ids] = lots[n]!;
        if ((await pwnedCount(motDePasse)) > 0) ids.forEach((id) => trouves.add(id));
        setVerification({ fait: n + 1, total: lots.length });
      }
      setCompromis(trouves);
      if (trouves.size > 0) setOuverte("compromis");
    } catch {
      setErreur(t("watch.breachFailed"));
    } finally {
      setVerification(null);
    }
  };

  const cartes: {
    cle: CleDeCarte;
    elements: VaultEntry[];
    alerte: boolean;
    /// Une carte qui expire bientôt est à prévoir, pas une faute : orange.
    /// Le rouge est réservé à ce qui est déjà en défaut.
    teinte?: "text-danger" | "text-warn";
    action?: React.ReactNode;
  }[] = [
    { cle: "reutilises", elements: constat.reutilises, alerte: true },
    { cle: "faibles", elements: constat.faibles, alerte: true },
    { cle: "nonSecurises", elements: constat.nonSecurises, alerte: true },
    {
      cle: "compromis",
      elements: elementsCompromis,
      alerte: true,
      action:
        compromis === null || verification ? (
          <Bouton variante="discret" onClick={() => void verifierLesFuites()} disabled={verification !== null}>
            {verification
              ? t("watch.checking", { fait: verification.fait, total: verification.total })
              : t("watch.check")}
          </Bouton>
        ) : undefined,
    },
    ...(constat.aDesCartes
      ? [
          {
            cle: "cartes" as const,
            elements: constat.cartes.map((c) => c.item),
            alerte: true,
            teinte: constat.cartes.some((c) => c.etat === "expiree") ? ("text-danger" as const) : ("text-warn" as const),
          },
        ]
      : []),
    ...(annuaire
      ? [
          { cle: "clesDisponibles" as const, elements: constat.clesDisponibles, alerte: false },
          { cle: "totpDisponible" as const, elements: constat.totpDisponible, alerte: false },
        ]
      : []),
  ];

  const total = constat.repartition.reduce((a, b) => a + b, 0);
  const liste = cartes.find((c) => c.cle === ouverte);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-6">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-foreground">{t("app.watch")}</h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">{t("watch.intro")}</p>
          </div>
          <Jauge valeur={valeur} />
        </div>

        <section className="carte p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">{t("watch.strength")}</h3>
          {total === 0 ? (
            <p className="text-xs text-muted">{t("watch.noLogins")}</p>
          ) : (
            <>
              <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-pill">
                {constat.repartition.map((n, niveau) =>
                  n === 0 ? null : (
                    <span key={niveau} className={TEINTES_FORCE[niveau]} style={{ flexGrow: n }} title={`${t(["strength.veryWeak", "strength.weak", "strength.fair", "strength.good", "strength.veryGood"][niveau]!)} : ${n}`} />
                  ),
                )}
              </div>
              <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted">
                {constat.repartition.map((n, niveau) => (
                  <li key={niveau} className="flex items-center gap-1.5">
                    <span className={`size-2 rounded-pill ${TEINTES_FORCE[niveau]}`} />
                    {t(["strength.veryWeak", "strength.weak", "strength.fair", "strength.good", "strength.veryGood"][niveau]!)} : {n}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {erreur && <p role="alert" className="text-sm text-danger">{erreur}</p>}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cartes.map((c) => {
            const inconnu = c.cle === "compromis" && compromis === null;
            const probleme = c.alerte && c.elements.length > 0;
            return (
              <section
                key={c.cle}
                className={`carte flex flex-col overflow-hidden ${ouverte === c.cle ? "ring-2 ring-accent/40" : ""}`}
              >
                <div className="flex-1 p-4">
                  <p className={`text-2xl font-semibold tabular-nums ${probleme ? (c.teinte ?? "text-danger") : "text-foreground"}`}>
                    {inconnu ? "?" : c.elements.length}
                  </p>
                  <h3 className="mt-1 text-sm font-semibold text-foreground">{t(`watch.${c.cle}.title`)}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{t(`watch.${c.cle}.text`)}</p>
                </div>
                <div className="border-t border-border px-4 py-2.5">
                  {c.action ?? (
                    <button
                      type="button"
                      disabled={c.elements.length === 0}
                      onClick={() => setOuverte(ouverte === c.cle ? null : c.cle)}
                      aria-expanded={ouverte === c.cle}
                      className="flex w-full cursor-pointer items-center justify-between text-sm text-accent disabled:cursor-default disabled:text-muted"
                    >
                      {t("watch.show")}
                      <Chevron className={`size-4 transition-transform ${ouverte === c.cle ? "rotate-90" : ""}`} />
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        {liste && liste.elements.length > 0 && (
          <section className="carte p-2">
            <h3 className="px-2 pb-2 pt-1 text-sm font-semibold text-foreground">{t(`watch.${liste.cle}.title`)}</h3>
            {liste.elements.map((item) => {
              const hote = item.urls.map(hoteDe).find((h): h is string => h !== null);
              const carte = liste.cle === "cartes" ? constat.cartes.find((c) => c.item.id === item.id) : undefined;
              const doc =
                liste.cle === "totpDisponible" && annuaire && hote
                  ? dansLAnnuaire(annuaire.documentation, hote)
                  : undefined;
              return (
                <div key={item.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface">
                  <button
                    type="button"
                    onClick={() => onOuvrir(item)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                  >
                    <Avatar nom={item.name} url={item.urls[0]} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm text-foreground">{item.name}</span>
                      {carte ? (
                        <span className={`truncate text-xs ${carte.etat === "expiree" ? "text-danger" : "text-warn"}`}>
                          {t(carte.etat === "expiree" ? "watch.cartes.expired" : "watch.cartes.soon", { date: item.cardExp ?? "" })}
                        </span>
                      ) : (
                        <span className="truncate text-xs text-muted">{item.username || hote}</span>
                      )}
                    </span>
                  </button>
                  {doc && (
                    // Le lien part de la page de l'éditeur du site, pas d'ici :
                    // l'ouvrir est un geste de la personne, qui sait où elle va.
                    <a href={doc} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-accent hover:underline">
                      {t("watch.howTo")}
                    </a>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {annuaire && (
          <p className="text-2xs leading-relaxed text-muted">
            {t("watch.directory", { date: annuaire.genere })}{" "}
            {annuaire.sources.map((s, n) => (
              <span key={s.url}>
                {n > 0 && ", "}
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                  {s.nom}
                </a>{" "}
                ({s.licence})
              </span>
            ))}
            .
          </p>
        )}
      </div>
    </div>
  );
}
