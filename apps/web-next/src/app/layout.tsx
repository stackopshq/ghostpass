import type { Metadata } from "next";
import "./globals.css";
import { I18nProvider } from "@/components/I18nProvider";
import { Reglages } from "@/components/Reglages";

// Les icônes vivent dans `public/` et y étaient **muettes**.
//
// Next ne pose de `<link rel="icon">` que pour les fichiers rangés dans `src/app/`
// (`icon.svg`, `apple-icon.png`) ou déclarés ici. Ce qui dort dans `public/` reste
// joignable par URL, et n'est annoncé à personne : le navigateur retombait sur
// `/favicon.ico`, absent, et affichait la lettre grise par défaut.
//
// Les fichiers étaient donc là depuis le début, dessinés et livrés, sans que rien ne
// les lise — GhostCal, lui, affiche bien le sien.
export const metadata: Metadata = {
  title: "GhostPass",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/icon-192.png", sizes: "192x192" }],
    apple: "/apple-touch-icon.png",
  },
};

// Le thème est posé **avant le premier tracé**, sinon la page clignote.
//
// Le serveur n'a pas de `localStorage` : il rendait donc toujours le thème sombre, et
// le client basculait après montage. Qui avait choisi le clair voyait sa page
// apparaître sombre puis changer, à chaque chargement. Ce script tient dans la balise
// `<head>`, s'exécute avant que quoi que ce soit ne s'affiche, et le clignotement
// disparaît. Repris de ghostcal, qui le faisait déjà.
//
// Le défaut par défaut est **sombre** : c'est le thème de la charte, et celui dans
// lequel le produit a été dessiné.
const THEME_SANS_CLIGNOTEMENT = `(function(){try{var t=localStorage.getItem('gp_theme');document.documentElement.dataset.theme=t==='light'?'light':'dark';}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SANS_CLIGNOTEMENT }} />
      </head>
      <body>
        <I18nProvider>
          {children}
          {/* Rendue ici et non dans `VaultScreen` : elle n'existait donc que **le coffre
              ouvert**, et l'écran de connexion était le seul endroit du produit où l'on
              ne pouvait pas changer de thème. C'est aussi celui où l'on passe le plus de
              temps quand on n'arrive pas à entrer. */}
          <Reglages />
        </I18nProvider>
      </body>
    </html>
  );
}
