// Une réponse trop volumineuse doit être coupée PENDANT qu'elle arrive.
//
// Le pair iOS a posé la borne à 32 Mio, avec la remarque qui est le cœur du
// sujet : une borne posée au décodage ne borne rien. Quand on mesure la taille
// d'un corps déjà décodé, il est entier en mémoire — le mal est fait, et il ne
// reste qu'à le constater.
//
// Le cas qui compte est donc le serveur qui N'ANNONCE PAS `Content-Length`.
// Un serveur hostile ne le remplira pas par politesse, et c'est précisément
// celui contre lequel on se protège. Le test sans en-tête est le seul qui
// prouve quelque chose : celui avec `Content-Length` peut passer par un
// raccourci qui ne protège de rien.

import { test } from "node:test";
import assert from "node:assert/strict";
import { api, TAILLE_MAX_REPONSE } from "../src/lib/api";

const JETON = "jeton-de-session-de-test";
const MIO = 1024 * 1024;

test("la borne est celle du client iOS", () => {
  assert.equal(TAILLE_MAX_REPONSE, 32 * MIO);
});

/// Un corps JSON valide et volumineux, servi en flux.
///
/// Il est VALIDE à dessein : un corps tronqué ferait échouer l'ancien code sur
/// une erreur d'analyse JSON, et le témoin passerait alors pour la mauvaise
/// raison — on croirait avoir mesuré une protection là où l'on n'a mesuré
/// qu'un charabia.
function corpsJsonDe(mio: number): { flux: ReadableStream<Uint8Array>; annule: () => boolean } {
  const bloc = new TextEncoder().encode("a".repeat(MIO));
  let restant = mio;
  let annule = false;
  let debut = true;
  const flux = new ReadableStream<Uint8Array>({
    pull(controleur) {
      if (debut) {
        debut = false;
        controleur.enqueue(new TextEncoder().encode('{"x":"'));
        return;
      }
      if (restant > 0) {
        restant -= 1;
        controleur.enqueue(bloc);
        return;
      }
      controleur.enqueue(new TextEncoder().encode('"}'));
      controleur.close();
    },
    cancel() {
      annule = true;
    },
  });
  return { flux, annule: () => annule };
}

/// Remplace `fetch` par une réponse en flux, et rend l'appel plus le témoin
/// d'annulation du corps.
async function avecReponse<T>(
  reponse: () => Response,
  appel: () => Promise<T>,
): Promise<{ resultat: T | Error }> {
  const origine = globalThis.fetch;
  globalThis.fetch = (async () => reponse()) as typeof fetch;
  try {
    return { resultat: await appel() };
  } catch (e) {
    return { resultat: e instanceof Error ? e : new Error(String(e)) };
  } finally {
    globalThis.fetch = origine;
  }
}

// ─── LE test : aucun `Content-Length` annoncé ───

test("un corps sans Content-Length est coupé au franchissement du seuil", async () => {
  const { flux, annule } = corpsJsonDe(33);
  const { resultat } = await avecReponse(
    () => new Response(flux, { status: 200, headers: { "content-type": "application/json" } }),
    () => api.listItems(JETON),
  );

  assert.ok(
    resultat instanceof Error,
    "33 Mio sans Content-Length ont été lus jusqu'au bout : la borne ne borne rien",
  );
  assert.match(
    (resultat as Error).message,
    /trop volumineuse/,
    `échec pour une autre raison que la taille : ${(resultat as Error).message}`,
  );
  assert.equal(
    annule(),
    true,
    "le corps n'a pas été annulé — cesser de lire laisse le serveur continuer d'émettre",
  );
});

test("un corps sans Content-Length juste sous le seuil passe entièrement", async () => {
  // La borne doit couper ce qui dépasse, et RIEN d'autre. Sans cette moitié,
  // « tout refuser » satisferait le test précédent.
  const utile = "y".repeat(3 * MIO);
  const flux = new ReadableStream<Uint8Array>({
    start(controleur) {
      controleur.enqueue(new TextEncoder().encode(JSON.stringify({ items: [{ id: utile }] })));
      controleur.close();
    },
  });
  const { resultat } = await avecReponse(
    () => new Response(flux, { status: 200, headers: { "content-type": "application/json" } }),
    () => api.listItems(JETON),
  );
  assert.ok(!(resultat instanceof Error), `refusé à tort : ${(resultat as Error)?.message}`);
  assert.equal((resultat as { items: Array<{ id: string }> }).items[0]!.id, utile);
});

