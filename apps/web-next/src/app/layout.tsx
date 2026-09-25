import type { Metadata } from "next";
import "./globals.css";
import { I18nProvider } from "@/components/I18nProvider";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
