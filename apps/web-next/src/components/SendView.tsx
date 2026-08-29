"use client";

// L'écran qui ouvre un secret partagé par lien.
//
// Le déchiffrement a lieu ici et nulle part ailleurs : la clé voyage dans le
// FRAGMENT de l'URL, que le navigateur n'envoie jamais au serveur. C'est ce qui
// fait que le serveur ne peut pas lire ce qu'il stocke, et c'est pourquoi ce
// composant lit `location.hash` plutôt qu'un paramètre de route.
//
// L'IDENTIFIANT AUSSI VIENT DE L'URL, ET NON D'UN PARAMÈTRE DE ROUTE
// ------------------------------------------------------------------
// L'interface est exportée en fichiers statiques : la route `/s/[id]` ne
// produit qu'un seul fichier, servi pour tous les identifiants. Le paramètre
// de route vaudrait donc partout la même valeur de gabarit. On lit le chemin
// réel du navigateur, qui est la seule source juste.

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { openSend } from "@/lib/send";
import { Alerte, Cadenas, Coche, Copier, Oeil, OeilBarre } from "@/components/Icones";

type Etat = "chargement" | "ouvert" | "echec";

export function SendView() {
  const { t } = useI18n();
  const [id, setId] = useState("");
  const [etat, setEtat] = useState<Etat>("chargement");
  const [secret, setSecret] = useState("");
  const [devoile, setDevoile] = useState(false);
  const [copie, setCopie] = useState(false);

  useEffect(() => {
    setId(decodeURIComponent(location.pathname.replace(/^\/s\//, "").replace(/\/$/, "")));
  }, []);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const fragment = location.hash.replace(/^#/, "");
        if (!fragment) throw new Error("lien incomplet");
        const { ciphertext, iv } = await api.getSend(id);
        setSecret(await openSend(ciphertext, iv, fragment));
        setEtat("ouvert");
      } catch {
        // Une seule issue d'erreur, volontairement : distinguer « lien inconnu »
        // de « clé fausse » dirait à qui tâtonne s'il approche.
        setEtat("echec");
      }
    })();
  }, [id]);

  async function copier() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopie(true);
      setTimeout(() => setCopie(false), 1200);
    } catch {
      /* presse-papiers indisponible — rien à dire de plus à l'utilisateur */
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-8">
      <div className="w-full max-w-[440px] rounded-lg border border-border bg-surface p-6">
        <span className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <Cadenas className="size-5 text-accent" />
          GhostPass
        </span>

        {etat === "chargement" && <p className="mt-5 text-sm text-muted">{t("send.decrypting")}</p>}

        {etat === "echec" && (
          <div className="mt-5 flex items-center gap-2 rounded border border-border-strong px-3 py-2 text-sm text-muted">
            <Alerte className="size-4 shrink-0" />
            <span>{t("send.invalid")}</span>
          </div>
        )}

        {etat === "ouvert" && (
          <>
            <p className="mt-5 mb-2 text-sm text-muted">{t("send.intro")}</p>
            <div className="flex items-center gap-2 rounded border border-border bg-surface-2 px-3 py-2">
              <span className={`grow font-mono text-sm break-all whitespace-pre-wrap ${devoile ? "text-foreground" : "text-muted"}`}>
                {devoile ? secret : "••••••••••••"}
              </span>
              <button
                type="button"
                title={devoile ? t("send.hide") : t("send.show")}
                aria-label={t("send.toggleReveal")}
                onClick={() => setDevoile((v) => !v)}
                className="cursor-pointer rounded p-1 text-muted transition-colors hover:text-foreground"
              >
                {devoile ? <OeilBarre className="size-4" /> : <Oeil className="size-4" />}
              </button>
              <button
                type="button"
                title={t("send.copy")}
                aria-label={t("send.copy")}
                onClick={copier}
                className={`cursor-pointer rounded p-1 transition-colors ${copie ? "text-accent" : "text-muted hover:text-foreground"}`}
              >
                {copie ? <Coche className="size-4" /> : <Copier className="size-4" />}
              </button>
            </div>
            <p className="mt-3 text-xs text-muted">{t("send.local")}</p>
          </>
        )}
      </div>
    </main>
  );
}
