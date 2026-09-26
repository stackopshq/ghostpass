"use client";

// L'entrée : inscription, connexion, second facteur, SSO.
//
// **Ce qui prouve l'identité et ce qui ouvre le coffre sont deux choses.** Le
// serveur vérifie une empreinte dérivée du mot de passe et rend des blobs
// chiffrés ; le déverrouillage a lieu ici, avec le mot de passe maître que le
// serveur n'a jamais vu. C'est pourquoi le SSO ne suffit pas à ouvrir un coffre :
// il prouve qui vous êtes, pas ce que vous savez.

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { computeLoginHash, ensureCryptoReady, register, unlock, unlockWithPasskey } from "@/lib/crypto";
import { authenticatePasskey, getAssertion } from "@/lib/webauthn";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { Bouton, Champ, Saisie, TeteDePanneau } from "@/components/champs";
import { Cadenas } from "@/components/Icones";

// Le repli d'affichage, le temps que le déploiement réponde.
//
// L'adresse réelle vient de `/api/config`. Elle ne peut pas venir d'une variable de
// construction : ce client est un export statique, donc tout `NEXT_PUBLIC_*` y est gravé
// dans le paquet. Un auto-hébergeur tire l'image publiée et la poser chez lui ne
// changerait rien — c'est précisément ce que j'avais livré, et c'était inerte pour le
// seul public que la dérogation vise.
const CONFIDENTIALITE_PAR_DEFAUT = "/confidentialite";

type Mode = "login" | "register";
type SsoEnAttente = Awaited<ReturnType<typeof api.ssoCallback>> | null;

