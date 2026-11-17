"use client";

// L'administration de l'instance : la vue de celui qui héberge.
//
// N'apparaît que pour les adresses listées dans `GHOSTPASS_ADMIN_EMAILS`, posé au lancement
// du serveur. Elle ne montre que des métadonnées : le serveur ne peut pas lire un coffre, et
// cette vue n'y change rien.

import { useCallback, useEffect, useState } from "react";
import { api, type CompteDeLInstance } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { formatDate } from "@/lib/vault";
import { Bouton } from "@/components/champs";

export function Administration() {
  const { t, locale } = useI18n();
  const { token } = useSession();
  const [comptes, setComptes] = useState<CompteDeLInstance[]>([]);
  const [inscription, setInscription] = useState<"open" | "closed" | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    if (!token) return;
    try {
      const r = await api.adminUsers(token);
      setComptes(r.users);
      setInscription(r.registration);
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

  return (
    <div className="flex min-h-0 flex-col">
      <div className="px-5 pb-3 pt-5">
        <h2 className="text-lg font-semibold text-foreground">{t("admin.title")}</h2>
        <p className="text-xs text-muted">{t("admin.hint")}</p>
      </div>

      {erreur && (
        <p role="alert" className="mx-5 mb-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {erreur}
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 pb-5">
        {/* L'état de l'inscription d'abord : une instance ouverte à tous est la première
            chose qu'un hébergeur doit savoir, et il ne la voit nulle part ailleurs. */}
        {inscription && (
          <div
            className={`carte px-4 py-3 text-sm ${inscription === "open" ? "text-warn" : "text-foreground"}`}
          >
            <p>{inscription === "open" ? t("admin.registrationOpen") : t("admin.registrationClosed")}</p>
            <p className="mt-1 text-2xs text-muted">{t("admin.registrationHow")}</p>
          </div>
        )}

        <p className="pt-2 text-2xs text-muted">{t("admin.accounts", { n: comptes.length })}</p>

        {comptes.map((c) => (
          <div key={c.id} className="carte flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate text-sm text-foreground">
                <span className="truncate">{c.email}</span>
                {c.isAdmin && (
                  <span className="rounded-pill bg-accent/12 px-2 py-0.5 text-2xs text-accent">
                    {t("admin.adminBadge")}
                  </span>
                )}
                {c.suspendedAt && (
                  <span className="rounded-pill bg-danger/10 px-2 py-0.5 text-2xs text-danger">
                    {t("admin.suspendedBadge")}
                  </span>
                )}
              </p>
              <p className="truncate text-2xs text-muted">
                {t("admin.created", { date: formatDate(c.createdAt, locale) })}
                {" · "}
                {c.lastLoginAt
                  ? t("admin.lastLogin", { date: formatDate(c.lastLoginAt, locale) })
                  : t("admin.noLogin")}
                {" · "}
                {c.mfaEnabled ? t("admin.twoFactor") : t("admin.noTwoFactor")}
              </p>
            </div>
            {/* Pas de bouton sur un administrateur : le serveur le refuserait, le rôle se
                retire dans l'environnement du serveur. */}
            {!c.isAdmin &&
              (c.suspendedAt ? (
                <Bouton
                  variante="discret"
                  disabled={occupe}
                  aria-label={`${t("admin.reactivate")} — ${c.email}`}
                  onClick={() => agir(() => api.adminReactivate(token!, c.id))}
                >
                  {t("admin.reactivate")}
                </Bouton>
              ) : (
                <Bouton
                  variante="danger"
                  disabled={occupe}
                  aria-label={`${t("admin.suspend")} — ${c.email}`}
                  onClick={() => {
                    if (!confirm(t("admin.confirmSuspend", { email: c.email }))) return;
                    void agir(() => api.adminSuspend(token!, c.id));
                  }}
                >
                  {t("admin.suspend")}
                </Bouton>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
