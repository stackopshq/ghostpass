// Les icônes de l'interface, en un seul endroit.
//
// Elles étaient recopiées en SVG au fil des composants Svelte — donc plusieurs
// définitions d'un même dessin, qu'aucun outil ne comparait. Ici chaque figure
// n'existe qu'une fois, et `currentColor` la fait suivre la couleur du texte
// qui la porte, ce qui évite d'avoir à la repeindre par thème.

type Props = { className?: string };

const commun = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const Cadenas = ({ className }: Props) => (
  <svg {...commun} className={className} aria-hidden="true">
    <rect x="4" y="10.5" width="16" height="10.5" rx="2" />
    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
  </svg>
);

export const Alerte = ({ className }: Props) => (
  <svg {...commun} className={className} aria-hidden="true">
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
    <circle cx="12" cy="12" r="9" />
  </svg>
);

export const Oeil = ({ className }: Props) => (
  <svg {...commun} className={className} aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const OeilBarre = ({ className }: Props) => (
  <svg {...commun} className={className} aria-hidden="true">
    <path d="M9.9 4.2A10.9 10.9 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-3 3.6" />
    <path d="M6.1 6.1C3.3 7.8 2 11 2 11s3.5 7 10 7a10.9 10.9 0 0 0 3.1-.5" />
    <path d="m2 2 20 20" />
    <path d="M9.6 9.6a3 3 0 0 0 4.2 4.2" />
  </svg>
);

export const Copier = ({ className }: Props) => (
  <svg {...commun} className={className} aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);

export const Coche = ({ className }: Props) => (
  <svg {...commun} className={className} aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const Organisation = ({ className }: Props) => (
  <svg {...commun} className={className} aria-hidden="true">
    <path d="M3 21h18" />
    <path d="M5 21V7l7-4 7 4v14" />
    <path d="M9 21v-6h6v6" />
  </svg>
);

export const Dossier = ({ className }: Props) => (
  <svg {...commun} className={className} aria-hidden="true">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </svg>
);

export const Membres = ({ className }: Props) => (
  <svg {...commun} className={className} aria-hidden="true">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
  </svg>
);

export const Chevron = ({ className }: Props) => (
  <svg {...commun} strokeWidth={2.2} className={className} aria-hidden="true">
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const Coffre = ({ className }: Props) => (
  <svg {...commun} strokeWidth={1.8} className={className} aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 8.8V7M12 17v-1.8" />
  </svg>
);

export const Corbeille = ({ className }: Props) => (
  <svg {...commun} strokeWidth={1.8} className={className} aria-hidden="true">
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export const Plus = ({ className }: Props) => (
  <svg {...commun} className={className} aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const De = ({ className }: Props) => (
  <svg {...commun} strokeWidth={1.8} className={className} aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <circle cx="9" cy="9" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="15" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="9" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="9" cy="15" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);

export const Reglages = ({ className }: Props) => (
  <svg {...commun} strokeWidth={1.8} className={className} aria-hidden="true">
    <path d="M5 6h14M5 12h14M5 18h14" />
    <circle cx="9" cy="6" r="2" />
    <circle cx="15" cy="12" r="2" />
    <circle cx="8" cy="18" r="2" />
  </svg>
);
