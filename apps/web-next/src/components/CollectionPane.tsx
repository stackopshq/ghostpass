"use client";

// Une collection d'équipe : ses secrets, leur création, leur modification, et
// qui y a accès.
//
// **C'est ici que vit la seule voie d'écriture vers une organisation.** Tout ce
// qui est enregistré passe par `encryptOrgLogin` — chiffré sous la clé de
// l'organisation, jamais sous la clé personnelle. Enregistrer un élément
// d'équipe par les points d'entrée personnels créerait une copie privée que
// l'équipe ne verrait jamais, sans qu'aucune erreur ne le dise.

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { decryptOrgItem, encryptOrgLogin, type OrgHandle } from "@/lib/crypto";
import { useI18n } from "@/lib/i18n";
import { Bouton, BoutonIcone, Champ, Liste, Panneau, Saisie, TeteDePanneau, Zone } from "@/components/champs";
import { adressesPourSaisie, ChampsAdresses } from "@/components/ChampsAdresses";
import { Oeil, OeilBarre } from "@/components/Icones";
import { SecretRow, type LigneSecret } from "@/components/SecretRow";
import { useCopie } from "@/components/useCopie";

export type Collection = { id: string; name: string; permission?: "read" | "write" | "manage" };
export type Membre = { userId: string; email: string | null; publicKey: string | null; role: string; status: string };
type Acces = {
  userId: string;
  email: string | null;
  permission: string;
  sources: { kind: string; label: string }[];
  revocable: boolean;
};

/// `urls` et non `url` : un secret d'équipe porte autant d'adresses qu'un
/// secret personnel, et le formulaire en garde toujours au moins une case.
///
/// Une FONCTION et non une constante depuis que le formulaire porte une liste :
/// une constante partagerait le même tableau entre le formulaire vierge et
/// tous ceux qui le réinitialisent.
const vide = () => ({ name: "", username: "", password: "", urls: [""], notes: "", totp: "" });

