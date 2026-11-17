// Administration de l'instance : la vue de celui qui héberge.
//
// Distincte de `orgAdmin.ts`, qui sert les administrateurs d'une organisation. Ici, le rôle
// vient de `GHOSTPASS_ADMIN_EMAILS`, posé au lancement (voir services/administration.ts).
//
// Ce que cette vue ne peut pas faire, par construction : lire un coffre. Elle ne manipule que
// des métadonnées — adresse, dates, second facteur, suspension.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { DB } from "../db/database.js";
import { sessions, users } from "../db/repositories.js";
import { makeAuthenticate } from "../plugins/auth.js";
import { recordAudit } from "../services/audit.js";
import { adminsDeLInstance, estAdminDeLInstance } from "../services/administration.js";
import { inscriptionOuverte } from "../services/inscription.js";

export function registerAdminRoutes(app: FastifyInstance, db: DB): void {
  const authenticate = makeAuthenticate(db);

  // 404 et non 403 pour qui n'est pas administrateur : la vue n'a pas à signaler son
  // existence à un compte ordinaire.
  const exigerAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!estAdminDeLInstance(req.currentUser!.email)) {
      return reply.code(404).send({ error: "introuvable" });
    }
  };
  const garde = { preHandler: [authenticate, exigerAdmin] };

  app.get("/api/admin/users", garde, async () => {
    const admins = adminsDeLInstance();
    const lignes = await users.listForAdmin(db);
    return {
      registration: inscriptionOuverte() ? "open" : "closed",
      users: lignes.map((u) => ({
        id: u.id,
        email: u.email,
        createdAt: u.created_at,
        lastLoginAt: u.last_login_at ?? null,
        mfaEnabled: u.mfa_enabled === 1,
        suspendedAt: u.suspended_at,
        isAdmin: admins.has(u.email),
      })),
    };
  });

  app.post<{ Params: { id: string } }>("/api/admin/users/:id/suspend", garde, async (req, reply) => {
    const cible = await users.findById(db, req.params.id);
    if (!cible) return reply.code(404).send({ error: "compte introuvable" });
    // Un administrateur ne se suspend pas, et n'en suspend pas un autre : le rôle vient du
    // fichier d'environnement, c'est là qu'on le retire. Sinon deux administrateurs
    // pourraient se mettre dehors l'un l'autre, et l'instance n'en aurait plus.
    if (estAdminDeLInstance(cible.email)) {
      return reply.code(409).send({
        error: "compte administrateur : le retirer de GHOSTPASS_ADMIN_EMAILS avant de le suspendre",
      });
    }
    if (!cible.suspended_at) {
      await users.setSuspended(db, cible.id, Date.now());
      // La suspension vaut tout de suite, pas à l'expiration des sessions ouvertes.
      await sessions.deleteByUser(db, cible.id);
      await recordAudit(db, req, "admin.user.suspend", {
        userId: req.currentUser!.id,
        actorEmail: req.currentUser!.email,
        target: cible.email,
      });
    }
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string } }>(
    "/api/admin/users/:id/reactivate",
    garde,
    async (req, reply) => {
      const cible = await users.findById(db, req.params.id);
      if (!cible) return reply.code(404).send({ error: "compte introuvable" });
      if (cible.suspended_at) {
        await users.setSuspended(db, cible.id, null);
        await recordAudit(db, req, "admin.user.reactivate", {
          userId: req.currentUser!.id,
          actorEmail: req.currentUser!.email,
          target: cible.email,
        });
      }
      return reply.send({ ok: true });
    },
  );
}
