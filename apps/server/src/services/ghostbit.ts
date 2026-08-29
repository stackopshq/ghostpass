// Le relais vers ghostbit, le service de paste chiffré de la suite.
//
// **Pourquoi un relais et non un appel direct du navigateur.** Ghostbit
// n'expose aucun CORS — pas de `CORSMiddleware`, pas d'`allow_origins`. Son
// interface et son CLI fonctionnent parce qu'ils sont en même origine ou hors
// navigateur. Plutôt que d'ouvrir une surface navigateur sur un service de
// paste public, GhostPass transmet de serveur à serveur.
//
// **Ce que ce relais voit.** Du chiffré, et rien d'autre. La clé AES vit dans
// le fragment de l'URL, côté destinataire ; elle n'atteint ni ce serveur ni
// celui de ghostbit. La connaissance nulle est donc exactement celle d'avant :
// on a remplacé un stockage par un transfert, sans rien déchiffrer au passage.
//
// **Pourquoi déléguer.** Ghostbit sait révoquer (jeton de suppression rendu à
// la création, stocké haché), expirer à la seconde, brûler à la lecture, et
// protéger par mot de passe. Le partage de GhostPass ne savait rien de tout
// cela : c'était une version appauvrie du même mécanisme, logée dans le
// gestionnaire de mots de passe.

/// L'instance visée. En configuration, jamais en dur : l'instance
/// auto-hébergée, et surtout pas la démo publique.
export function ghostbitBaseUrl(): string {
  return (process.env.GHOSTBIT_URL ?? "").trim().replace(/\/+$/, "");
}

export function ghostbitConfigured(): boolean {
  return ghostbitBaseUrl().length > 0;
}

export interface PartageCree {
  id: string;
  url: string;
  deleteToken: string;
  expiresAt: number | null;
}

/// Crée un paste chiffré chez ghostbit et rend de quoi le partager ET le
/// révoquer.
///
/// Le `deleteToken` remonte au client, qui le range dans son registre chiffré.
/// Ce serveur ne le conserve pas : le garder ferait de lui le détenteur d'un
/// pouvoir de révocation sur des partages qu'il ne peut pas lire, ce qui est
/// exactement le genre de métadonnée que le produit promet de ne pas avoir.
export async function creerPartage(args: {
  ciphertext: string;
  nonce: string;
  expiresInSeconds: number;
  maxViews: number;
}): Promise<PartageCree> {
  const base = ghostbitBaseUrl();
  if (!base) throw new Error("GHOSTBIT_URL non configurée");

  const res = await fetch(`${base}/api/v1/pastes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: args.ciphertext,
      nonce: args.nonce,
      expires_in: args.expiresInSeconds,
      // `burn` et `max_views` disent la même chose à une vue près : `burn`
      // supprime à la première lecture, `max_views` compte. On envoie l'un OU
      // l'autre — les envoyer tous deux laisserait ghostbit arbitrer, et ce
      // n'est pas à lui de deviner ce qu'on voulait.
      ...(args.maxViews === 1 ? { burn: true } : args.maxViews > 0 ? { max_views: args.maxViews } : {}),
    }),
  });

  if (!res.ok) {
    // On ne relaie pas le corps de ghostbit tel quel : il est écrit pour son
    // propre client et parlerait de « paste » à quelqu'un qui partage un mot
    // de passe.
    throw new Error(`ghostbit a refusé la création (${res.status})`);
  }

  const data = (await res.json()) as {
    id: string;
    url: string;
    delete_token: string;
    expires_at: number | null;
  };
  return {
    id: data.id,
    url: data.url,
    deleteToken: data.delete_token,
    expiresAt: data.expires_at,
  };
}

/// Révoque un partage. Idempotente du point de vue de l'appelant : ghostbit
/// rend 403 aussi bien pour un jeton faux que pour un paste absent ou expiré —
/// délibérément, pour qu'on ne puisse pas énumérer les identifiants. On ne
/// distingue donc pas non plus, et « c'est fait » couvre les trois cas.
export async function revoquerPartage(id: string, deleteToken: string): Promise<void> {
  const base = ghostbitBaseUrl();
  if (!base) throw new Error("GHOSTBIT_URL non configurée");
  await fetch(`${base}/api/v1/pastes/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "x-delete-token": deleteToken },
  });
}
