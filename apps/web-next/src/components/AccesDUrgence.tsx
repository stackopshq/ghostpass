"use client";

// L'accès d'urgence : un proche peut ouvrir votre coffre après un délai que vous fixez, et
// pendant lequel vous pouvez refuser.
//
// Le serveur porte cette fonctionnalité en entier depuis des mois — huit routes, la machine à
// états, l'application du délai — et six fonctions d'`api.ts` l'appellent. AUCUN écran ne les
// appelait : personne ne pouvait accorder d'accès d'urgence. Les deux seuls libellés traduits
// (`app.emergency`, `app.emergencyWho`) disent que l'écran avait été prévu, puis abandonné.
//
// La machine à états vit dans `lib/urgence.ts`, où elle est testée. Ici il n'y a que du rendu
// et les trois enchaînements cryptographiques.

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  decryptEmergencyItem,
  type EmergencyHandle,
  type EmergencyItem,
  emergencyTakeover,
  openEmergency,
  sealUserKeyFor,
} from "@/lib/crypto";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import {
  actionsDuContact,
  actionsDuProprietaire,
  type EntreeDUrgence,
  joursRestants,
} from "@/lib/urgence";
import { Bouton, Champ, Liste, Saisie } from "@/components/champs";

interface Listes {
  asGrantor: EntreeDUrgence[];
  asGrantee: EntreeDUrgence[];
}

/** Un coffre ouvert par accès d'urgence, gardé le temps de le consulter. */
interface CoffreOuvert {
  entree: EntreeDUrgence;
  poignee: EmergencyHandle;
  items: EmergencyItem[];
  grantorEmail: string;
  grantorKdfParams: string;
}

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