test("un corps découpé en morceaux se recolle correctement", async () => {
  // La lecture par flux décode morceau par morceau. Un caractère multi-octets
  // coupé entre deux morceaux se recollerait en « � » si le décodeur n'était
  // pas en mode incrémental — et le JSON deviendrait illisible.
  const octets = new TextEncoder().encode(JSON.stringify({ items: [{ id: "héé-œuf-中文" }] }));
  const flux = new ReadableStream<Uint8Array>({
    start(controleur) {
      for (const octet of octets) controleur.enqueue(new Uint8Array([octet]));
      controleur.close();
    },
  });
  const { resultat } = await avecReponse(
    () => new Response(flux, { status: 200, headers: { "content-type": "application/json" } }),
    () => api.listItems(JETON),
  );
  assert.ok(!(resultat instanceof Error), `illisible : ${(resultat as Error)?.message}`);
  assert.equal((resultat as { items: Array<{ id: string }> }).items[0]!.id, "héé-œuf-中文");
});

// ─── L'autre moitié : `Content-Length` annoncé ───

test("un Content-Length au-dessus du seuil est refusé sans rien lire", async () => {
  const { flux, annule } = corpsJsonDe(33);
  const { resultat } = await avecReponse(
    () =>
      new Response(flux, {
        status: 200,
        headers: { "content-type": "application/json", "content-length": String(64 * MIO) },
      }),
    () => api.listItems(JETON),
  );
  assert.ok(resultat instanceof Error, "un corps annoncé à 64 Mio a été accepté");
  assert.match((resultat as Error).message, /trop volumineuse/);
  assert.equal(annule(), true, "le corps annoncé trop gros n'a pas été annulé");
});

test("un Content-Length menteur ne dispense pas de compter", async () => {
  // L'en-tête est une DÉCLARATION, pas une mesure. Un serveur hostile annonce
  // ce qu'il veut ; s'en contenter, c'est n'avoir rien vérifié du tout.
  const { flux, annule } = corpsJsonDe(33);
  const { resultat } = await avecReponse(
    () =>
      new Response(flux, {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "12" },
      }),
    () => api.listItems(JETON),
  );
  assert.ok(resultat instanceof Error, "33 Mio annoncés comme 12 octets ont été avalés");
  assert.match((resultat as Error).message, /trop volumineuse/);
  assert.equal(annule(), true);
});

// ─── Les chemins qui ne passent pas par le cas nominal ───

test("le corps d'une réponse en erreur est borné lui aussi", async () => {
  // Un 500 dont le corps est infini est aussi efficace qu'un 200 : ce chemin
  // lit lui aussi la réponse pour en extraire un message.
  const { flux } = corpsJsonDe(33);
  const { resultat } = await avecReponse(
    () => new Response(flux, { status: 500, headers: { "content-type": "application/json" } }),
    () => api.listItems(JETON),
  );
  assert.ok(resultat instanceof Error);
  assert.match(
    (resultat as Error).message,
    /trop volumineuse/,
    "le corps d'erreur a été lu en entier avant d'être jeté",
  );
});

test("le login borne sa réponse, bien qu'il n'emprunte pas le client commun", async () => {
  // `login` fait son propre `fetch` pour distinguer le cas « 2FA requise » d'un
  // refus. C'est exactement le genre de chemin de côté qu'une protection posée
  // au seul endroit évident laisse dehors.
  const { flux } = corpsJsonDe(33);
  const { resultat } = await avecReponse(
    () => new Response(flux, { status: 200, headers: { "content-type": "application/json" } }),
    () => api.login("qui@example.org", "preuve"),
  );
  assert.ok(resultat instanceof Error, "login a avalé 33 Mio");
  assert.match((resultat as Error).message, /trop volumineuse/);
});

test("un 204 sans corps reste un succès", async () => {
  const { resultat } = await avecReponse(
    () => new Response(null, { status: 204 }),
    () => api.deleteItem(JETON, "abc"),
  );
  assert.ok(!(resultat instanceof Error), `204 refusé : ${(resultat as Error)?.message}`);
});
