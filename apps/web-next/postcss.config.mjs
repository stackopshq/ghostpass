// Tailwind 4 se branche par PostCSS et déclare son thème EN CSS, via `@theme`.
// C'est ce qui permet au préréglage de la suite de n'être que des propriétés
// personnalisées : aucune valeur n'est répétée dans un fichier de configuration
// JavaScript qui pourrait dériver de son thème.
export default { plugins: { "@tailwindcss/postcss": {} } };
