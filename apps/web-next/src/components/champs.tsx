"use client";

// Les briques de formulaire, écrites une fois.
//
// L'ancienne feuille portait `.field`, `.panel`, `.ghost`, `.danger` — des
// classes de composant dans un fichier de 2 083 lignes que personne ne relisait.
// Ici la forme vit avec l'élément, et les valeurs viennent des jetons de la
// suite : aucune couleur ni taille n'est écrite en dur.

import type { ReactNode } from "react";

export function Panneau({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-border bg-surface p-5 ${className}`}>
      {children}
    </section>
  );
}

export function TeteDePanneau({ titre, compte }: { titre: string; compte?: number }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <h2 className="text-lg font-semibold text-foreground">{titre}</h2>
      {compte !== undefined && (
        <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-2xs text-muted">{compte}</span>
      )}
    </div>
  );
}

export function Champ({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

const saisie =
  "w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm text-foreground " +
  "placeholder:text-muted focus:border-accent focus:outline-none";

export function Saisie(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${saisie} ${props.className ?? ""}`} />;
}

export function Zone(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${saisie} ${props.className ?? ""}`} />;
}

export function Liste(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${saisie} ${props.className ?? ""}`} />;
}

type BoutonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: "principal" | "discret" | "danger";
};

export function Bouton({ variante = "principal", className = "", ...reste }: BoutonProps) {
  const styles = {
    principal: "bg-accent text-accent-ink hover:opacity-90",
    discret: "border border-border text-foreground hover:border-border-strong",
    // Rouge, et pas la couleur d'accent : une action destructrice doit se lire
    // comme telle AVANT le clic. La variante empruntait l'accent, si bien que
    // « Supprimer » avait exactement l'allure de « Modifier » — c'est le premier
    // reproche de Clara sur cet écran, et il vaut pour les deux plateformes.
    danger:
      "border border-danger/40 text-danger hover:bg-danger hover:text-white hover:border-danger",
  }[variante];
  return (
    <button
      {...reste}
      className={`cursor-pointer rounded px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function BoutonIcone({ actif, className = "", ...reste }: React.ButtonHTMLAttributes<HTMLButtonElement> & { actif?: boolean }) {
  return (
    <button
      type="button"
      {...reste}
      className={`cursor-pointer rounded p-1 transition-colors ${actif ? "text-accent" : "text-muted hover:text-foreground"} ${className}`}
    />
  );
}