export function AuthScreen() {
  const { t } = useI18n();
  const { ouvrir } = useSession();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [codeTotp, setCodeTotp] = useState("");
  const [totpDemande, setTotpDemande] = useState(false);
  const [sso, setSso] = useState<SsoEnAttente>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  // Le retour du fournisseur d'identité arrive sur `/sso/callback?code&state`.
  // On nettoie l'URL tout de suite : laisser le code dans la barre d'adresse le
  // met dans l'historique, et un code d'autorisation n'a rien à y faire.
  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const state = params.get("state");
      if (window.location.pathname !== "/sso/callback" && !(code && state)) return;
      window.history.replaceState(null, "", "/");
      if (!code || !state) return;
      setOccupe(true);
      try {
        const res = await api.ssoCallback(code, state);
        setSso(res);
        setEmail(res.email);
      } catch {
        setErreur(t("auth.ssoFailed"));
      } finally {
        setOccupe(false);
      }
    })();
  }, [t]);

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setOccupe(true);
    try {
      await ensureCryptoReady();
      if (mode === "register") {
        const { data, account } = register(email, motDePasse);
        const res = await api.register(data);
        ouvrir(res.token, account);
      } else {
        const { kdfParams } = await api.prelogin(email);
        const hash = computeLoginHash(email, motDePasse, kdfParams);
        let res = await api.login(email, hash, { totpCode: codeTotp || undefined });
        // Second facteur par clé de sécurité : on déclenche l'assertion puis on
        // rejoue la connexion. L'assertion ne peut pas être demandée d'avance —
        // le serveur ne fournit ses options qu'après un premier refus.
        if (!res.ok && res.mfaRequired && res.mfaType === "webauthn" && res.options) {
          res = await api.login(email, hash, { webauthnResponse: await getAssertion(res.options) });
        }
        if (!res.ok) {
          if (res.mfaRequired && res.mfaType !== "webauthn") setTotpDemande(true);
          throw new Error(res.error);
        }
        ouvrir(
          res.token,
          unlock(email, motDePasse, {
            kdfParams: res.kdfParams,
            encryptedUserKey: res.encryptedUserKey,
            encryptedPrivateKey: res.encryptedPrivateKey,
          }),
        );
      }
      setMotDePasse("");
      setCodeTotp("");
      setTotpDemande(false);
    } catch (err) {
      setErreur(msg(err));
    } finally {
      setOccupe(false);
    }
  }

  async function terminerSso(e: React.FormEvent) {
    e.preventDefault();
    if (!sso) return;
    setErreur(null);
    setOccupe(true);
    try {
      await ensureCryptoReady();
      ouvrir(
        sso.token,
        unlock(sso.email, motDePasse, {
          kdfParams: sso.kdfParams,
          encryptedUserKey: sso.encryptedUserKey,
          encryptedPrivateKey: sso.encryptedPrivateKey,
        }),
      );
      setMotDePasse("");
      setSso(null);
    } catch {
      // Un seul message : distinguer « mot de passe faux » de « blob corrompu »
      // apprendrait quelque chose à qui tâtonne.
      setErreur(t("auth.badMaster"));
    } finally {
      setOccupe(false);
    }
  }

  /// Ouvrir le coffre avec une clé d'accès, sans mot de passe maître.
  ///
  /// Ce n'est pas un second facteur : c'est un chemin d'entrée complet, et il
  /// reste zero-knowledge. L'extension **PRF** de WebAuthn fait produire à
  /// l'authentificateur un secret stable, dérivé d'un sel fixe et de la clé
  /// elle-même. Ce secret n'existe que dans le navigateur, et c'est lui qui
  /// enveloppe la clé de l'utilisateur à l'enrôlement. Le serveur ne détient
  /// donc qu'un blob qu'il ne peut pas ouvrir — exactement comme avec un mot
  /// de passe maître.
  ///
  /// Une YubiKey, Touch ID, Windows Hello ou une clé Apple synchronisée font
  /// toutes l'affaire : ce qui compte est le support de PRF (`hmac-secret` au
  /// niveau CTAP2), pas la marque. `authenticatePasskey` refuse explicitement
  /// un authentificateur qui ne la porte pas, plutôt que de dériver un secret
  /// vide et d'échouer plus loin sur un déchiffrement incompréhensible.
  ///
  /// L'adresse est nécessaire : le serveur doit savoir de quelles clés
  /// proposer l'assertion. Elle ne prouve rien à elle seule.
  async function connexionParCleDAcces() {
    if (!email) {
      setErreur(t("auth.passkeyNeedsEmail"));
      return;
    }
    setErreur(null);
    setOccupe(true);
    try {
      await ensureCryptoReady();
      const options = await api.passkeyLoginOptions(email);
      const { response, prf } = await authenticatePasskey(options);
      const res = await api.passkeyLogin(email, response);
      ouvrir(res.token, unlockWithPasskey(prf, res.prfWrappedUserKey, res.encryptedPrivateKey));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  }

  // ─── Le bouton SSO ne paraît que si l'instance en propose un ───
  //
  // `api.ssoStatus()` existait déjà et n'était appelée nulle part : le bouton
  // s'affichait donc partout, y compris sur `pass.ghostsuite.cloud` qui répond
  // `{"enabled": false}`. Le toucher menait à une erreur, sur l'écran par lequel tout
  // le monde entre.
  //
  // `null` tant qu'on ne sait pas, et le bouton reste caché dans cet état : un bouton
  // qui apparaît après coup est moins déroutant qu'un bouton qui disparaît sous le
  // doigt. Un serveur trop ancien pour connaître la route est traité comme « pas de
  // SSO », pour la même raison qu'ailleurs dans ce produit — afficher un incident pour
  // une fonction que personne n'a demandée serait du bruit.
  const [ssoDisponible, setSsoDisponible] = useState<boolean | null>(null);

  // Demandée au déploiement. L'échec retombe sur la page servie par l'application
  // elle-même : un lien vers notre texte vaut mieux qu'aucun lien, et c'est de toute
  // façon la bonne réponse pour la grande majorité des instances.
  const [urlConfidentialite, setUrlConfidentialite] = useState(CONFIDENTIALITE_PAR_DEFAUT);
  useEffect(() => {
    let vivant = true;
    void api
      .config()
      .then((c) => vivant && c.privacyUrl && setUrlConfidentialite(c.privacyUrl))
      .catch(() => {
        /* Sans conséquence visible : le repli est déjà en place. */
      });
    return () => {
      vivant = false;
    };
  }, []);

  useEffect(() => {
    let vivant = true;
    void api
      .ssoStatus()
      .then((r) => vivant && setSsoDisponible(r.enabled))
      .catch(() => vivant && setSsoDisponible(false));
    return () => {
      vivant = false;
    };
  }, []);

  async function versSso() {
    setErreur(null);
    setOccupe(true);
    try {
      window.location.assign((await api.ssoLogin()).url);
    } catch (err) {
      setErreur(msg(err));
      setOccupe(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        {/* La marque, centrée et à sa taille de page d'accueil — `--text-2xl`,
            une marche de la charte, et non une valeur choisie ici. Le logo est
            le fichier de `tools/brand/`, servi tel quel : une icône de cadenas
            générique tenait sa place, si bien que l'écran par lequel tout le
            monde entre était le seul à ne pas porter l'identité du produit. */}
        <div className="mb-7 flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={44} height={44} className="size-11" />
          <span className="text-2xl font-semibold tracking-tight text-foreground">GhostPass</span>
        </div>

        {/* `verre` et non une surface pleine : l'aurore posée sur le corps ne se
            voit qu'à travers une matière translucide. Un aplat uni par-dessus
            l'éteint — c'est ce que faisait `Panneau`, et l'écran perdait la
            profondeur que le reste de l'application a. */}
        <section className="verre rounded-lg border border-border p-6">
          {sso ? (
            // L'identité est prouvée par le fournisseur ; le coffre attend
            // encore le mot de passe maître, que lui seul peut ouvrir.
            <>
              <TeteDePanneau titre={t("auth.ssoUnlock")} />
              <p className="mb-3 text-sm text-muted">{t("auth.ssoUnlockSub", { email: sso.email })}</p>
              <form onSubmit={terminerSso}>
                <Champ label={t("auth.masterPassword")}>
                  <Saisie
                    type="password"
                    value={motDePasse}
                    onChange={(e) => setMotDePasse(e.target.value)}
                    autoComplete="current-password"
                    required
                    autoFocus
                  />
                </Champ>
                <Bouton type="submit" disabled={occupe} className="w-full">
                  {t("auth.unlock")}
                </Bouton>
              </form>
            </>
          ) : (
            <>
              <TeteDePanneau titre={mode === "login" ? t("auth.signIn") : t("auth.signUp")} />
              <form onSubmit={soumettre}>
                <Champ label={t("auth.email")}>
                  <Saisie
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </Champ>
                <Champ label={t("auth.masterPassword")}>
                  <Saisie
                    type="password"
                    value={motDePasse}
                    onChange={(e) => setMotDePasse(e.target.value)}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    required
                  />
                </Champ>
                {totpDemande && (
                  // Le champ accepte aussi un code de récupération, et le dit.
                  // Il le transmettait déjà — le serveur essaie les deux — mais
                  // l'étiquette « code à 6 chiffres » et le clavier numérique
                  // affirmaient le contraire : qui avait perdu son téléphone
                  // n'avait aucune raison d'essayer d'y taper des lettres.
                  <Champ label={t("auth.totpOrRecovery")}>
                    <Saisie
                      value={codeTotp}
                      onChange={(e) => setCodeTotp(e.target.value)}
                      autoComplete="one-time-code"
                      autoFocus
                    />
                  </Champ>
                )}
                <Bouton type="submit" disabled={occupe} className="w-full">
                  {mode === "login" ? t("auth.signIn") : t("auth.signUp")}
                </Bouton>
              </form>

              {/* L'information de l'article 13 est due AU MOMENT de la collecte,
                  pas dans un pied de page qu'on peut ne jamais dérouler. Elle
                  n'apparaît donc qu'en mode inscription, juste sous le bouton
                  qui crée le compte — c'est là que la personne décide. Le lien
                  reste par ailleurs accessible en permanence, en pied d'écran. */}
              {mode === "register" && (
                <p className="mt-3 text-xs leading-relaxed text-muted">
                  {t("auth.privacyNotice")}{" "}
                  <a
                    href={urlConfidentialite}
                    className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
                  >
                    {t("auth.privacy")}
                  </a>
                </p>
              )}

              <div className="mt-4 flex flex-col gap-2">
                <Bouton
                  variante="discret"
                  onClick={connexionParCleDAcces}
                  disabled={occupe}
                  className="w-full"
                >
                  {t("auth.passkey")}
                </Bouton>
                {ssoDisponible && (
                  <Bouton variante="discret" onClick={versSso} disabled={occupe} className="w-full">
                    {t("auth.sso")}
                  </Bouton>
                )}
                {/* La question reste du texte, l'action seule est le bouton.
                    Avant, la phrase entière était le bouton, en `text-muted`,
                    et son unique signal d'interactivité était `hover:` — un
                    état qu'un écran tactile n'atteint jamais. Sur téléphone,
                    rien ne distinguait donc « En créer un » d'un gris inerte. */}
                <p className="text-xs text-muted">
                  {mode === "login" ? t("auth.needAccount") : t("auth.haveAccount")}{" "}
                  <button
                    type="button"
                    className="cursor-pointer font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
                    onClick={() => { setMode(mode === "login" ? "register" : "login"); setErreur(null); }}
                  >
                    {mode === "login" ? t("auth.needAccountAction") : t("auth.haveAccountAction")}
                  </button>
                </p>
              </div>
            </>
          )}

          {erreur && (
            <p role="alert" className="mt-4 rounded border border-border-strong px-3 py-2 text-sm text-muted">
              {erreur}
            </p>
          )}
        </section>

        {/* La mention `zero-knowledge`, la même qu'au pied du coffre : c'est la
            promesse du produit, elle a sa place là où l'on décide d'y entrer.
        
            Le sélecteur de langue vivait ici. Il est désormais dans la pastille
            flottante, rendue pour **toutes** les pages et non plus seulement le
            coffre ouvert. Le laisser aussi sous la carte afficherait « EN FR »
            deux fois sur le même écran. */}
        <div className="mt-6 flex items-center justify-center text-muted">
          <span className="flex items-center gap-1.5 text-xs">
            <Cadenas className="size-3.5" />
            {t("app.pt1b")}
          </span>
        </div>

        {/* Toujours atteignable, y compris pour qui est déjà inscrit : une
            personne qui revient se connecter doit pouvoir relire ce à quoi
            elle a consenti sans avoir à recréer un compte pour revoir le lien. */}
        <p className="mt-3 text-center">
          <a
            href={urlConfidentialite}
            className="text-xs text-muted underline underline-offset-2 hover:text-foreground"
          >
            {t("auth.privacy")}
          </a>
        </p>
      </div>
    </main>
  );
}
