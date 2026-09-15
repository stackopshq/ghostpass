"use client";

// Les organisations dont on est membre, et celles où l'on est invité.
//
// La clé d'organisation ne quitte jamais l'onglet : elle est scellée pour la
// clé publique de chaque membre, ouverte ici, et le serveur n'en voit que des
// enveloppes. Créer une organisation, c'est donc engendrer une clé et se la
// sceller à soi-même — pas demander au serveur d'en fabriquer une.

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { createOrg } from "@/lib/crypto";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import type { OrgSummary } from "@/lib/orgs";
import { couleurOrg, PALETTE_ORG, type RegistreCouleurs } from "@/lib/couleursOrg";
import { Bouton, Champ, Saisie } from "@/components/champs";
import { Organisation } from "@/components/Icones";

/// Une pastille de couleur : le repère visuel, et le bouton qui l'ouvre.
///
/// C'est un vrai bouton, pas un `div` cliquable : sans cela on ne l'atteint ni
/// au clavier ni au lecteur d'écran, et une couleur est précisément ce que la
/// seconde de ces deux personnes ne perçoit pas — l'étiquette est alors tout
/// ce qui reste.
function Pastille({
  couleur,
  label,
  choisie,
  ouvre,
  onClick,
}: {
  couleur: string;
  label: string;
  /// Pastille de palette : est-ce celle en vigueur ?
  choisie?: boolean;
  /// Pastille d'en-tête : le sélecteur est-il déplié ? Ce n'est pas un état
  /// « enfoncé » mais un panneau ouvert, et les deux ne s'annoncent pas pareil.
  ouvre?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={choisie}
      aria-expanded={ouvre}
      title={label}
      className="size-5 shrink-0 rounded-full border border-border-strong focus:outline-none focus:ring-2 focus:ring-accent/40"
      style={{ backgroundColor: couleur }}
    />
  );
}

