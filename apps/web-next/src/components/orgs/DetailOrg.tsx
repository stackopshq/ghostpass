"use client";

// Une organisation ouverte : ses collections, ses secrets partagés, ses membres.
//
// La clé d'organisation est ouverte à l'entrée et vit dans l'état de ce
// composant. Révoquer un membre la fait TOURNER : nouvelle clé, re-scellée pour
// chaque membre restant, et toutes les entrées ré-enveloppées — sans quoi la
// personne révoquée garderait de quoi lire ce qu'elle a déjà vu passer.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  createOrg,
  decryptOrgItem,
  encryptOrgLogin,
  openOrg,
  rewrapOrgItem,
  sealOrgKeyForMember,
  type DecryptedItem,
  type OrgHandle,
} from "@/lib/crypto";
import { useI18n } from "@/lib/i18n";
import { historiqueApresModification } from "@/lib/vault";
import { saisieDepuisElement, saisieEquipeVide } from "@/lib/formulaireEquipe";
import { useSession } from "@/lib/session";
import { peutEcrire, type AccesEffectif, type Collection, type Member, type OrgSummary } from "@/lib/orgs";
import { Bouton, Champ, Liste, Saisie, Zone } from "@/components/champs";
import { ChampsAdresses } from "@/components/ChampsAdresses";
import { SecretRow, type LigneSecret } from "@/components/SecretRow";
import { useCopie } from "@/components/useCopie";
import { Dossier, Membres } from "@/components/Icones";

type Volet = "collection" | "membres" | null;

/// `urls` et non `url` : un secret d'équipe porte autant d'adresses qu'un
/// secret personnel. Une FONCTION et non une constante, pour que deux
/// formulaires vierges ne partagent pas le même tableau d'adresses.


