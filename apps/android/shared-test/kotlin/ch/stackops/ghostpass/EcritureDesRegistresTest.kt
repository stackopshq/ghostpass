package ch.stackops.ghostpass

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.ghost_crypto_ffi.Account
import uniffi.ghost_crypto_ffi.register

/**
 * **Ce qu'on écrit dans un registre est ce qu'on en relit.**
 *
 * Les registres à nom réservé (§2) se lisaient depuis le premier jour et ne s'écrivaient
 * pas : dossiers et favoris étaient en lecture seule. L'écriture ouvre une classe de défaut
 * nouvelle, et **silencieuse** — un registre écrit de travers ne fait échouer personne. Il
 * se relit vide, l'utilisateur perd ses favoris, et il n'y a pas d'erreur à chercher.
 *
 * Ces témoins bouclent donc la boucle **sans serveur** : on fabrique l'élément exactement
 * comme `Coffre.ecrireUnRegistre` le fabrique, on le scelle par le cœur, et on le relit par
 * `Coffre.lecture` — la fonction que l'écran parcourt. Ce qui se perdrait entre les deux se
 * perdrait aussi en production.
 *
 * Ce qu'ils ne couvrent pas : le choix entre créer et remplacer, qui demande un serveur. Il
 * est éprouvé par le parcours de bout en bout, qui vérifie qu'un second passage ne crée pas
 * un **second** registre du même nom — le défaut qui laisserait deux vérités concurrentes.
 *
 * **Aucun octet NUL littéral dans ce fichier**, seulement `Registres.PREFIXE` et des
 * échappements `\u0000`. Un NUL posé dans un source est invisible à la relecture, se perd au
 * premier copier-coller, et rend le fichier binaire aux yeux de `grep` — qui cesse alors
 * d'y trouver quoi que ce soit, sans le dire. C'est arrivé en écrivant ce fichier même.
 */
class EcritureDesRegistresTest {

    @Test
    fun unRegistreDeFavorisEcritSeRelit() {
        val moi = compte()
        val lecture = Coffre.lecture(
            listOf(scelle(moi, Coffre.elementDeRegistre(Registres.FAVORIS, """["abc","def"]"""))),
            moi,
        )
        assertEquals(setOf("abc", "def"), lecture.favoris)
        assertTrue("un registre ne doit pas apparaître comme une ligne", lecture.entrees.isEmpty())
    }

    @Test
    fun unRegistreDeDossiersEcritSeRelit() {
        val moi = compte()
        val lecture = Coffre.lecture(
            listOf(
                scelle(
                    moi,
                    Coffre.elementDeRegistre(
                        Registres.DOSSIERS, """["Travail/Serveurs","Perso"]"""),
                ),
            ),
            moi,
        )
        assertEquals(listOf("Perso", "Travail/Serveurs"), lecture.dossiersVides)
    }

    /**
     * Le registre des partages, avec ses horodatages **en secondes**.
     *
     * C'est l'exception du produit : les horodatages des *éléments* rendus par le serveur
     * sont en millisecondes, ceux de ce registre en secondes. Les deux unités cohabitent, et
     * `contrat.json` les distingue depuis l'ajout d'`timestamps.api_items`.
     */
    @Test
    fun unRegistreDePartagesEcritSeRelit() {
        val moi = compte()
        val partage = PartageEnCours(
            id = "abc",
            url = "https://ghostbit.example.com/p/abc#cle",
            deleteToken = "jeton",
            name = "Le mot de passe du routeur",
            createdAt = 1_788_000_000,
            expiresAt = 1_788_086_400,
        )
        val contenu = Json.encodeToString(
            ListSerializer(PartageEnCours.serializer()), listOf(partage))
        val relu = Coffre.lecture(
            listOf(scelle(moi, Coffre.elementDeRegistre(Registres.PARTAGES, contenu))), moi,
        ).partages

        assertEquals(1, relu.size)
        assertEquals(partage, relu.single())
        assertEquals(
            "l'écart doit rester de 86400 — s'il valait 86 400 000, une unité s'est perdue",
            86_400L,
            relu.single().expiresAt!! - relu.single().createdAt,
        )
    }

