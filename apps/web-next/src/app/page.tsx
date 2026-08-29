"use client";

// Page d'épreuve, temporaire. Elle répond à deux questions avant qu'on porte
// 3 000 lignes dessus : le noyau WebAssembly démarre-t-il, et Tailwind rend-il
// bien les jetons du thème généré plutôt que ses propres valeurs par défaut ?
//
// La seconde n'est pas une évidence : si le pont `@theme` était mal écrit,
// `text-sm` rendrait la valeur par défaut de Tailwind et non la marche de la
// suite. La page serait jolie et fausse — le pire des deux.

import { useEffect, useState } from "react";
import { ensureCryptoReady } from "@/lib/crypto";

export default function Epreuve() {
  const [wasm, setWasm] = useState("chargement…");
  const [mesures, setMesures] = useState<string[]>([]);

  useEffect(() => {
    ensureCryptoReady()
      .then(() => setWasm("le noyau WebAssembly a démarré"))
      .catch((e: unknown) => setWasm(`échec : ${e instanceof Error ? e.message : String(e)}`));

    const lu = getComputedStyle(document.documentElement);
    setMesures([
      `--text-sm=${lu.getPropertyValue("--text-sm").trim()}`,
      `--color-accent=${lu.getPropertyValue("--color-accent").trim()}`,
    ]);
  }, []);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold text-foreground">GhostPass</h1>
      <p data-test="wasm" className="mt-2 text-sm text-muted">{wasm}</p>
      <p data-test="jetons" className="mt-1 text-xs text-muted">{mesures.join("  ")}</p>
      <button
        data-test="bouton"
        className="mt-4 rounded bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
      >
        Un bouton dans la couleur du produit
      </button>
    </main>
  );
}
