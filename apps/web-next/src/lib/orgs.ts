// Les organisations, sans React.
//
// Les types que le serveur renvoie, et la seule règle de décision qui compte
// dans cet écran : qui a le droit d'écrire.

export interface OrgSummary {
  orgId: string;
  name: string;
  role: string;
  status: string;
}

export interface Member {
  userId: string;
  email: string | null;
  publicKey: string | null;
  role: string;
  status: string;
}

/// La permission EFFECTIVE sur la collection, telle que le serveur la calcule :
/// appartenance directe et héritage de rôle confondus.
///
/// Optionnelle à dessein — un serveur antérieur au 2026-08-29 ne l'envoie pas.
/// Son absence vaut refus : mieux vaut cacher une action permise que d'en
/// proposer une que le serveur déclinera, ce qui est exactement ce que faisait
/// l'ancienne interface en offrant « Modifier » aux lecteurs seuls.
export interface Collection {
  id: string;
  name: string;
  permission?: "read" | "write" | "manage";
}

export function peutEcrire(c: Collection | null | undefined): boolean {
  return c?.permission === "write" || c?.permission === "manage";
}

export interface AccesEffectif {
  userId: string;
  email: string | null;
  permission: string;
  sources: Array<{ kind: string; label: string; permission: string }>;
  revocable: boolean;
}
