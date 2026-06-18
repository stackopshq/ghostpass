// Vérification de fuite via Have I Been Pwned, en k-anonymity.
// Seuls les 5 premiers caractères du SHA-1 du mot de passe sont envoyés ; le mot de passe (et même
// son hash complet) ne quitte jamais l'appareil. L'API renvoie tous les suffixes du préfixe ;
// la correspondance se fait localement. Appel explicite, déclenché par l'utilisateur.

async function sha1Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/// Renvoie le nombre d'apparitions du mot de passe dans des fuites connues (0 = jamais vu).
export async function pwnedCount(password: string): Promise<number> {
  if (!password) return 0;
  const hash = await sha1Hex(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  // `Add-Padding` renvoie des entrées factices (count 0) pour masquer la taille de la réponse.
  const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: { "Add-Padding": "true" },
  });
  if (!res.ok) throw new Error("service de vérification des fuites indisponible");
  const text = await res.text();
  for (const line of text.split("\n")) {
    const [s, c] = line.trim().split(":");
    if (s === suffix) return Number.parseInt(c ?? "0", 10) || 0;
  }
  return 0;
}