export function AccesDUrgence() {
  const { t } = useI18n();
  const { token, account } = useSession();

  const [listes, setListes] = useState<Listes | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [coffre, setCoffre] = useState<CoffreOuvert | null>(null);

  // Le formulaire d'invitation n'apparaît qu'à la demande : trois champs toujours ouverts sous
  // une liste vide se lisent comme une obligation, alors que c'est une fonction qu'on active.
  const [invitationOuverte, setInvitationOuverte] = useState(false);
  const [adresse, setAdresse] = useState("");
  const [role, setRole] = useState("view");
  const [delai, setDelai] = useState("7");

  const charger = useCallback(async () => {
    if (!token) return;
    try {
      setListes(await api.listEmergency(token));
    } catch {
      // Un serveur trop ancien pour connaître la route n'est pas une panne d'écran : la carte
      // reste vide plutôt que d'afficher un incident pour une fonction que personne n'a encore
      // demandée sur cette instance.
      setListes({ asGrantor: [], asGrantee: [] });
    }
  }, [token]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const agir = async (fn: () => Promise<unknown>) => {
    setErreur(null);
    setOccupe(true);
    try {
      await fn();
      await charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  // ─── Inviter : chercher la clé publique, sceller l'USK pour elle, envoyer ───
  //
  // Le scellement a lieu ICI, dans le navigateur du propriétaire. Le serveur ne reçoit qu'un
  // blob qu'il ne peut pas ouvrir : c'est ce qui fait qu'un accès d'urgence n'est pas une porte
  // dérobée. Il faut donc la clé publique du contact AVANT d'appeler `createEmergency`.
  async function inviter(e: React.FormEvent) {
    e.preventDefault();
    await agir(async () => {
      const { publicKey } = await api.lookupPublicKey(token!, adresse.trim());
      await api.createEmergency(token!, {
        email: adresse.trim(),
        role,
        waitDays: Number(delai),
        sealedUserKey: sealUserKeyFor(account!, publicKey),
      });
      setAdresse("");
      setInvitationOuverte(false);
    });
  }

  // ─── Ouvrir le coffre d'un proche ───
  async function ouvrir(entree: EntreeDUrgence) {
    await agir(async () => {
      const acces = await api.emergencyAccess(token!, entree.id);
      const poignee = openEmergency(account!, acces.grantorPublicKey, acces.sealedUserKey);
      setCoffre({
        entree,
        poignee,
        grantorEmail: acces.grantorEmail,
        grantorKdfParams: acces.grantorKdfParams,
        items: acces.items.map((i) => decryptEmergencyItem(poignee, i.encryptedKey, i.encryptedData)),
      });
    });
  }

  // ─── Reprendre le compte (rôle « takeover ») ───
  async function reprendre(ouvert: CoffreOuvert) {
    const nouveau = prompt(t("app.emNewPassword"));
    if (!nouveau) return;
    await agir(async () => {
      const reset = emergencyTakeover(
        ouvert.poignee,
        ouvert.grantorEmail,
        ouvert.grantorKdfParams,
        nouveau,
      );
      await api.emergencyTakeover(token!, ouvert.entree.id, {
        newMasterPasswordHash: reset.masterPasswordHash,
        newEncryptedUserKey: reset.encryptedUserKey,
      });
      setCoffre(null);
    });
  }

  function executer(entree: EntreeDUrgence, action: string) {
    switch (action) {
      case "retirer":
        if (!confirm(t("app.emConfirmRemove", { email: entree.contactEmail }))) return;
        void agir(() => api.removeEmergency(token!, entree.id));
        return;
      case "ouvrir":
        void ouvrir(entree);
        return;
      case "reprendre":
        // La reprise exige le coffre déjà ouvert : c'est lui qui détient l'USK avec laquelle
        // le nouveau mot de passe maître est dérivé.
        if (coffre?.entree.id === entree.id) void reprendre(coffre);
        else void ouvrir(entree);
        return;
      default: {
        const verbes = { accepter: "accept", demander: "request", approuver: "approve", refuser: "reject" } as const;
        const verbe = verbes[action as keyof typeof verbes];
        if (verbe) void agir(() => api.emergencyAction(token!, entree.id, verbe));
      }
    }
  }

  function Ligne({ entree, actions }: { entree: EntreeDUrgence; actions: string[] }) {
    const restants = joursRestants(entree, Date.now());
    return (
      <li className="flex flex-wrap items-center gap-2 border-b border-border py-2 last:border-0">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-foreground">{entree.contactEmail}</p>
          <p className="text-2xs text-muted">
            {t(entree.role === "takeover" ? "app.emRoleTakeover" : "app.emRoleView")} ·{" "}
            {t(`app.emStatus.${entree.status}`)}
            {entree.status === "requested" && ` · ${t("app.emDaysLeft", { n: restants })}`}
          </p>
        </div>
        {actions.map((a) => (
          <Bouton
            key={a}
            variante={a === "retirer" ? "danger" : "discret"}
            disabled={occupe}
            onClick={() => executer(entree, a)}
          >
            {t(`app.em_${a}`)}
          </Bouton>
        ))}
      </li>
    );
  }

  const vide = <p className="text-xs text-muted">{t("app.emNone")}</p>;

  return (
    <>
      <Carte
        titre={t("app.emergency")}
        sous={t("app.emergencyWho")}
        action={
          <Bouton
            variante="discret"
            disabled={occupe}
            onClick={() => setInvitationOuverte((v) => !v)}
          >
            {t("app.emInvite")}
          </Bouton>
        }
      >
        {invitationOuverte && (
          <form onSubmit={inviter} className="mb-4 rounded-lg bg-surface-2 p-3">
            <Champ label={t("app.emContactEmail")}>
              <Saisie
                type="email"
                value={adresse}
                onChange={(e) => setAdresse(e.target.value)}
                required
                autoFocus
              />
            </Champ>
            <Champ label={t("app.emRole")}>
              <Liste value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="view">{t("app.emRoleView")}</option>
                <option value="takeover">{t("app.emRoleTakeover")}</option>
              </Liste>
            </Champ>
            {/* Le délai est la seule protection du propriétaire : c'est la fenêtre pendant
                laquelle il peut refuser. Le dire ici, et pas dans une aide qu'on ne déroule
                pas. */}
            <Champ label={t("app.emWaitDays")}>
              <Saisie
                type="number"
                min={1}
                max={90}
                value={delai}
                onChange={(e) => setDelai(e.target.value)}
                required
              />
            </Champ>
            <p className="mb-3 text-2xs text-muted">{t("app.emWaitExplain")}</p>
            <Bouton type="submit" disabled={occupe}>
              {t("app.emInviteSend")}
            </Bouton>
          </form>
        )}
        {listes === null ? null : listes.asGrantor.length === 0 ? (
          vide
        ) : (
          <ul>
            {listes.asGrantor.map((e) => (
              <Ligne key={e.id} entree={e} actions={actionsDuProprietaire(e)} />
            ))}
          </ul>
        )}
      </Carte>

      <Carte titre={t("app.emTheirs")} sous={t("app.emTheirsSub")}>
        {listes === null ? null : listes.asGrantee.length === 0 ? (
          vide
        ) : (
          <ul>
            {listes.asGrantee.map((e) => (
              <Ligne key={e.id} entree={e} actions={actionsDuContact(e)} />
            ))}
          </ul>
        )}

        {coffre && (
          <div className="mt-4 rounded-lg border border-border p-3">
            <div className="mb-2 flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {t("app.emOpened", { email: coffre.grantorEmail, n: coffre.items.length })}
              </p>
              {coffre.entree.role === "takeover" && (
                <Bouton variante="danger" disabled={occupe} onClick={() => void reprendre(coffre)}>
                  {t("app.em_reprendre")}
                </Bouton>
              )}
              <Bouton variante="discret" onClick={() => setCoffre(null)}>
                {t("app.emClose")}
              </Bouton>
            </div>
            {/* Les mots de passe sont affichés en clair : le contact a franchi le délai, il a
                le droit de les lire, et les masquer derrière un bouton supplémentaire n'ajoute
                aucune sécurité une fois le déchiffrement fait. */}
            <ul className="space-y-2">
              {coffre.items.map((i, n) => (
                <li key={n} className="rounded bg-surface-2 px-3 py-2">
                  <p className="text-sm text-foreground">{i.name || t("app.emUnnamed")}</p>
                  {/* Le séparateur n'apparaît QUE s'il sépare deux choses. Un item sans
                      identifiant — une note sécurisée, typiquement — affichait « · » tout seul
                      sur une ligne vide, ce qui se lit comme un défaut d'affichage plutôt que
                      comme « cette entrée n'a pas d'identifiant ». */}
                  {(i.username || i.password) && (
                    <p className="font-mono text-xs break-all text-muted">
                      {[i.username, i.password].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Carte>

      {erreur && (
        <p role="alert" className="rounded border border-border-strong px-3 py-2 text-sm text-muted">
          {erreur}
        </p>
      )}
    </>
  );
}
