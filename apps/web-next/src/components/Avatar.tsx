"use client";

// La pastille d'une entrée : une tuile blanche, le favicon du site posé au
// centre, ou l'initiale de l'entrée dans sa couleur quand il n'y en a pas.
//
// UNE TUILE BLANCHE POUR TOUS
// Les favicons ne se ressemblent en rien : certains remplissent leur carré,
// d'autres sont un logo sur fond transparent, conçu pour un fond clair. Posés
// à nu sur le thème sombre, les seconds disparaissaient et les premiers
// formaient des blocs de toutes tailles. Une même tuile blanche, avec une
// marge autour du logo, les rend tous lisibles et de même poids, comme une
// grille d'applications.
//
// L'initiale est en dessous, pas en repli conditionnel : si l'image tarde ou
// échoue, la case ne clignote pas et ne reste jamais vide.

import { useState } from "react";
import { faviconUrl } from "@/lib/crypto";
import { useSession } from "@/lib/session";
import { avatarColor } from "@/lib/vault";

export function Avatar({ nom, url, grand = false }: { nom: string; url?: string; grand?: boolean }) {
  const [cassee, setCassee] = useState(false);
  const { jetonIcone } = useSession();
  const src = url ? faviconUrl(url, jetonIcone) : "";
  // Les rayons du thème, choisis pour un coin d'environ un quart du côté, celui
  // des tuiles d'application ; `rounded-lg` (18 px) arrondissait la petite en cercle.
  const taille = grand ? "size-11 rounded text-lg" : "size-8 rounded-sm text-sm";
  const marge = grand ? "p-2" : "p-1.5";
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden border border-black/5 bg-white font-semibold shadow-sm ${taille}`}
      style={{ color: avatarColor(nom) }}
      aria-hidden="true"
    >
      {(nom || "?").charAt(0).toUpperCase()}
      {src && !cassee && (
        // eslint-disable-next-line @next/next/no-img-element -- domaine tiers, pas d'optimisation Next
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setCassee(true)}
          // Fond blanc sous l'image : un logo transparent laisserait voir
          // l'initiale au travers.
          className={`absolute inset-0 size-full bg-white object-contain ${marge}`}
        />
      )}
    </span>
  );
}
