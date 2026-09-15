import { SendView } from "@/components/SendView";

// Un lien de partage n'a pas d'identifiant connu à la construction, et il ne
// peut pas en avoir : il désigne un secret qui n'existe pas encore. L'export
// statique produit donc UN fichier pour cette route, et c'est `SendView` qui
// lit l'identifiant réel dans le chemin au moment de l'ouverture.
//
// Côté nginx, `try_files` fait tomber `/s/<quoi-que-ce-soit>` sur ce fichier.
// La valeur ci-dessous n'est donc jamais lue — elle ne sert qu'à nommer le
// fichier produit, d'où le nom.
export function generateStaticParams() {
  return [{ id: "_gabarit" }];
}

export default function Page() {
  return <SendView />;
}
