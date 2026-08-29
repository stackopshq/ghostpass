"use client";

// Sortir le coffre, et y faire entrer un autre.
//
// Deux gestes rares mais décisifs : l'export est le seul endroit du produit où
// des secrets quittent le chiffré, l'import est souvent le tout premier contact
// avec le produit — on arrive de 1Password ou de Bitwarden avec un fichier.

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { encryptItem } from "@/lib/crypto";
import { parseCsv } from "@/lib/csv";
import { depuisLigneCsv, versCsv } from "@/lib/export";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import type { VaultEntry } from "@/lib/vault";
import { Bouton } from "@/components/champs";

export function ImportExport({
  personnels,
  onImporte,
}: {
  // Le nom du champ porte la garantie : on n'exporte que le coffre personnel.
  // Voir `lib/export.ts` — un membre ne décide pas seul de sortir les secrets
  // de son équipe.
  personnels: VaultEntry[];
  onImporte: () => void;
}) {
  const { t } = useI18n();
  const { token, account } = useSession();
  const champ = useRef<HTMLInputElement>(null);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const exporter = () => {
    const blob = new Blob([versCsv(personnels)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ghostpass-export.csv";
    a.click();
    // Libérer tout de suite : l'URL garde le contenu déchiffré en mémoire de
    // l'onglet tant qu'elle vit, et personne ne pense à la révoquer plus tard.
    URL.revokeObjectURL(url);
  };

  const importer = async (fichier: File) => {
    if (!token || !account) return;
    setOccupe(true);
    setMessage(null);
    setErreur(null);
    try {
      const lignes = parseCsv(await fichier.text());
      let n = 0;
      for (const l of lignes) {
        await api.createItem(token, encryptItem(account, depuisLigneCsv(l, t("app.noName"))));
        n++;
      }
      onImporte();
      setMessage(t("app.imported", { n }));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
      // Vider le champ : sans ça, réimporter le MÊME fichier ne déclenche
      // aucun événement et l'utilisateur croit que rien ne s'est passé.
      if (champ.current) champ.current.value = "";
    }
  };

  return (
    <div className="mt-4 space-y-2 border-t border-border pt-4">
      <div className="flex gap-2">
        <Bouton variante="discret" onClick={exporter} disabled={personnels.length === 0}>
          {t("app.exportCsv")}
        </Bouton>
        <Bouton variante="discret" onClick={() => champ.current?.click()} disabled={occupe}>
          {t("app.importCsv")}
        </Bouton>
        <input
          ref={champ}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          aria-label={t("app.importCsv")}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importer(f);
          }}
        />
      </div>
      {/* La portée de l'export, écrite là où on clique. Un fichier qui ne
          contient pas ce qu'on croyait se découvre trop tard. */}
      <p className="text-2xs text-muted">{t("app.exportPersonalOnly")}</p>
      <p className="text-2xs text-muted">{t("app.importCols")}</p>
      {message && <p className="text-2xs text-success">{message}</p>}
      {erreur && (
        <p role="alert" className="text-2xs text-danger">
          {erreur}
        </p>
      )}
    </div>
  );
}
