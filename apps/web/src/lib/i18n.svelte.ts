/// Bilingue FR/EN, sur le meme modele que ghostcal (`frontend/src/lib/i18n.tsx`) :
/// deux dictionnaires a cles pointees, preference persistee, repli sur l'anglais
/// puis sur la cle elle-meme. Meme semantique, portee de React a Svelte 5 --
/// le contexte y devient un etat de module, pas une bibliotheque de plus.
///
/// La cle est rendue telle quelle quand la traduction manque : une chaine
/// absente doit se voir a l'ecran, pas disparaitre en case vide.

export type Locale = "en" | "fr";

export const LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "EN" },
  { code: "fr", label: "FR" },
];

const STORAGE_KEY = "gp_locale";

type Dict = Record<string, string>;

const en: Dict = {
  // — organisations : collections et secrets partages —
  "org.members": "Members",
  "org.membersCount": "{n} member(s) · access by collection",
  "org.unknownEmail": "Unknown address",
  "org.revoke": "Revoke",
  "org.inviteTitle": "Invite a member",
  "org.email": "Email",
  "org.role": "Role",
  "org.roleMember": "Member",
  "org.roleReadonly": "Read-only",
  "org.roleAdmin": "Admin",
  "org.invite": "Invite",
  "org.secretsCount": "{n} secret(s)",
  "org.emptyCollection": "No secret shared in this collection.",
  "org.addSecret": "Share a secret",
  "org.editSecret": "Edit secret",
  "org.name": "Name",
  "org.website": "Website",
  "org.username": "Username",
  "org.password": "Password",
  "org.totpKey": "TOTP key",
  "org.totpHint": "(base32 secret or otpauth://)",
  "org.notes": "Notes",
  "org.notesPh": "Context, procedure, contact…",
  "org.save": "Save changes",
  "org.encryptShare": "Encrypt & share",
  "org.cancel": "Cancel",
  "org.show": "Show",
  "org.hide": "Hide",
  "org.showPassword": "Show password",
  "org.hidePassword": "Hide password",
  "org.edit": "Edit",
  "org.copyUsername": "Copy username",
  "org.copyPassword": "Copy password",
  "org.copyTotp": "Copy TOTP code",
  "org.noUsername": "No username",
  "org.accessTitle": "Collection access",
  "org.member": "Member",
  "org.pickMember": "Choose a member…",
  "org.permission": "Permission",
  "org.permRead": "Read",
  "org.permWrite": "Write",
  "org.permManage": "Manage",
  "org.grant": "Grant access",
  "org.accessNone": "Nobody has explicit access to this collection.",
  "org.accessWho": "Who has access today",
  "org.newCollection": "New collection",
  "org.createCollection": "Create collection",
  "org.backToOrgs": "← My organisations",
  "org.myOrgs": "My organisations",
  "org.createOrg": "Create an organisation",
  "org.orgName": "Organisation name",
  "org.orgNamePh": "StackOps Team",
  "org.noOrgs": "No organisation yet.",
  "org.noOrgsSub": "Create one to share secrets with your team.",
  "org.nameRequired": "Give the organisation a name to create it.",
  "org.open": "Open",
  "org.accept": "Accept invitation",
  "org.delete": "Delete",
  "org.confirmName": "Type the organisation name to confirm",
  "org.collections": "Collections",
  "org.noCollections": "No collection.",
  "org.pickInLeft": "in the left column.",
  "org.toggleReveal": "Show/hide",
  "org.namePh": "Prod DB",
  "org.usernamePh": "svc",
  "org.websitePh": "example.com",
};

const fr: Dict = {
  "org.members": "Membres",
  "org.membersCount": "{n} membre(s) · accès par collection",
  "org.unknownEmail": "Adresse inconnue",
  "org.revoke": "Révoquer",
  "org.inviteTitle": "Inviter un membre",
  "org.email": "Email",
  "org.role": "Rôle",
  "org.roleMember": "Membre",
  "org.roleReadonly": "Lecture seule",
  "org.roleAdmin": "Admin",
  "org.invite": "Inviter",
  "org.secretsCount": "{n} secret(s)",
  "org.emptyCollection": "Aucun secret partagé dans cette collection.",
  "org.addSecret": "Partager un secret",
  "org.editSecret": "Modifier le secret",
  "org.name": "Nom",
  "org.website": "Site web",
  "org.username": "Identifiant",
  "org.password": "Mot de passe",
  "org.totpKey": "Clé TOTP",
  "org.totpHint": "(secret base32 ou otpauth://)",
  "org.notes": "Notes",
  "org.notesPh": "Contexte, procédure, contact…",
  "org.save": "Enregistrer les modifications",
  "org.encryptShare": "Chiffrer & partager",
  "org.cancel": "Annuler",
  "org.show": "Afficher",
  "org.hide": "Masquer",
  "org.showPassword": "Afficher le mot de passe",
  "org.hidePassword": "Masquer le mot de passe",
  "org.edit": "Modifier",
  "org.copyUsername": "Copier l'identifiant",
  "org.copyPassword": "Copier le mot de passe",
  "org.copyTotp": "Copier le code TOTP",
  "org.noUsername": "Sans identifiant",
  "org.accessTitle": "Accès à la collection",
  "org.member": "Membre",
  "org.pickMember": "Choisir un membre…",
  "org.permission": "Permission",
  "org.permRead": "Lecture",
  "org.permWrite": "Écriture",
  "org.permManage": "Gestion",
  "org.grant": "Accorder l'accès",
  "org.accessNone": "Personne n'a d'accès explicite à cette collection.",
  "org.accessWho": "Qui a accès aujourd'hui",
  "org.newCollection": "Nouvelle collection",
  "org.createCollection": "Créer la collection",
  "org.backToOrgs": "← Mes organisations",
  "org.myOrgs": "Mes organisations",
  "org.createOrg": "Créer une organisation",
  "org.orgName": "Nom de l'organisation",
  "org.orgNamePh": "StackOps Team",
  "org.noOrgs": "Aucune organisation pour l'instant.",
  "org.noOrgsSub": "Créez-en une pour partager des secrets en équipe.",
  "org.nameRequired": "Donnez un nom à l'organisation pour pouvoir la créer.",
  "org.open": "Ouvrir",
  "org.accept": "Accepter l'invitation",
  "org.delete": "Supprimer",
  "org.confirmName": "Saisissez le nom de l'organisation pour confirmer",
  "org.collections": "Collections",
  "org.noCollections": "Aucune collection.",
  "org.pickInLeft": "dans la colonne de gauche.",
  "org.toggleReveal": "Afficher/masquer",
  "org.namePh": "DB prod",
  "org.usernamePh": "svc",
  "org.websitePh": "exemple.com",
};

const messages: Record<Locale, Dict> = { en, fr };

function detect(): Locale {
  if (typeof window === "undefined") return "en";
  const stored = localStorage.getItem(STORAGE_KEY) as Locale | null;
  if (stored && messages[stored]) return stored;
  const nav = (navigator.language || "en").slice(0, 2) as Locale;
  return messages[nav] ? nav : "en";
}

let locale = $state<Locale>(detect());

export function getLocale(): Locale {
  return locale;
}

export function setLocale(l: Locale): void {
  locale = l;
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, l);
    // L'attribut `lang` du document suit la langue choisie : il pilote la
    // cesure, la synthese vocale et la correction orthographique. Le laisser
    // fige a "fr" ferait lire l'anglais avec les regles du francais.
    document.documentElement.lang = l;
  }
}

export function t(key: string, params?: Record<string, string | number>): string {
  let s = messages[locale][key] ?? en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}