export function ListeOrgs({
  onOuvrir,
  couleurs,
  onCouleur,
}: {
  onOuvrir: (org: OrgSummary) => void;
  couleurs: RegistreCouleurs;
  /// `null` retire le choix : l'organisation revient à sa couleur attribuée.
  onCouleur: (orgId: string, couleur: string | null) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const { token, account } = useSession();
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [nom, setNom] = useState("");
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // Suppression : cible en cours, nom ressaisi, et le refus du serveur gardé
  // SOUS le contrôle. Un 409 « il reste trois collections » doit se lire là où
  // l'on vient de cliquer, sinon la garantie passe pour un bouton mort.
  const [cible, setCible] = useState<OrgSummary | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [refus, setRefus] = useState<string | null>(null);

  // L'organisation dont le sélecteur de couleur est ouvert, s'il y en a une.
  const [couleurOuverte, setCouleurOuverte] = useState<string | null>(null);

  const charger = useCallback(async () => {
    if (!token) return;
    try {
      setOrgs((await api.listOrgs(token)).organizations);
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  }, [token]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const agir = async (fn: () => Promise<unknown>) => {
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

  const creer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !account || !nom.trim()) return;
    await agir(async () => {
      const { sealedForSelf } = createOrg(account);
      await api.createOrg(token, { name: nom.trim(), encryptedOrgKey: sealedForSelf });
      setNom("");
    });
  };

  const supprimer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !cible || confirmation.trim() !== cible.name) return;
    setOccupe(true);
    setRefus(null);
    try {
      await api.deleteOrg(token, cible.orgId);
      setCible(null);
      setConfirmation("");
      await charger();
    } catch (err) {
      setRefus(err instanceof Error ? err.message : String(err));
    } finally {
      setOccupe(false);
    }
  };

  return (
    <div className="min-h-0 overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-lg font-semibold text-foreground">{t("org.myOrgs")}</h2>
        <p className="mb-5 text-xs text-muted">{t("org.noOrgsSub")}</p>

        {erreur && (
          <p role="alert" className="mb-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {erreur}
          </p>
        )}

        <div className="space-y-2">
          {orgs.length === 0 && (
            <div className="carte grid place-items-center gap-3 py-12 text-center">
              <Organisation className="size-7 text-muted opacity-30" />
              <p className="text-sm text-muted">{t("org.noOrgs")}</p>
            </div>
          )}

          {orgs.map((org) => (
            <div key={org.orgId} className="carte px-4 py-3.5">
              <div className="flex items-center gap-3">
                <Pastille
                  couleur={couleurOrg(couleurs, org.orgId)}
                  label={t("org.colorOf", { name: org.name })}
                  ouvre={couleurOuverte === org.orgId}
                  onClick={() => setCouleurOuverte(couleurOuverte === org.orgId ? null : org.orgId)}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{org.name}</p>
                  <p className="text-2xs text-muted">
                    {org.role}
                    {/* Une invitation en attente n'est pas une organisation où
                        l'on est déjà : le dire, sinon « Ouvrir » échouera faute
                        de clé scellée pour nous. */}
                    {org.status !== "active" && ` · ${org.status}`}
                  </p>
                </div>
                {org.status === "active" ? (
                  <Bouton variante="discret" onClick={() => onOuvrir(org)} disabled={occupe}>
                    {t("org.open")}
                  </Bouton>
                ) : (
                  <Bouton onClick={() => agir(() => api.acceptInvite(token!, org.orgId))} disabled={occupe}>
                    {t("org.accept")}
                  </Bouton>
                )}
                {org.role === "admin" && (
                  <Bouton
                    variante="danger"
                    disabled={occupe}
                    onClick={() => {
                      setCible(cible?.orgId === org.orgId ? null : org);
                      setConfirmation("");
                      setRefus(null);
                    }}
                  >
                    {t("org.delete")}
                  </Bouton>
                )}
              </div>

              {couleurOuverte === org.orgId && (
                <div
                  role="group"
                  aria-label={t("org.colorOf", { name: org.name })}
                  className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3"
                >
                  <span className="text-2xs text-muted">{t("org.colorPalette")}</span>
                  {PALETTE_ORG.map((teinte) => (
                    <Pastille
                      key={teinte}
                      couleur={teinte}
                      label={teinte}
                      choisie={couleurOrg(couleurs, org.orgId) === teinte}
                      onClick={() => void onCouleur(org.orgId, teinte)}
                    />
                  ))}
                  {/* Le choix libre. iOS ramène sa propre sélection en
                      `#RRGGBB` avant d'écrire, donc une teinte très saturée
                      choisie sur iPhone paraîtra un peu plus terne ici : le
                      registre ne transporte pas d'espace colorimétrique. */}
                  <label className="ml-1 flex items-center gap-1.5 text-2xs text-muted">
                    {t("org.colorCustom")}
                    <input
                      type="color"
                      aria-label={t("org.colorCustom")}
                      value={couleurOrg(couleurs, org.orgId).toLowerCase()}
                      onChange={(e) => void onCouleur(org.orgId, e.target.value)}
                      className="size-6 cursor-pointer rounded border border-border bg-transparent p-0"
                    />
                  </label>
                  <Bouton
                    variante="discret"
                    type="button"
                    disabled={couleurs[org.orgId] === undefined}
                    onClick={() => void onCouleur(org.orgId, null)}
                    title={t("org.colorReset")}
                  >
                    {t("org.colorDefault")}
                  </Bouton>
                </div>
              )}

              {cible?.orgId === org.orgId && (
                <form onSubmit={supprimer} aria-label={t("org.delete")} className="mt-3 border-t border-border pt-3">
                  <Champ label={t("org.confirmName")}>
                    <Saisie
                      value={confirmation}
                      onChange={(e) => setConfirmation(e.target.value)}
                      placeholder={org.name}
                      autoComplete="off"
                    />
                  </Champ>
                  {refus && <p className="mb-2 text-xs text-danger">{refus}</p>}
                  <div className="flex gap-2">
                    <Bouton variante="danger" type="submit" disabled={occupe || confirmation.trim() !== org.name}>
                      {t("org.delete")}
                    </Bouton>
                    <Bouton variante="discret" type="button" onClick={() => setCible(null)}>
                      {t("app.cancel")}
                    </Bouton>
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>

        <form onSubmit={creer} aria-label={t("org.createOrg")} className="carte mt-6 p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">{t("org.createOrg")}</h3>
          <Champ label={t("org.orgName")}>
            <Saisie value={nom} onChange={(e) => setNom(e.target.value)} placeholder={t("org.orgNamePh")} required />
          </Champ>
          <Bouton type="submit" disabled={occupe || !nom.trim()}>
            {t("org.createOrg")}
          </Bouton>
        </form>
      </div>
    </div>
  );
}
