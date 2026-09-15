"use client";

// La sécurité du compte : double authentification, clés, passkeys, connexions.
//
// Quatre cartes, un même geste : montrer ce qui protège le compte, et ce qui
// n'est pas encore en place. L'écran doit répondre à « suis-je protégé ? »
// avant de proposer de l'être davantage.

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { computeLoginHash, createRecovery, wrapUserKeyForPasskey } from "@/lib/crypto";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { libelleAppareil } from "@/lib/securite";
import { formatDate } from "@/lib/vault";
import { createCredential, registerPasskey, webAuthnSupported } from "@/lib/webauthn";
import { Bouton, Champ, Saisie } from "@/components/champs";
import { useCopie } from "@/components/useCopie";
import { Cadenas, Coche, Copier } from "@/components/Icones";

type Cle = { id: string; name: string; createdAt: number };
type Connexion = { ip: string; userAgent: string; newDevice: boolean; createdAt: number };

function Carte({
  titre,
  sous,
  children,
  action,
}: {
  titre: string;
  sous?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="carte p-4">
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">{titre}</h3>
          {sous && <p className="text-xs text-muted">{sous}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/// Une liste de clés, avec son vide explicite. Passkeys et clés de sécurité
/// s'affichent pareil : deux listes identiques écrites deux fois auraient
/// divergé au premier ajustement.
function ListeCles({
  cles,
  vide,
  occupe,
  onRetirer,
  locale,
}: {
  cles: Cle[];
  vide: string;
  occupe: boolean;
  onRetirer: (c: Cle) => void;
  locale: string;
}) {
  const { t } = useI18n();
  if (cles.length === 0) return <p className="text-xs text-muted">{vide}</p>;
  return (
    <ul className="space-y-2">
      {cles.map((c) => (
        <li key={c.id} className="flex items-center gap-3 text-sm">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-foreground">{c.name}</span>
            <span className="text-2xs text-muted">
              {t("app.addedOn", { date: formatDate(c.createdAt, locale) })}
            </span>
          </span>
          <Bouton
            variante="danger"
            disabled={occupe}
            aria-label={`${t("app.delete")} — ${c.name}`}
            onClick={() => onRetirer(c)}
          >
            {t("app.delete")}
          </Bouton>
        </li>
      ))}
    </ul>
  );
}

export function Securite() {
  const { t, locale } = useI18n();
  const { token, account, fermer } = useSession();
  const [infoCompte, setInfoCompte] = useState<{ email: string; kdfParams: string; mfaEnabled: boolean } | null>(null);
  const [suppressionOuverte, setSuppressionOuverte] = useState(false);
  const [motDePasseSuppression, setMotDePasseSuppression] = useState("");
  const [codeSuppression, setCodeSuppression] = useState("");
  const [occupeDonnees, setOccupeDonnees] = useState(false);
  const [erreurDonnees, setErreurDonnees] = useState<string | null>(null);

  /// L'export part en téléchargement plutôt qu'à l'écran : c'est un fichier
  /// qu'on garde, pas une page qu'on lit, et il porte du chiffré illisible.
  const exporter = useCallback(async () => {
    if (!token) return;
    setOccupeDonnees(true);
    setErreurDonnees(null);
    try {
      const donnees = await api.accountExport(token);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(donnees, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `ghostpass-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErreurDonnees(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupeDonnees(false);
    }
  }, [token]);

  const supprimerLeCompte = useCallback(async () => {
    if (!token || !infoCompte) return;
    setOccupeDonnees(true);
    setErreurDonnees(null);
    try {
      // La même dérivation qu'à la connexion : le serveur ne voit jamais le
      // mot de passe maître, seulement la preuve qui en découle.
      const preuve = computeLoginHash(
        infoCompte.email,
        motDePasseSuppression,
        infoCompte.kdfParams,
      );
      await api.accountDelete(token, preuve, codeSuppression || undefined);
      fermer();
    } catch (e) {
      setErreurDonnees(e instanceof Error ? e.message : String(e));
      setOccupeDonnees(false);
    }
  }, [token, infoCompte, motDePasseSuppression, codeSuppression, fermer]);

  const { copie, copier } = useCopie();

  const [passkeys, setPasskeys] = useState<Cle[]>([]);
  const [clesSecu, setClesSecu] = useState<Cle[]>([]);
  const [connexions, setConnexions] = useState<Connexion[]>([]);
  const [mfa, setMfa] = useState<{ secret: string; otpauthUri: string } | null>(null);
  // La clé de récupération n'est affichée QU'UNE FOIS, à sa création. Elle ne
  // vit ni en base ni ailleurs dans cet état : le serveur n'en reçoit que
  // l'empreinte et la clé de coffre re-scellée. La ré-afficher plus tard
  // demanderait qu'elle soit stockée quelque part, ce qui la viderait de son
  // sens.
  const [kit, setKit] = useState<string | null>(null);
  const [codeMfa, setCodeMfa] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    if (!token) return;
    // Quatre appels indépendants : l'échec de l'un ne doit pas vider les trois
    // autres. Un écran de sécurité à moitié vide se lit comme « rien n'est
    // configuré », ce qui est le contraire de rassurant.
    const [pk, ck, act] = await Promise.allSettled([
      api.passkeyCredentials(token),
      api.webauthnCredentials(token),
      api.accountActivity(token),
    ]);
    if (pk.status === "fulfilled") setPasskeys(pk.value.credentials);
    if (ck.status === "fulfilled") setClesSecu(ck.value.credentials);
    if (act.status === "fulfilled") setConnexions(act.value.events);
    // Le compte lui-même : l'écran en a besoin pour savoir s'il doit demander
    // un code de second facteur à la suppression, et pour recalculer la preuve
    // d'authentification sans faire retaper l'adresse.
    api.accountInfo(token).then(setInfoCompte).catch(() => setInfoCompte(null));
    const echecs = [pk, ck, act].filter((r) => r.status === "rejected").length;
    setErreur(echecs > 0 ? t("app.deletedSome", { ok: 3 - echecs, ko: echecs }) : null);
  }, [token, t]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const agir = async (fn: () => Promise<unknown>) => {
    setOccupe(true);
    setErreur(null);
    try {
      await fn();
      await charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  const supporte = webAuthnSupported();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-3xl space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t("app.security")}</h2>
        </div>

        {erreur && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {erreur}
          </p>
        )}
        {message && (
          <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{message}</p>
        )}

        <Carte
          titre={t("app.twoFactor")}
          sous={t("app.twoFactorSub")}
          action={
            !mfa && (
              <Bouton
                disabled={occupe}
                onClick={() =>
                  void agir(async () => {
                    setMfa(await api.mfaSetup(token!));
                    setMessage(null);
                  })
                }
              >
                {t("app.enable2fa")}
              </Bouton>
            )
          }
        >
          {mfa && (
            <div className="space-y-3">
              <p className="text-xs text-muted">{t("app.scanQr")}</p>
              {/* Le secret en clair et copiable : sans lecteur de QR sous la
                  main, c'est le seul chemin. Il ne quitte pas la page. */}
              <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2">
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                  {mfa.secret}
                </code>
                <button
                  type="button"
                  onClick={() => copier(mfa.secret, "mfa")}
                  aria-label={`${t("app.copy")} — ${t("app.twoFactor")}`}
                  className={`cursor-pointer rounded p-1 ${copie === "mfa" ? "text-accent" : "text-muted hover:text-foreground"}`}
                >
                  {copie === "mfa" ? <Coche className="size-4" /> : <Copier className="size-4" />}
                </button>
              </div>
              <form
                aria-label={t("app.twoFactor")}
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void agir(async () => {
                    await api.mfaActivate(token!, codeMfa);
                    setMfa(null);
                    setCodeMfa("");
                    setMessage(t("app.twoFactor"));
                  });
                }}
              >
                <div className="flex-1">
                  <Champ label={t("app.codeSixDigits")}>
                    <Saisie
                      value={codeMfa}
                      onChange={(e) => setCodeMfa(e.target.value)}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      required
                    />
                  </Champ>
                </div>
                <div className="mb-3">
                  <Bouton type="submit" disabled={occupe || codeMfa.length < 6}>
                    {t("app.confirm")}
                  </Bouton>
                </div>
              </form>
            </div>
          )}
        </Carte>

        <Carte
          titre={t("app.passkeys")}
          sous={t("app.passkeysReq")}
          action={
            <Bouton
              variante="discret"
              // Sans contexte sécurisé ni authentificateur, le bouton mènerait
              // à une erreur du navigateur : autant l'éteindre et dire pourquoi
              // dans le sous-titre.
              disabled={occupe || !supporte}
              onClick={() =>
                void agir(async () => {
                  const nom = prompt(t("app.namePasskey"), "Passkey");
                  if (nom === null) return;
                  const options = await api.passkeyRegisterOptions(token!);
                  const { response, prf } = await registerPasskey(options);
                  await api.passkeyRegisterVerify(token!, {
                    response,
                    name: nom.trim() || "Passkey",
                    prfWrappedUserKey: wrapUserKeyForPasskey(account!, prf),
                  });
                })
              }
            >
              {t("app.addPasskey")}
            </Bouton>
          }
        >
          <ListeCles
            cles={passkeys}
            vide={t("app.noPasskeys")}
            occupe={occupe}
            locale={locale}
            onRetirer={(c) => {
              if (!confirm(t("app.confirmRemoveKey", { name: c.name }))) return;
              void agir(() => api.passkeyDeleteCredential(token!, c.id));
            }}
          />
        </Carte>

        <Carte
          titre={t("app.securityKeys")}
          sous={t("app.securityKeysReq")}
          action={
            <Bouton
              variante="discret"
              disabled={occupe || !supporte}
              onClick={() =>
                void agir(async () => {
                  const nom = prompt(t("app.nameSecurityKey"), "YubiKey");
                  if (nom === null) return;
                  const options = await api.webauthnRegisterOptions(token!);
                  const response = await createCredential(options);
                  await api.webauthnRegisterVerify(token!, {
                    response,
                    name: nom.trim() || "YubiKey",
                  });
                })
              }
            >
              {t("app.addSecurityKey")}
            </Bouton>
          }
        >
          <ListeCles
            cles={clesSecu}
            vide={t("app.noSecurityKeys")}
            occupe={occupe}
            locale={locale}
            onRetirer={(c) => {
              if (!confirm(t("app.confirmRemoveKey", { name: c.name }))) return;
              void agir(() => api.webauthnDeleteCredential(token!, c.id));
            }}
          />
        </Carte>

        <Carte
          titre={t("app.recoveryKit")}
          sous={kit ? undefined : t("app.recoverySub")}
          action={
            !kit && (
              <Bouton
                variante="discret"
                disabled={occupe}
                onClick={() =>
                  void agir(async () => {
                    const k = createRecovery(account!);
                    await api.enrollRecovery(token!, {
                      recoveryAuthHash: k.recoveryAuthHash,
                      encryptedUserKeyRecovery: k.encryptedUserKeyRecovery,
                    });
                    setKit(k.recoveryKey);
                  })
                }
              >
                {t("app.genRecovery")}
              </Bouton>
            )
          }
        >
          {kit && (
            <div className="space-y-3">
              {/* L'avertissement AVANT la clé, pas après : lu dans l'autre
                  ordre, il arrive quand la fenêtre est déjà fermée. */}
              <p className="rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">{t("app.recoveryWarn")}</p>
              <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2">
                <code className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">{kit}</code>
                <button
                  type="button"
                  onClick={() => copier(kit, "kit")}
                  aria-label={t("app.copyKey")}
                  className={`shrink-0 cursor-pointer rounded p-1 ${copie === "kit" ? "text-accent" : "text-muted hover:text-foreground"}`}
                >
                  {copie === "kit" ? <Coche className="size-4" /> : <Copier className="size-4" />}
                </button>
              </div>
            </div>
          )}
        </Carte>

        <Carte titre={t("app.recentActivity")}>
          {connexions.length === 0 ? (
            <p className="text-xs text-muted">{t("app.noActivity")}</p>
          ) : (
            <ul className="space-y-2">
              {connexions.map((c, i) => (
                <li key={`${c.createdAt}-${i}`} className="flex items-center gap-3 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">
                      {libelleAppareil(c.userAgent, t("app.browser"))}
                    </span>
                    <span className="text-2xs text-muted">
                      {c.ip} · {formatDate(c.createdAt, locale)}
                    </span>
                  </span>
                  {/* Un appareil jamais vu est la seule chose de cette liste
                      qui demande une réaction : elle se signale, le reste non. */}
                  {c.newDevice && (
                    <span className="shrink-0 rounded-pill bg-warn/12 px-2 py-0.5 text-2xs text-warn">
                      {t("app.newDevice")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Carte>

        {/* Partir avec ses données, et partir tout court.
            Ces deux droits existaient dans le règlement et nulle part dans le
            produit : l'API comptait 62 chemins et aucun des deux, alors que le
            schéma portait déjà les cascades qui les rendaient possibles. */}
        <Carte titre={t("app.yourData")} sous={t("app.yourDataSub")}>
          <div className="flex flex-col gap-3">
            <Bouton variante="discret" onClick={exporter} disabled={occupeDonnees}>
              {t("app.exportData")}
            </Bouton>

            {!suppressionOuverte ? (
              <Bouton variante="discret" onClick={() => setSuppressionOuverte(true)}>
                {t("app.deleteAccount")}
              </Bouton>
            ) : (
              <div className="flex flex-col gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3">
                <p className="text-xs text-danger">{t("app.deleteAccountWarn")}</p>
                {/* Le mot de passe est redemandé : une session ouverte prouve
                    qu'on est devant l'écran, pas qu'on est la titulaire. */}
                <Champ label={t("app.masterPassword")}>
                  <Saisie
                    type="password"
                    value={motDePasseSuppression}
                    onChange={(e) => setMotDePasseSuppression(e.target.value)}
                    autoComplete="current-password"
                  />
                </Champ>
                {infoCompte?.mfaEnabled && (
                  <Champ label={t("app.totpCode")}>
                    <Saisie
                      inputMode="numeric"
                      value={codeSuppression}
                      onChange={(e) => setCodeSuppression(e.target.value)}
                    />
                  </Champ>
                )}
                <div className="flex gap-2">
                  <Bouton variante="discret" onClick={() => setSuppressionOuverte(false)}>
                    {t("app.cancel")}
                  </Bouton>
                  <Bouton onClick={supprimerLeCompte} disabled={occupeDonnees}>
                    {t("app.deleteAccountConfirm")}
                  </Bouton>
                </div>
              </div>
            )}

            {erreurDonnees && <p className="text-xs text-danger">{erreurDonnees}</p>}
          </div>
        </Carte>

        <p className="flex items-center gap-2 px-1 text-2xs text-muted">
          <Cadenas className="size-3.5" />
          {t("app.pt1b")}
        </p>
      </div>
    </div>
  );
}
