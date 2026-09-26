// Rouvrir un coffre avec son kit de récupération.
//
// TOUT existait sauf cet enchaînement : les trois routes serveur
// (`/api/account/recovery`, `/api/auth/recovery-blob`, `/api/auth/recover`), les trois
// fonctions clientes dans `api.ts`, et `recoverAccount` qui fait la cryptographie. Seuls
// `api.recoveryBlob` et `api.recover` n'avaient AUCUN appelant : on pouvait donc créer un
// kit de récupération, le noter soigneusement, et ne jamais s'en servir — le seul écran
// qui aurait pu le lire n'était pas écrit.
//
// Cette fonction vit ici et non dans le composant pour qu'elle soit éprouvable sans rendu :
// c'est l'enchaînement qui porte les décisions, pas l'affichage.

/// Les trois dépendances extérieures, injectées pour que le test n'ait besoin ni de réseau
/// ni du module WASM.
export interface DependancesDeRecuperation {
  lireLesBlobs(email: string): Promise<{
    kdfParams: string;
    encryptedUserKeyRecovery: string;
    encryptedPrivateKey: string;
  }>;
  rouvrir(
    cleDeRecuperation: string,
    email: string,
    nouveauMotDePasse: string,
    kdfParams: string,
    encryptedUserKeyRecovery: string,
    encryptedPrivateKey: string,
  ): { masterPasswordHash: string; recoveryAuthHash: string; encryptedUserKey: string };
  reinitialiser(corps: {
    email: string;
    recoveryAuthHash: string;
    newMasterPasswordHash: string;
    newEncryptedUserKey: string;
  }): Promise<unknown>;
}

export interface SaisieDeRecuperation {
  email: string;
  cleDeRecuperation: string;
  nouveauMotDePasse: string;
}

/// Le motif d'échec, en une valeur — pour que l'appelant choisisse la phrase et que le test
/// mesure la décision plutôt que le texte.
export type MotifDEchec = "champ-vide" | "cle-refusee" | "reseau";

export class EchecDeRecuperation extends Error {
  constructor(readonly motif: MotifDEchec) {
    super(motif);
    this.name = "EchecDeRecuperation";
  }
}

export async function recupererLeCoffre(
  deps: DependancesDeRecuperation,
  saisie: SaisieDeRecuperation,
): Promise<void> {
  const email = saisie.email.trim();
  const cle = saisie.cleDeRecuperation.trim();
  if (!email || !cle || !saisie.nouveauMotDePasse) throw new EchecDeRecuperation("champ-vide");

  // Le serveur répond TOUJOURS, même pour un compte inexistant ou sans kit : il sert alors
  // un leurre déterministe, indistinguable d'une vraie réponse. C'est voulu — sans ça, cette
  // route dirait qui a un compte chez nous. La conséquence pour ce code est qu'un blob reçu
  // ne prouve rien, et que le seul verdict vient de la tentative de déchiffrement.
  let blobs;
  try {
    blobs = await deps.lireLesBlobs(email);
  } catch {
    throw new EchecDeRecuperation("reseau");
  }

  // Ici échouent AUSSI BIEN une mauvaise clé qu'un leurre. Les deux doivent donner la même
  // phrase, sans quoi la distinction qu'on vient de masquer côté serveur reviendrait par
  // l'interface.
  let reset;
  try {
    reset = deps.rouvrir(
      cle,
      email,
      saisie.nouveauMotDePasse,
      blobs.kdfParams,
      blobs.encryptedUserKeyRecovery,
      blobs.encryptedPrivateKey,
    );
  } catch {
    throw new EchecDeRecuperation("cle-refusee");
  }

  try {
    await deps.reinitialiser({
      email,
      recoveryAuthHash: reset.recoveryAuthHash,
      newMasterPasswordHash: reset.masterPasswordHash,
      newEncryptedUserKey: reset.encryptedUserKey,
    });
  } catch (e) {
    // Le serveur refait la vérification de son côté et répond 401 sur une clé invalide.
    // Une clé qui déchiffre ici mais que le serveur refuse signifie que le compte visé n'est
    // pas celui qu'on croit : même verdict, même phrase.
    const statut = (e as { status?: number })?.status;
    throw new EchecDeRecuperation(statut === 401 ? "cle-refusee" : "reseau");
  }
}
