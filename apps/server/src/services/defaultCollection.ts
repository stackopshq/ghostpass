import type { DB } from "../db/database.js";
import { collectionAccess, collections, organizations } from "../db/repositories.js";
import type { CollectionPermission, OrgRole } from "../types.js";
import { newId } from "./security.js";

/// Une organisation fraîchement créée était un cul-de-sac : un secret partagé s'attache à une
/// collection (`org_items.collection_id`), jamais à l'organisation. Il fallait donc inventer un
/// nom de compartiment avant de pouvoir ranger quoi que ce soit, alors que la demande était
/// « un coffre partagé ». Chaque organisation reçoit désormais celui-ci d'office.
export const DEFAULT_COLLECTION_NAME = "Coffre partagé";

/// Crée la collection par défaut d'une organisation et renvoie son identifiant.
export async function createDefaultCollection(db: DB, orgId: string): Promise<string> {
  const id = newId();
  await collections.create(db, { id, orgId, name: DEFAULT_COLLECTION_NAME, isDefault: true });
  return id;
}

/// Rattrapage des organisations créées avant cette collection par défaut. Ne touche que celles
/// qui n'ont **aucune** collection : une organisation qui en possède déjà a un rangement, même
/// s'il ne porte pas ce nom, et lui en ajouter un déplacerait un choix qui appartient à l'équipe.
///
/// Idempotent par construction : au deuxième passage, les organisations traitées ont une
/// collection et sortent du périmètre. Rejoué à chaque démarrage du serveur, il est donc sans
/// effet une fois le parc à jour. Aucune permission n'est accordée au passage : la collection
/// naît vide, et l'accès reste ce qu'un administrateur en décide.
export async function ensureDefaultCollections(db: DB): Promise<number> {
  const orphans = await organizations.listWithoutCollections(db);
  for (const org of orphans) await createDefaultCollection(db, org.id);
  return orphans.length;
}

/// Permission attachée à la collection par défaut pour un rôle invité. `null` pour un
/// administrateur : il voit toutes les collections de son organisation sans octroi (cf.
/// `permissionFor` dans `routes/orgVault.ts`), lui écrire une ligne d'accès n'ajouterait rien.
function permissionForRole(role: OrgRole): CollectionPermission | null {
  if (role === "admin") return null;
  return role === "readonly" ? "read" : "write";
}

/// Ouvre le coffre commun à un membre qu'on vient d'inviter. Décision produit : inviter
/// quelqu'un, c'est lui donner l'accès au coffre partagé, sinon l'invitation ne donne rien de
/// visible et il faut un second geste que personne ne pense à faire.
///
/// Ce qui n'est **pas** fait ici : accorder les **autres** collections. Elles existent pour
/// cloisonner, et les ouvrir à l'invitation viderait la fonction de son sens. Une organisation
/// sans collection par défaut (elle en avait d'autres avant le rattrapage) ne reçoit donc rien.
export async function grantDefaultCollectionAccess(
  db: DB,
  args: { orgId: string; userId: string; role: OrgRole },
): Promise<void> {
  const permission = permissionForRole(args.role);
  if (permission === null) return;
  const collection = await collections.findDefault(db, args.orgId);
  if (!collection) return;
  await collectionAccess.grant(db, {
    id: newId(),
    collectionId: collection.id,
    userId: args.userId,
    permission,
  });
}
