"use client";

// La pastille d'une entrée : initiale colorée, recouverte du favicon du site
// quand il en existe un.
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
  const taille = grand ? "size-11 text-lg" : "size-8 text-sm";
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-lg font-semibold text-white ${taille}`}
      style={{ background: avatarColor(nom) }}
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
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </span>
  );
}