export function DetailOrg({ org, onRetour }: { org: OrgSummary; onRetour: () => void }) {
  const { t } = useI18n();
  const { token, account } = useSession();
  const { copie, copier } = useCopie();

  const [cle, setCle] = useState<OrgHandle | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [choisie, setChoisie] = useState<Collection | null>(null);
  const [items, setItems] = useState<LigneSecret[]>([]);
  const [membres, setMembres] = useState<Member[]>([]);
  const [acces, setActes] = useState<AccesEffectif[]>([]);
  const [volet, setVolet] = useState<Volet>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const [nouvelleColl, setNouvelleColl] = useState("");
  const [courriel, setCourriel] = useState("");
  const [role, setRole] = useState("member");
  const [saisie, setSaisie] = useState(saisieEquipeVide());
  const [edition, setEdition] = useState<string | null>(null);

  const echoue = (e: unknown) => setErreur(e instanceof Error ? e.message : String(e));

  // `ouvrir` a besoin d'`ouvrirCollection`, qui est déclarée après elle. Une référence
  // brise le cycle sans réordonner le fichier ni recréer `ouvrir` à chaque rendu — ce qui
  // relancerait son `useEffect` en boucle.
  const ouvrirCollectionRef = useRef<
    ((c: Collection, poignee?: OrgHandle | null) => Promise<void>) | null
  >(null);

  const ouvrir = useCallback(async () => {
    if (!token || !account) return;
    setOccupe(true);
    try {
      const m = await api.getMembership(token, org.orgId);
      if (!m.encryptedOrgKey || !m.sealedByPublicKey) throw new Error(t("org.keyUnavailable"));
      const poignee = openOrg(account, m.sealedByPublicKey, m.encryptedOrgKey);
      setCle(poignee);
      const cols = (await api.listCollections(token, org.orgId)).collections;
      setCollections(cols);
      setMembres(org.role === "admin" ? (await api.listMembers(token, org.orgId)).members : []);
      setChoisie(null);
      setItems([]);
      setVolet(null);
      setErreur(null);
      // ─── Ouvrir sur le contenu, pas sur une invitation à cliquer ───
      //
      // Le panneau s'ouvrait vide, avec un texte d'attente. Quelqu'un qui entre dans son
      // organisation vient voir des mots de passe : les lui faire chercher derrière un clic
      // supplémentaire, quand il n'y a le plus souvent **qu'une seule collection**, donne
      // l'impression d'un coffre vide.
      //
      // `poignee` est passée explicitement : `setCle` ne met pas `cle` à jour avant le
      // rendu suivant, et `ouvrirCollection` sortirait en silence sur sa garde `!poignee`.
      // C'est exactement pour cela que ce paramètre existe.
      if (cols.length > 0) await ouvrirCollectionRef.current?.(cols[0], poignee);
    } catch (e) {
      echoue(e);
    } finally {
      setOccupe(false);
    }
  }, [token, account, org, t]);

  useEffect(() => {
    void ouvrir();
  }, [ouvrir]);

  const ouvrirCollection = useCallback(
    async (c: Collection, poignee = cle) => {
      // Sortir en silence laissait un clic sans effet : ni contenu, ni message, et un
      // panneau qui affiche « choisissez une collection » alors qu'on vient d'en choisir
      // une. On dit pourquoi.
      if (!token) return;
      if (!poignee) {
        setErreur(t("org.keyUnavailable"));
        return;
      }
      setChoisie(c);
      setVolet("collection");
      try {
        const dtos = (await api.listCollectionItems(token, org.orgId, c.id)).items;
        // On garde `d.id` : sans lui aucune modification n'est possible, et
        // c'est la raison de fond pour laquelle un mot de passe d'équipe ne
        // pouvait pas être corrigé une fois enregistré.
        setItems(
          dtos.map((d) => ({ ...decryptOrgItem(poignee, d.encryptedKey, d.encryptedData), itemId: d.id })),
        );
        setSaisie(saisieEquipeVide());
        setEdition(null);
        try {
          setActes((await api.listCollectionAccess(token, org.orgId, c.id)).access);
        } catch {
          // Réservé aux gestionnaires côté serveur : on avale le refus plutôt
          // que d'alarmer un membre simple avec une erreur qui ne le concerne pas.
          setActes([]);
        }
      } catch (e) {
        echoue(e);
      }
    },
    [token, org.orgId, cle],
  );

  ouvrirCollectionRef.current = ouvrirCollection;

  const agir = async (fn: () => Promise<unknown>) => {
    setOccupe(true);
    try {
      await fn();
    } catch (e) {
      echoue(e);
    } finally {
      setOccupe(false);
    }
  };

  const enregistrerItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !cle || !choisie) return;
    await agir(async () => {
      const enCours = edition ? items.find((i) => i.itemId === edition) : undefined;
      const enc = encryptOrgLogin(cle, {
        ...saisie,
        passwordHistory: historiqueApresModification(
          enCours?.password,
          saisie.password,
          saisie.passwordHistory,
        ),
      });
      if (edition) await api.updateOrgItem(token, org.orgId, choisie.id, edition, enc);
      else await api.createOrgItem(token, org.orgId, choisie.id, enc);
      await ouvrirCollection(choisie);
    });
  };

  const supprimerItem = async (item: LigneSecret) => {
    if (!token || !choisie) return;
    if (!confirm(t("org.confirmDeleteItem", { name: item.name }))) return;
    await agir(async () => {
      await api.deleteOrgItem(token, org.orgId, choisie.id, item.itemId);
      await ouvrirCollection(choisie);
    });
  };

  /// Révoquer, c'est tourner la clé — pas seulement retirer une ligne.
  const revoquer = async (m: Member) => {
    if (!token || !account || !cle) return;
    if (!confirm(t("org.confirmRevoke", { email: m.email ?? "" }))) return;
    await agir(async () => {
      const { org: nouvelle } = createOrg(account);
      const restants = membres
        .filter((x) => x.userId !== m.userId && x.publicKey)
        .map((x) => ({ userId: x.userId, encryptedOrgKey: sealOrgKeyForMember(account, nouvelle, x.publicKey!) }));
      const tous = (await api.listOrgItems(token, org.orgId)).items;
      await api.rotateOrg(token, org.orgId, {
        revokeUserId: m.userId,
        members: restants,
        items: tous.map((it) => ({
          id: it.id,
          encryptedKey: rewrapOrgItem(nouvelle, cle, it.encryptedKey, it.encryptedData),
        })),
      });
      setCle(nouvelle);
      setMembres((await api.listMembers(token, org.orgId)).members);
      if (choisie) await ouvrirCollection(choisie, nouvelle);
    });
  };

  const ecrivable = peutEcrire(choisie);

  return (
    <div className="grid min-h-0 grid-cols-1 md:grid-cols-[16rem_1fr]">
      <aside className="verre-dense min-h-0 overflow-y-auto border-r border-border p-3">
        <button
          type="button"
          onClick={onRetour}
          className="mb-4 cursor-pointer rounded-lg px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-surface hover:text-foreground"
        >
          {t("org.backToOrgs")}
        </button>

        <p className="px-3 pb-2 text-sm font-semibold text-foreground">{org.name}</p>

        {org.role === "admin" && (
          <button
            type="button"
            onClick={() => {
              setVolet("membres");
              setChoisie(null);
            }}
            aria-current={volet === "membres" ? "page" : undefined}
            className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors ${volet === "membres" ? "bg-accent/12 font-medium text-accent" : "text-muted hover:bg-surface hover:text-foreground"}`}
          >
            <Membres className="size-4 shrink-0" />
            {t("org.members")}
          </button>
        )}

        <p className="mt-5 mb-1 px-3 text-2xs uppercase tracking-widest text-muted">{t("org.collections")}</p>
        {collections.length === 0 && <p className="px-3 py-2 text-xs text-muted">{t("org.noCollections")}</p>}
        {collections.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => void ouvrirCollection(c)}
            aria-current={choisie?.id === c.id ? "page" : undefined}
            className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${choisie?.id === c.id ? "bg-accent/12 font-medium text-accent" : "text-muted hover:bg-surface hover:text-foreground"}`}
          >
            <Dossier className="size-4 shrink-0" />
            <span className="truncate">{c.name}</span>
          </button>
        ))}

        <form
          aria-label={t("org.newCollection")}
          className="mt-3 flex gap-1.5 px-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (!token || !nouvelleColl.trim()) return;
            void agir(async () => {
              await api.createCollection(token, org.orgId, { name: nouvelleColl.trim() });
              setNouvelleColl("");
              setCollections((await api.listCollections(token, org.orgId)).collections);
            });
          }}
        >
          <Saisie
            value={nouvelleColl}
            onChange={(e) => setNouvelleColl(e.target.value)}
            placeholder={t("org.newCollection")}
            className="py-1.5 text-xs"
          />
        </form>
      </aside>

      <div className="min-h-0 overflow-y-auto px-6 py-5">
        {erreur && (
          <p role="alert" className="mb-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {erreur}
          </p>
        )}

        {volet === "membres" && (
          <div className="mx-auto max-w-3xl">
            <h2 className="text-lg font-semibold text-foreground">{t("org.members")}</h2>
            <p className="mb-5 text-xs text-muted">{t("org.membersCount", { n: membres.length })}</p>

            <div className="space-y-2">
              {membres.map((m) => (
                <div key={m.userId} className="carte flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{m.email ?? t("org.unknownEmail")}</p>
                    <p className="text-2xs text-muted">
                      {m.role} · {m.status}
                    </p>
                  </div>
                  <Bouton variante="danger" onClick={() => void revoquer(m)} disabled={occupe}>
                    {t("org.revoke")}
                  </Bouton>
                </div>
              ))}
            </div>

            <form
              aria-label={t("org.invite")}
              className="carte mt-6 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!token || !account || !cle) return;
                void agir(async () => {
                  const { publicKey } = await api.lookupPublicKey(token, courriel);
                  await api.addMember(token, org.orgId, {
                    email: courriel,
                    role,
                    encryptedOrgKey: sealOrgKeyForMember(account, cle, publicKey),
                  });
                  setCourriel("");
                  setMembres((await api.listMembers(token, org.orgId)).members);
                });
              }}
            >
              <h3 className="mb-3 text-sm font-semibold text-foreground">{t("org.invite")}</h3>
              {/* Dit avant l'action ce qui se passe après : la personne doit déjà avoir un compte
                  (c'est sa clé publique qui scelle celle de l'équipe), et rien ne lui est envoyé —
                  aucun courriel n'existe dans ce produit. Sans cette phrase, on invite puis on
                  attend un message qui ne viendra jamais. */}
              <p className="mb-3 text-xs text-muted">{t("org.inviteNote")}</p>
              <Champ label={t("org.email")}>
                <Saisie type="email" value={courriel} onChange={(e) => setCourriel(e.target.value)} required />
              </Champ>
              <Champ label={t("org.role")}>
                <Liste value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </Liste>
              </Champ>
              <Bouton type="submit" disabled={occupe || !courriel}>
                {t("org.invite")}
              </Bouton>
            </form>
          </div>
        )}

        {volet === "collection" && choisie && (
          <div className="mx-auto max-w-3xl">
            <h2 className="text-lg font-semibold text-foreground">{choisie.name}</h2>
            <p className="mb-5 text-xs text-muted">
              {/* La permission effective en toutes lettres : c'est elle qui
                  décide des boutons, autant qu'elle se lise. */}
              {choisie.permission ?? "read"}
            </p>

            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.itemId} className="carte px-4 py-3">
                  <SecretRow
                    item={item}
                    cle={item.itemId}
                    copie={copie}
                    onCopier={copier}
                    actions={
                      ecrivable ? (
                        <span className="flex gap-2">
                          <Bouton
                            variante="discret"
                            onClick={() => {
                              setEdition(item.itemId);
                              setSaisie(saisieDepuisElement(item));
                            }}
                          >
                            {t("org.edit")}
                          </Bouton>
                          <Bouton variante="danger" onClick={() => void supprimerItem(item)} disabled={occupe}>
                            {t("org.delete")}
                          </Bouton>
                        </span>
                      ) : undefined
                    }
                  />
                </div>
              ))}
            </div>

            {ecrivable && (
              <form aria-label={t("org.newSecret")} onSubmit={enregistrerItem} className="carte mt-6 p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">
                  {edition ? t("org.edit") : t("org.newSecret")}
                </h3>
                <Champ label={t("org.name")}>
                  <Saisie
                    value={saisie.name}
                    onChange={(e) => setSaisie({ ...saisie, name: e.target.value })}
                    placeholder={t("org.namePh")}
                    required
                  />
                </Champ>
                <Champ label={t("org.username")}>
                  <Saisie
                    value={saisie.username}
                    onChange={(e) => setSaisie({ ...saisie, username: e.target.value })}
                    placeholder={t("org.usernamePh")}
                  />
                </Champ>
                <Champ label={t("org.password")}>
                  <Saisie
                    type="password"
                    value={saisie.password}
                    onChange={(e) => setSaisie({ ...saisie, password: e.target.value })}
                    autoComplete="off"
                  />
                </Champ>
                <ChampsAdresses
                  valeurs={saisie.urls}
                  onChange={(urls) => setSaisie({ ...saisie, urls })}
                  invite={t("org.websitePh")}
                />
                <Champ label={t("org.notes")}>
                  <Zone
                    value={saisie.notes}
                    onChange={(e) => setSaisie({ ...saisie, notes: e.target.value })}
                    rows={3}
                  />
                </Champ>
                <div className="flex gap-2">
                  <Bouton type="submit" disabled={occupe}>
                    {edition ? t("app.save") : t("org.add")}
                  </Bouton>
                  {edition && (
                    <Bouton
                      variante="discret"
                      type="button"
                      onClick={() => {
                        setEdition(null);
                        setSaisie(saisieEquipeVide());
                      }}
                    >
                      {t("app.cancel")}
                    </Bouton>
                  )}
                </div>
              </form>
            )}

            {acces.length > 0 && (
              <div className="carte mt-6 p-4">
                <h3 className="mb-1 text-sm font-semibold text-foreground">{t("org.accessWho")}</h3>
                <p className="mb-3 text-2xs text-muted">{t("org.accessEffective")}</p>
                <ul className="space-y-2">
                  {acces.map((a) => (
                    <li key={a.userId} className="flex items-center gap-3 text-sm">
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {a.email ?? t("org.unknownEmail")}
                      </span>
                      <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-2xs text-muted">
                        {a.permission}
                      </span>
                      {a.revocable && (
                        <Bouton
                          variante="danger"
                          disabled={occupe}
                          onClick={() =>
                            void agir(async () => {
                              await api.revokeCollectionAccess(token!, org.orgId, choisie.id, a.userId);
                              await ouvrirCollection(choisie);
                            })
                          }
                        >
                          {t("org.revoke")}
                        </Bouton>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {volet === null && (
          <div className="grid h-full place-items-center text-center text-sm text-muted">
            <p>{t("org.pickInLeft")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
