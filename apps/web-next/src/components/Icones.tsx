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

// La croix, pour défaire une sélection.
//
// Une croix et non une flèche de retour : on ne revient pas en arrière dans une
// navigation, on referme un état. Une flèche promettrait de revenir à l'écran
// précédent, ce que ce bouton ne fait pas.
export const Croix = ({ className }: Props) => (
  <svg {...commun} className={className} aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
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

export const Bouclier = ({ className }: Props) => (
  <svg {...commun} strokeWidth={1.8} className={className} aria-hidden="true">
    <path d="M12 3.5 5 6v6c0 4 3 7.2 7 8.5 4-1.3 7-4.5 7-8.5V6z" />
    <path d="m9.2 12 2 2 3.6-3.8" />
  </svg>
);

export const Partage = ({ className }: Props) => (
  <svg {...commun} strokeWidth={1.8} className={className} aria-hidden="true">
    <circle cx="18" cy="5" r="2.5" />
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="19" r="2.5" />
    <path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4" />
  </svg>
);

export const Soleil = ({ className }: Props) => (
  <svg {...commun} strokeWidth={1.8} className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
  </svg>
);

export const Lune = ({ className }: Props) => (
  <svg {...commun} strokeWidth={1.8} className={className} aria-hidden="true">
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </svg>
);

export const Televerser = ({ className }: Props) => (
  <svg {...commun} strokeWidth={1.8} className={className} aria-hidden="true">
    <path d="M12 15V4M8.5 7.5 12 4l3.5 3.5" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </svg>
);

/// `plein` remplit l'étoile : un favori se reconnaît à sa forme pleine, pas
/// seulement à sa couleur, qui ne dit rien à qui ne la distingue pas.
export const Etoile = ({ className, plein }: Props & { plein?: boolean }) => (
  <svg {...commun} strokeWidth={1.8} fill={plein ? "currentColor" : "none"} className={className} aria-hidden="true">
    <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
  </svg>
);

export const Archive = ({ className }: Props) => (
  <svg {...commun} strokeWidth={1.8} className={className} aria-hidden="true">
    <rect x="3" y="4" width="18" height="4.5" rx="1" />
    <path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5M10 12.5h4" />
  </svg>
);

/// La surveillance du coffre : un pouls, pour ne pas reprendre le bouclier de
/// la sécurité du compte, qui est une autre chose.
export const Pouls = ({ className }: Props) => (
  <svg {...commun} strokeWidth={1.8} className={className} aria-hidden="true">
    <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />
  </svg>
);

/// Le bouton qui masque ou montre la barre latérale : un cadre et sa colonne.
export const PanneauLateral = ({ className }: Props) => (
  <svg {...commun} strokeWidth={1.8} className={className} aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </svg>
);

export const PointsDeSuite = ({ className }: Props) => (
  <svg {...commun} className={className} aria-hidden="true">
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </svg>
);

export const Agrandir = ({ className }: Props) => (
  <svg {...commun} className={className} aria-hidden="true">
    <path d="M15 3h6v6" />
    <path d="M9 21H3v-6" />
    <path d="M21 3l-7 7" />
    <path d="M3 21l7-7" />
  </svg>
);

export const LienSortant = ({ className }: Props) => (
  <svg {...commun} className={className} aria-hidden="true">
    <path d="M14 4h6v6" />
    <path d="M20 4l-9 9" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);

export const Crayon = ({ className }: Props) => (
  <svg {...commun} className={className} aria-hidden="true">
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
    <path d="M13.5 6.5l4 4" />
  </svg>
);

export const Clavier = ({ className }: Props) => (
  <svg {...commun} className={className} aria-hidden="true">
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9" />
  </svg>
);

export const Loupe = ({ className }: Props) => (
  <svg {...commun} className={className} aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </svg>
);

export const Tri = ({ className }: Props) => (
  <svg {...commun} className={className} aria-hidden="true">
    <path d="M7 4v16" />
    <path d="M3.5 16.5L7 20l3.5-3.5" />
    <path d="M17 20V4" />
    <path d="M13.5 7.5L17 4l3.5 3.5" />
  </svg>
);

export const Entonnoir = ({ className }: Props) => (
  <svg {...commun} className={className} aria-hidden="true">
    <path d="M3.5 5h17l-6.5 7.5V19l-4 2v-8.5L3.5 5Z" />
  </svg>
);

/// Les trois dispositions de la liste, dessinées comme ce qu'elles montrent.
export const VueDossiers = ({ className }: Props) => (
  <svg {...commun} className={className} aria-hidden="true">
    <path d="M4 4v13a2 2 0 0 0 2 2h3" />
    <path d="M4 9h5" />
    <rect x="11" y="6" width="9" height="5" rx="1" />
    <rect x="11" y="16" width="9" height="5" rx="1" />
  </svg>
);

export const VueListe = ({ className }: Props) => (
  <svg {...commun} className={className} aria-hidden="true">
    <path d="M9 6h11" />
    <path d="M9 12h11" />
    <path d="M9 18h11" />
    <path d="M4 6h.01" />
    <path d="M4 12h.01" />
    <path d="M4 18h.01" />
  </svg>
);

export const VueTuiles = ({ className }: Props) => (
  <svg {...commun} className={className} aria-hidden="true">
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </svg>
);
