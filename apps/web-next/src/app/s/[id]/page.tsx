import { SendView } from "@/components/SendView";

// La clé vit dans le fragment, que le serveur ne reçoit jamais — donc cette page
// ne peut pas être rendue côté serveur avec son contenu. Seul l'identifiant
// passe par la route.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SendView id={decodeURIComponent(id)} />;
}
