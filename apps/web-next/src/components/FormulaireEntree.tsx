"use client";

// Le formulaire d'une entrée : création et modification, même écran.
//
// Le chiffrement a lieu ici, dans l'onglet, avant l'appel réseau : ce qui part
// est une enveloppe. C'est aussi ici qu'est archivé l'ancien mot de passe quand
// il change, pour qu'un changement fait par erreur ne soit pas irréversible.

import { useState } from "react";
import type { ItemKind } from "@/lib/crypto";
import { DEFAULT_GEN_OPTIONS, generatePassword, type GenOptions } from "@/lib/generator";
import { useI18n } from "@/lib/i18n";
import type { VaultEntry } from "@/lib/vault";
import { Bouton, BoutonIcone, Champ, Saisie, Zone } from "@/components/champs";
import { De, Oeil, OeilBarre, Reglages } from "@/components/Icones";

/// Ce que le formulaire rend à son appelant. Il ne chiffre pas et n'appelle pas
/// le réseau lui-même : il décrit une entrée, et l'écran qui le porte décide
/// quoi en faire. C'est ce qui le rend éprouvable sans montrer une session.
export interface SaisieEntree {
  kind: ItemKind;
  name: string;
  folder: string;
  username: string;
  password: string;
  url: string;
  totp: string;
  note: string;
  cardholder: string;
  cardNumber: string;
  cardExp: string;
  cardCode: string;
}

const VIDE: SaisieEntree = {
  kind: "login", name: "", folder: "", username: "", password: "", url: "",
  totp: "", note: "", cardholder: "", cardNumber: "", cardExp: "", cardCode: "",
};

/// Une saisie vierge. Exportée pour que l'appelant puisse en pré-remplir un
/// champ — le dossier ouvert, typiquement — sans connaître la forme complète.
export function vide(): SaisieEntree {
  return { ...VIDE };
}

export function depuisEntree(e: VaultEntry): SaisieEntree {
  return {
    kind: e.kind, name: e.name, folder: e.folder, username: e.username,
    password: e.password, url: e.url, totp: e.totp, note: e.note,
    cardholder: e.cardholder, cardNumber: e.cardNumber,
    cardExp: e.cardExp, cardCode: e.cardCode,
  };
}