export function CollectionPane({
  token, orgId, orgRole, poignee, collection, membres, onErreur,
}: {
  token: string;
  orgId: string;
  orgRole: string;
  poignee: OrgHandle;
  collection: Collection;
  membres: Membre[];
  onErreur: (m: string) => void;
}) {
  const { t } = useI18n();
  const { copie, copier } = useCopie();
  const [items, setItems] = useState<LigneSecret[]>([]);
  const [acces, setAcces] = useState<Acces[]>([]);
  const [occupe, setOccupe] = useState(false);
  const [form, setForm] = useState(vide());
  const [enEdition, setEnEdition] = useState<string | null>(null);
  const [motDePasseVisible, setMotDePasseVisible] = useState(false);
  const [beneficiaire, setBeneficiaire] = useState("");
  const [permission, setPermission] = useState("read");

  const echoue = useCallback(
    (e: unknown) => onErreur(e instanceof Error ? e.message : String(e)),
    [onErreur],
  );

  const chargerAcces = useCallback(async () => {
    try {
      setAcces((await api.listCollectionAccess(token, orgId, collection.id)).access);
    } catch {
      // Réservé aux administrateurs côté serveur : on avale le refus plutôt que
      // d'alarmer un membre simple avec une erreur qui ne le concerne pas.
      setAcces([]);
    }
  }, [token, orgId, collection.id]);

  const charger = useCallback(async () => {
    try {
      const dtos = (await api.listCollectionItems(token, orgId, collection.id)).items;
      // `d.id` est conservé : c'est lui qui rend la modification possible.
      setItems(dtos.map((d) => ({ ...decryptOrgItem(poignee, d.encryptedKey, d.encryptedData), itemId: d.id })));
      setForm(vide());
      setEnEdition(null);
      await chargerAcces();
    } catch (err) {
      echoue(err);
    }
  }, [token, orgId, collection.id, poignee, chargerAcces, echoue]);

  useEffect(() => { void charger(); }, [charger]);

  /// Le droit d'écrire vient du serveur, pas du rôle d'organisation. Un
  /// administrateur a `manage` partout, un membre peut n'avoir que `read` sur
  /// cette collection-là. Absent — serveur antérieur au champ — on retombe sur
  /// le comportement prudent : lecture seule.
  const peutEcrire = collection.permission === "write" || collection.permission === "manage";

  async function enregistrer(e: React.FormEvent) {
    e.preventDefault();
    setOccupe(true);
    try {
      const enc = encryptOrgLogin(poignee, form);
      if (enEdition) {
        await api.updateOrgItem(token, orgId, collection.id, enEdition, enc);
      } else {
        await api.createOrgItem(token, orgId, collection.id, enc);
      }
      await charger();
    } catch (err) {
      echoue(err);
    } finally {
      setOccupe(false);
    }
  }

  async function supprimer(item: LigneSecret) {
    if (!confirm(t("org.confirmDeleteItem", { name: item.name }))) return;
    setOccupe(true);
    try {
      await api.deleteOrgItem(token, orgId, collection.id, item.itemId);
      await charger();
    } catch (err) {
      echoue(err);
    } finally {
      setOccupe(false);
    }
  }

  async function octroyer(e: React.FormEvent) {
    e.preventDefault();
    if (!beneficiaire) return;
    setOccupe(true);
    try {
      await api.grantCollectionAccess(token, orgId, collection.id, { userId: beneficiaire, permission });
      setBeneficiaire("");
      // Relire tout de suite : un octroi qui ne se voit pas est indiscernable
      // d'un octroi qui a échoué.
      await chargerAcces();
    } catch (err) {
      echoue(err);
    } finally {
      setOccupe(false);
    }
  }

  async function revoquer(userId: string) {
    setOccupe(true);
    try {
      await api.revokeCollectionAccess(token, orgId, collection.id, userId);
      await chargerAcces();
    } catch (err) {
      echoue(err);
    } finally {
      setOccupe(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Panneau>
        <TeteDePanneau titre={collection.name} compte={items.length} />
        {items.length === 0 ? (
          <p className="text-sm text-muted">{t("org.noItems")}</p>
        ) : (
          <ul className="flex flex-col">
            {items.map((it, i) => (
              <SecretRow
                key={it.itemId}
                item={it}
                cle={String(i)}
                copie={copie}
                onCopier={copier}
                actions={
                  peutEcrire && (
                    <>
                      <Bouton
                        variante="discret"
                        onClick={() => {
                          setEnEdition(it.itemId);
                          setForm({
                            name: it.name, username: it.username, password: it.password,
                            urls: adressesPourSaisie(it.urls), notes: it.note ?? "", totp: it.totp ?? "",
                          });
                          setMotDePasseVisible(false);
                        }}
                      >
                        {t("org.edit")}
                      </Bouton>
                      <Bouton variante="danger" onClick={() => supprimer(it)} disabled={occupe}>
                        {t("app.delete")}
                      </Bouton>
                    </>
                  )
                }
              />
            ))}
          </ul>
        )}
      </Panneau>

      {peutEcrire && (
        <Panneau>
          <TeteDePanneau titre={enEdition ? t("org.edit") : t("org.addItem")} />
          <form onSubmit={enregistrer} className="max-w-[480px]">
            <Champ label={t("org.name")}>
              <Saisie value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("org.namePh")} required />
            </Champ>
            <ChampsAdresses
              valeurs={form.urls}
              onChange={(urls) => setForm({ ...form, urls })}
              invite={t("org.websitePh")}
            />
            <Champ label={t("org.username")}>
              <Saisie value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder={t("org.usernamePh")} />
            </Champ>
            <Champ label={t("org.password")}>
              <span className="flex items-center gap-1">
                <Saisie
                  type={motDePasseVisible ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••"
                />
                <BoutonIcone
                  aria-label={t("org.toggleReveal")}
                  onClick={() => setMotDePasseVisible((v) => !v)}
                >
                  {motDePasseVisible ? <OeilBarre className="size-4" /> : <Oeil className="size-4" />}
                </BoutonIcone>
              </span>
            </Champ>
            <Champ label={t("org.totp")}>
              <Saisie value={form.totp} onChange={(e) => setForm({ ...form, totp: e.target.value })} placeholder="JBSWY3DPEHPK3PXP" autoComplete="off" />
            </Champ>
            <Champ label={t("org.notes")}>
              <Zone rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t("org.notesPh")} />
            </Champ>
            <div className="flex gap-2">
              <Bouton type="submit" disabled={occupe}>
                {enEdition ? t("org.save") : t("org.addItem")}
              </Bouton>
              {enEdition && (
                <Bouton type="button" variante="discret" onClick={() => { setForm(vide()); setEnEdition(null); }}>
                  {t("org.cancel")}
                </Bouton>
              )}
            </div>
          </form>
        </Panneau>
      )}

      {orgRole === "admin" && (
        <Panneau>
          <TeteDePanneau titre={t("org.access")} compte={acces.length} />
          <form onSubmit={octroyer} className="mb-4 max-w-[480px]">
            <Champ label={t("org.pickMember")}>
              <Liste value={beneficiaire} onChange={(e) => setBeneficiaire(e.target.value)}>
                <option value="" disabled>{t("org.pickMember")}</option>
                {membres.map((m) => (
                  <option key={m.userId} value={m.userId}>{m.email}</option>
                ))}
              </Liste>
            </Champ>
            <Champ label={t("org.permission")}>
              <Liste value={permission} onChange={(e) => setPermission(e.target.value)}>
                <option value="read">{t("org.permRead")}</option>
                <option value="write">{t("org.permWrite")}</option>
                <option value="manage">{t("org.permManage")}</option>
              </Liste>
            </Champ>
            <Bouton type="submit" disabled={occupe || !beneficiaire}>{t("org.grant")}</Bouton>
          </form>

          <ul className="flex flex-col">
            {acces.map((a) => (
              <li key={a.userId} className="flex items-center gap-3 border-b border-border py-2 last:border-0">
                <span className="grow truncate text-sm text-foreground">
                  {a.email}
                  <span className="ml-2 flex flex-wrap gap-1">
                    {a.sources.map((s) => (
                      <span key={s.kind + s.label} className="rounded-pill bg-surface-2 px-1.5 py-0.5 text-2xs text-muted">
                        {s.label}
                      </span>
                    ))}
                  </span>
                </span>
                <span className="text-xs text-muted">{a.permission}</span>
                {a.revocable ? (
                  <Bouton variante="danger" onClick={() => revoquer(a.userId)} disabled={occupe}>
                    {t("org.revoke")}
                  </Bouton>
                ) : (
                  // Pas de bouton du tout, plutôt qu'un bouton grisé : il n'y a
                  // rien à révoquer ici. Un administrateur se retire en changeant
                  // son rôle, un membre de groupe en quittant le groupe.
                  <span className="text-xs text-muted">{t("org.accessNotRevocable")}</span>
                )}
              </li>
            ))}
          </ul>
        </Panneau>
      )}
    </div>
  );
}
