import type { FastifyInstance } from "fastify";

/**
 * L'adresse de la politique de confidentialité, telle que **ce déploiement** la sert.
 *
 * Le défaut est la page que l'application sert elle-même, construite depuis
 * `docs/legal/`. C'est juste quand StackOps héberge.
 *
 * Ce ne l'est pas pour une instance auto-hébergée, et GhostPass s'auto-héberge : là, le
 * responsable du traitement est celui qui l'héberge. Servir notre texte sous son nom de
 * domaine lui ferait publier nos coordonnées, nos sous-traitants et nos délais de
 * conservation comme s'ils étaient les siens.
 */
function privacyUrl(): string {
  return process.env.GHOSTPASS_PRIVACY_URL?.trim() || "/confidentialite";
}

/**
 * Les faits propres au déploiement que le navigateur ne peut pas deviner.
 *
 * **Pourquoi une route et non une variable de construction.** Le client web est un export
 * statique (`output: "export"`) : tout `NEXT_PUBLIC_*` y est gravé dans le paquet au moment
 * de la construction. Un auto-hébergeur tire l'image publiée — poser la variable chez lui
 * ne changerait rien, et rien ne le lui dirait. C'est le défaut que GhostCal a mesuré le
 * 2026-08-16 sur le déploiement Apollo, sur une autre adresse : un bouton qui ouvrait un
 * onglet mort, en silence.
 *
 * La question à se poser pour tout réglage : « est-ce la même valeur pour toutes les
 * instances de cette image ? » Si non, c'est le déploiement qui répond, pas la
 * construction.
 */
export function registerConfigRoutes(app: FastifyInstance): void {
  app.get("/api/config", async () => ({ privacyUrl: privacyUrl() }));
}
