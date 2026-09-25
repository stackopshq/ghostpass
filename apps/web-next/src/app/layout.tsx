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
// La langue est posée par le même script, et pour une raison voisine.
//
// `useI18nValue` démarre en anglais et corrige après le montage — c'est ce qu'exige
// l'hydratation, `localStorage` n'existant pas au rendu serveur. L'attribut `lang`
// restait donc faux pendant ce court moment, et il pilote la césure, la correction
// orthographique et surtout **la synthèse vocale** : un lecteur d'écran prononçait le
// français avec une voix anglaise jusqu'au montage.
//
// Le poser ici le rend juste dès le premier tracé. `suppressHydrationWarning` sur
// <html> parce que le script modifie l'arbre avant que React ne s'y reconnaisse.
const AVANT_LE_PREMIER_TRACE = `(function(){var d=document.documentElement;try{var t=localStorage.getItem('gp_theme');d.dataset.theme=t==='light'?'light':'dark';}catch(e){d.dataset.theme='dark';}try{var l=localStorage.getItem('gp_locale');if(!l){l=(navigator.language||'en').slice(0,2);}d.lang=l==='fr'?'fr':'en';}catch(e){d.lang='en';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `lang="en"` et non « fr » : c'est la langue que React rend réellement au premier
    // passage, `useI18nValue` démarrant en anglais. Annoncer « fr » ici décrivait un
    // contenu qui n'était pas celui-là. Le script ci-dessus corrige avant le tracé.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: AVANT_LE_PREMIER_TRACE }} />
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