    /**
     * **L'octet NUL survit à l'aller-retour par le cœur, et c'est lui qui décide.**
     *
     * Le témoin le plus important de ce fichier, et le plus facile à croire acquis. Le
     * préfixe réservé est ce qui distingue un registre d'un élément de l'utilisateur ; s'il
     * se perdait au sérialiseur, le registre deviendrait une **ligne visible** au nom
     * illisible, et la liste des favoris s'afficherait comme une note.
     *
     * Le contrôle qui fait diverger les branches : le même contenu sous un nom **sans** NUL
     * doit produire l'inverse — une ligne visible et aucun favori. Sans lui, un test qui
     * constate « pas de ligne visible » passerait aussi bien sur un coffre vide.
     */
    @Test
    fun loctetNulSurvitAuSceauEtCestLuiQuiDecide() {
        val moi = compte()

        val avecNul = Coffre.lecture(
            listOf(scelle(moi, Coffre.elementDeRegistre(Registres.FAVORIS, """["abc"]"""))), moi)
        assertEquals(setOf("abc"), avecNul.favoris)
        assertTrue(avecNul.entrees.isEmpty())

        val sansNul = Coffre.lecture(
            listOf(
                scelle(
                    moi,
                    ElementDuCoffre(
                        name = "gp:favorites",
                        notes = null,
                        folder = null,
                        data = ContenuDElement.NoteSecrete(Note("""["abc"]""")),
                    ),
                ),
            ),
            moi,
        )
        assertEquals(
            "sans l'octet NUL, ce n'est pas un registre : aucun favori n'en sort",
            emptySet<String>(),
            sansNul.favoris,
        )
        assertEquals(
            "et il devient une ligne ordinaire, visible dans le coffre",
            1,
            sansNul.entrees.size,
        )
        assertTrue(
            "le préfixe doit bien commencer par un octet nul, pas par une espace",
            Registres.PREFIXE.first() == '\u0000',
        )
    }

    /** Un nom sans le préfixe réservé est refusé à l'écriture, avant tout envoi. */
    @Test
    fun ecrireUnRegistreRefuseUnNomOrdinaire() {
        var refuse = false
        try {
            Coffre().ecrireUnRegistre("favoris", "[]", null)
        } catch (_: IllegalArgumentException) {
            refuse = true
        }
        assertTrue(
            "un nom sans préfixe réservé donnerait un élément visible dans la liste de " +
                "l'utilisateur, pas un registre",
            refuse,
        )
    }

    /** Un registre écrit puis réécrit garde sa forme — le favori qu'on ajoute puis retire. */
    @Test
    fun unRegistreSeReecritSansPerdreSaForme() {
        val moi = compte()
        for (contenu in listOf("[]", """["a"]""", """["a","b"]""", "[]")) {
            val lecture = Coffre.lecture(
                listOf(scelle(moi, Coffre.elementDeRegistre(Registres.FAVORIS, contenu))), moi)
            assertTrue(lecture.entrees.isEmpty())
            assertEquals(
                Json.decodeFromString(ListSerializer(String.serializer()), contenu).toSet(),
                lecture.favoris,
            )
        }
    }

    /** Et l'identité du registre est rendue, pour qu'on le **remplace** au lieu de le doubler. */
    @Test
    fun lIdentiteDuRegistreEstRendueParLaLecture() {
        val moi = compte()
        val lecture = Coffre.lecture(
            listOf(scelle(moi, Coffre.elementDeRegistre(Registres.FAVORIS, "[]"), id = "reg-1")),
            moi,
        )
        assertEquals(
            "sans cette identité, une seconde écriture créerait un second registre du même " +
                "nom — dont un seul serait lu, l'autre restant à contredire le premier",
            "reg-1",
            lecture.identifiantsDeRegistres[Registres.FAVORIS],
        )
        assertNull(lecture.identifiantsDeRegistres[Registres.DOSSIERS])
    }

    // ─── Outillage ───

    private fun compte(): Account =
        register("correct horse battery staple", "clara@ghostpass.test").account()

    private fun scelle(
        compte: Account,
        element: ElementDuCoffre,
        id: String = "x",
    ): ElementChiffre {
        val enveloppe = Json.parseToJsonElement(
            compte.encryptItem(CodecDElement.ecrire(element))) as JsonObject
        return ElementChiffre(
            id = id,
            encryptedKey = (enveloppe["encrypted_key"] as JsonPrimitive).content,
            encryptedData = (enveloppe["encrypted_data"] as JsonPrimitive).content,
        )
    }
}
