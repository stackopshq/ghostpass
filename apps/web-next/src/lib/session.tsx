"use client";

// La session : qui est connecté, et avec quelles clés.
//
// **Le compte déverrouillé ne quitte jamais la mémoire de l'onglet.** Il porte
// les clés en clair ; l'écrire dans `localStorage` le rendrait lisible par tout
// script de la page et survivrait à la fermeture. C'est le jeton d'API qui est
// persisté, pas le déchiffrement — fermer l'onglet doit reverrouiller le coffre.
//
// Cette frontière est la même que celle convenue avec l'application mobile : le
// cœur rend un objet opaque, la plateforme décide où il dort. Le navigateur a
// choisi « nulle part ».

import type { Account } from "ghostpass-crypto-wasm";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type Session = {
  token: string | null;
  account: Account | null;
  ouvrir: (token: string, account: Account) => void;
  fermer: () => void;
};

const Ctx = createContext<Session | null>(null);

export function useSessionValue(): Session {
  const [token, setToken] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);

  const ouvrir = useCallback((t: string, a: Account) => {
    setToken(t);
    setAccount(a);
  }, []);

  const fermer = useCallback(() => {
    // `free()` rend la mémoire du WebAssembly, où vivent les clés. Sans lui,
    // elles resteraient dans le tas jusqu'au ramasse-miettes — c'est-à-dire un
    // moment que personne ne choisit.
    account?.free();
    setAccount(null);
    setToken(null);
  }, [account]);

  return useMemo(() => ({ token, account, ouvrir, fermer }), [token, account, ouvrir, fermer]);
}

export const SessionContext = Ctx;

export function useSession(): Session {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession hors de son fournisseur");
  return v;
}