export function FormulaireEntree({
  initial,
  edition,
  occupe,
  chemins,
  onValider,
  onAnnuler,
}: {
  initial?: SaisieEntree;
  edition: boolean;
  occupe: boolean;
  chemins: string[];
  onValider: (v: SaisieEntree) => void;
  onAnnuler: () => void;
}) {
  const { t } = useI18n();
  const [v, setV] = useState<SaisieEntree>(initial ?? VIDE);
  const [motVisible, setMotVisible] = useState(false);
  const [options, setOptions] = useState<GenOptions>({ ...DEFAULT_GEN_OPTIONS });
  const [optionsOuvertes, setOptionsOuvertes] = useState(false);

  const maj = <K extends keyof SaisieEntree>(k: K, val: SaisieEntree[K]) =>
    setV((p) => ({ ...p, [k]: val }));

  // Régénérer à chaque réglage : sinon on déplace un curseur sans rien voir
  // changer, et il faut deviner qu'un second geste est attendu.
  const engendrer = (o: GenOptions = options) => {
    setOptions(o);
    maj("password", generatePassword(o));
    setMotVisible(true);
  };

  const genres: { k: ItemKind; cle: string }[] = [
    { k: "login", cle: "app.kindLogin" },
    { k: "note", cle: "app.kindNote" },
    { k: "card", cle: "app.kindCard" },
  ];

  return (
    <form
      aria-label={edition ? t("app.edit") : t("app.newItem")}
      className="max-w-lg p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onValider(v);
      }}
    >
      <div className="mb-4 flex gap-1 rounded border border-border p-1" role="group">
        {genres.map(({ k, cle }) => (
          <button
            key={k}
            type="button"
            onClick={() => maj("kind", k)}
            aria-pressed={v.kind === k}
            className={`flex-1 cursor-pointer rounded px-3 py-1.5 text-sm transition ${v.kind === k ? "bg-accent text-accent-ink" : "text-muted hover:text-foreground"}`}
          >
            {t(cle)}
          </button>
        ))}
      </div>

      <Champ label={t("app.name")}>
        <Saisie value={v.name} onChange={(e) => maj("name", e.target.value)} placeholder="GitHub" required />
      </Champ>

      <Champ label={`${t("app.folder")} ${t("app.folderHint")}`}>
        <Saisie
          value={v.folder}
          onChange={(e) => maj("folder", e.target.value)}
          placeholder={t("app.folderExample")}
          list="gp-dossiers-form"
        />
        <datalist id="gp-dossiers-form">
          {chemins.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </Champ>

      {v.kind === "login" && (
        <>
          <Champ label={t("app.website")}>
            <Saisie value={v.url} onChange={(e) => maj("url", e.target.value)} placeholder="github.com" inputMode="url" />
          </Champ>
          <Champ label={t("app.kindLogin")}>
            <Saisie value={v.username} onChange={(e) => maj("username", e.target.value)} placeholder="kevin" />
          </Champ>

          <div className="mb-3 flex flex-col gap-1">
            <span className="text-xs text-muted">{t("app.password")}</span>
            <div className="flex items-center gap-1">
              <Saisie
                type={motVisible ? "text" : "password"}
                value={v.password}
                onChange={(e) => maj("password", e.target.value)}
                placeholder="••••••"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <BoutonIcone
                onClick={() => setMotVisible((x) => !x)}
                title={motVisible ? t("app.hide") : t("app.show")}
                aria-label={motVisible ? t("app.hide") : t("app.show")}
                aria-pressed={motVisible}
              >
                {motVisible ? <OeilBarre className="size-4" /> : <Oeil className="size-4" />}
              </BoutonIcone>
              <BoutonIcone onClick={() => engendrer()} title={t("app.genPassword")} aria-label={t("app.generate")}>
                <De className="size-4" />
              </BoutonIcone>
              <BoutonIcone
                onClick={() => setOptionsOuvertes((x) => !x)}
                actif={optionsOuvertes}
                aria-expanded={optionsOuvertes}
                title={t("app.genOptions")}
                aria-label={t("app.options")}
              >
                <Reglages className="size-4" />
              </BoutonIcone>
            </div>

            {optionsOuvertes && (
              <div className="mt-2 rounded border border-border bg-surface-2 p-3">
                <label className="flex items-center gap-2 text-xs text-muted">
                  {t("app.length")} <strong className="tabular-nums text-foreground">{options.length}</strong>
                  <input
                    type="range"
                    min={8}
                    max={64}
                    value={options.length}
                    onChange={(e) => engendrer({ ...options, length: Number(e.target.value) })}
                    className="flex-1 accent-accent"
                  />
                </label>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
                  {([
                    ["lowercase", "a-z"],
                    ["uppercase", "A-Z"],
                    ["digits", "0-9"],
                    ["symbols", "!@#"],
                  ] as const).map(([cle, etiquette]) => (
                    <label key={cle} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={options[cle]}
                        onChange={(e) => engendrer({ ...options, [cle]: e.target.checked })}
                        className="accent-accent"
                      />
                      {etiquette}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Champ label={`${t("app.totpKey")} ${t("app.totpHint")}`}>
            <Saisie value={v.totp} onChange={(e) => maj("totp", e.target.value)} placeholder="JBSWY3DPEHPK3PXP" autoComplete="off" />
          </Champ>
        </>
      )}

      {v.kind === "note" && (
        <Champ label={t("app.content")}>
          <Zone value={v.note} onChange={(e) => maj("note", e.target.value)} rows={6} placeholder={t("app.notePh")} />
        </Champ>
      )}

      {v.kind === "card" && (
        <>
          <Champ label={t("app.cardholder")}>
            <Saisie value={v.cardholder} onChange={(e) => maj("cardholder", e.target.value)} placeholder="Jean Dupont" />
          </Champ>
          <Champ label={t("app.cardNumber")}>
            <Saisie value={v.cardNumber} onChange={(e) => maj("cardNumber", e.target.value)} inputMode="numeric" placeholder="4111 1111 1111 1111" />
          </Champ>
          <div className="grid grid-cols-2 gap-3">
            <Champ label={t("app.cardExp")}>
              <Saisie value={v.cardExp} onChange={(e) => maj("cardExp", e.target.value)} placeholder="12/30" />
            </Champ>
            <Champ label={t("app.cardCvv")}>
              <Saisie value={v.cardCode} onChange={(e) => maj("cardCode", e.target.value)} inputMode="numeric" placeholder="123" />
            </Champ>
          </div>
        </>
      )}

      {/* La note d'un identifiant ou d'une carte, éditable comme le reste.
          L'afficher sans pouvoir la corriger ferait d'une note importée depuis
          un autre gestionnaire une donnée qu'on subit. Le type « note » a son
          propre champ de contenu, juste au-dessus. */}
      {v.kind !== "note" && (
        <Champ label={t("app.secureNote")}>
          <Zone value={v.note} onChange={(e) => maj("note", e.target.value)} rows={3} placeholder={t("app.notePh")} />
        </Champ>
      )}

      <div className="mt-4 flex gap-2">
        <Bouton type="submit" disabled={occupe}>
          {edition ? t("app.save") : t("app.encryptAndSave")}
        </Bouton>
        <Bouton type="button" variante="discret" onClick={onAnnuler}>
          {t("app.cancel")}
        </Bouton>
      </div>
    </form>
  );
}
