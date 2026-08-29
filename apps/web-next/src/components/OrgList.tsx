"use client";

// La liste des organisations : créer, accepter une invitation, ouvrir, supprimer.
//
// La suppression demande de retaper le nom. Ce n'est pas de la cérémonie : elle
// détruit les secrets de toute une équipe, et un bouton qui fait ça au premier
// clic finit par le faire au mauvais moment.

import { useState } from "react";
import { api } from "@/lib/api";
import { createOrg } from "@/lib/crypto";
import type { Account } from "ghostpass-crypto-wasm";
import { useI18n } from "@/lib/i18n";
import { Bouton, Champ, Panneau, Saisie, TeteDePanneau } from "@/components/champs";

export type OrgSummary = { orgId: string; name: string; role: string; status: string };

export function OrgList({
  account, token, orgs, occupe, onRecharger, onOuvrir, onErreur,
}: {
  account: Account;
  token: string;
  orgs: OrgSummary[];
  occupe: boolean;
  onRecharger: () => Promise<void>;
  onOuvrir: (o: OrgSummary) => void;
  onErreur: (m: string) => void;
}) {
  const { t } = useI18n();
  const [nouveauNom, setNouveauNom] = useState("");
  const [cible, setCible] = useState<OrgSummary | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [erreurSuppression, setErreurSuppression] = useState<string | null>(null);

  const echoue = (e: unknown) => onErreur(e instanceof Error ? e.message : String(e));

  async function creer(e: React.FormEvent) {
    e.preventDefault();
    try {
      const { sealedForSelf } = createOrg(account);
      await api.createOrg(token, { name: nouveauNom, encryptedOrgKey: sealedForSelf });
      setNouveauNom("");
      await onRecharger();
    } catch (err) {
      echoue(err);
    }
  }

  async function accepter(o: OrgSummary) {
    try {
      await api.acceptInvite(token, o.orgId);
      await onRecharger();
    } catch (err) {
      echoue(err);
    }
  }

  async function supprimer(e: React.FormEvent) {
    e.preventDefault();
    if (!cible || confirmation.trim() !== cible.name) return;
    setErreurSuppression(null);
    try {
      await api.deleteOrg(token, cible.orgId);
      setCible(null);
      setConfirmation("");
      await onRecharger();
    } catch (err) {
      // Le serveur refuse pour une raison précise (403, 404, 409 avec décomptes).
      // On la garde affichée et le panneau ouvert : l'avaler ferait passer une
      // garantie pour un bouton mort.
      const message = err instanceof Error ? err.message : String(err);
      setErreurSuppression(message);
      onErreur(message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Panneau>
        <TeteDePanneau titre={t("org.myOrgs")} compte={orgs.length} />
        {orgs.length === 0 ? (
          <p className="text-sm text-muted">
            {t("org.noOrgs")}
            <br />
            <span className="text-xs">{t("org.noOrgsSub")}</span>
          </p>
        ) : (
          <ul className="flex flex-col">
            {orgs.map((o) => (
              <li key={o.orgId} className="border-b border-border py-3 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="grow truncate text-sm text-foreground">{o.name}</span>
                  <span className="text-2xs text-muted">{o.role}</span>
                  {o.status === "invited" ? (
                    <Bouton variante="discret" onClick={() => accepter(o)} disabled={occupe}>
                      {t("org.accept")}
                    </Bouton>
                  ) : (
                    <>
                      <Bouton variante="discret" onClick={() => onOuvrir(o)} disabled={occupe}>
                        {t("org.open")}
                      </Bouton>
                      {o.role === "admin" && (
                        <Bouton
                          variante="danger"
                          onClick={() => { setCible(o); setConfirmation(""); setErreurSuppression(null); }}
                          disabled={occupe}
                        >
                          {t("org.delete")}
                        </Bouton>
                      )}
                    </>
                  )}
                </div>

                {cible?.orgId === o.orgId && (
                  <form onSubmit={supprimer} className="mt-3 rounded border border-border-strong p-3">
                    <Champ label={t("org.confirmName")}>
                      <Saisie
                        value={confirmation}
                        onChange={(e) => setConfirmation(e.target.value)}
                        placeholder={o.name}
                        autoComplete="off"
                      />
                    </Champ>
                    {erreurSuppression && (
                      <p className="mb-2 text-xs text-muted">{erreurSuppression}</p>
                    )}
                    <div className="flex gap-2">
                      <Bouton
                        type="submit"
                        variante="danger"
                        disabled={occupe || confirmation.trim() !== o.name}
                      >
                        {t("org.delete")}
                      </Bouton>
                      <Bouton type="button" variante="discret" onClick={() => setCible(null)}>
                        {t("org.cancel")}
                      </Bouton>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panneau>

      <Panneau>
        <TeteDePanneau titre={t("org.create")} />
        <form onSubmit={creer} className="max-w-[480px]">
          <Champ label={t("org.name")}>
            <Saisie value={nouveauNom} onChange={(e) => setNouveauNom(e.target.value)} required />
          </Champ>
          <Bouton type="submit" disabled={occupe || !nouveauNom.trim()}>
            {t("org.create")}
          </Bouton>
        </form>
      </Panneau>
    </div>
  );
}
