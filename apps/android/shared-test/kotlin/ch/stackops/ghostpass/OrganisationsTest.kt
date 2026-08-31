package ch.stackops.ghostpass

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.ghost_crypto_ffi.Account
import uniffi.ghost_crypto_ffi.register

/**
 * Les coffres d'équipe — et les quatre règles qui empêchent une équipe de disparaître.
 *
 * Le défaut d'origine ne levait aucune erreur : l'application n'appelait que
 * `/api/vault/items`, et quelqu'un dont les mots de passe vivent en collection d'équipe
 * voyait un coffre vide. Vu sur un vrai téléphone, invisible à toute relecture.
 *
 * Les règles ci-dessous ont toutes la même forme — **ne jamais laisser tomber en silence** —
 * et chacune se trompe dans une direction différente.
 */
class OrganisationsTest {

    // ─── §5, appliqué aux collections d'équipe ───

    /**
     * Un élément d'équipe qu'on ne sait pas ouvrir **garde sa place**.
     *
     * C'est plus vrai ici que dans le coffre personnel : l'élément a été scellé par
     * quelqu'un d'autre, et son absence se lirait « cette personne ne l'a pas encore créé ».
     * iOS écartait en silence des deux côtés ; le porter aux organisations aurait
     * réintroduit le défaut par une autre porte.
     */
    @Test
    fun unElementDEquipeIllisibleGardeSaPlace() {
        val moi = compte("clara@ghostpass.test")
        val quelquUnDAutre = compte("kevin@ghostpass.test")

        val aMoi = scelle(moi, "Serveur de production", "prod")
        val pasAMoi = scelle(quelquUnDAutre, "Scellé ailleurs", "etranger")

        // `lectureSous` est la fonction que l'écran d'équipe emploie : elle prend l'ouvreur
        // qu'on lui donne — la clé du coffre ici, l'Org Key en production.
        val lecture = Coffre.lectureSous(listOf(aMoi, pasAMoi)) { Coffre.ouvrir(it, moi) }

        assertEquals("les deux lignes doivent être là", 2, lecture.entrees.size)
        assertEquals(1, lecture.nombreDIllisibles)
        assertEquals(
            "etranger",
            lecture.entrees.filterIsInstance<EntreeDuCoffre.Illisible>().single().id,
        )
    }

    /** Sans clé d'organisation, **toutes** les lignes deviennent illisibles, aucune ne part. */
    @Test
    fun sansCleDOrganisationAucuneLigneNeDisparait() {
        val moi = compte("clara@ghostpass.test")
        val elements = listOf(
            scelle(moi, "A", "a"), scelle(moi, "B", "b"), scelle(moi, "C", "c"))

        val sansCle = Coffre.lectureSous(elements, null)
        assertEquals(3, sansCle.entrees.size)
        assertTrue(
            sansCle.entrees.all {
                (it as EntreeDuCoffre.Illisible).raison == RaisonDIllisibilite.CleManquante
            },
        )
        // Et la même liste avec la clé s'ouvre — sans quoi ce test passerait aussi sur des
        // éléments que personne ne peut ouvrir.
        assertEquals(3, Coffre.lectureSous(elements) { Coffre.ouvrir(it, moi) }.lisibles.size)
    }

    // ─── Une organisation ne se laisse pas tomber non plus ───

    /**
     * Un rôle inconnu **ne fait pas disparaître l'organisation**.
     *
     * iOS rend `nil` pour un rôle qu'il ne connaît pas, et la liste le laisse tomber en
     * silence : c'est le défaut du §5 transposé d'un cran. Une équipe absente de la liste se
     * lit « je n'en fais pas partie », ce qui est faux — et ce qui empêche d'aller voir.
     */
    @Test
    fun unRoleInconnuNeFaitPasDisparaitreLOrganisation() {
        val organisation = Organisation.depuis(
            OrganisationDto(orgId = "org-1", name = "Équipe", role = "auditeur", status = "active"))
        assertEquals("org-1", organisation.id)
        assertEquals("Équipe", organisation.nom)
        assertEquals(RoleDOrganisation.Inconnu, organisation.role)
        assertEquals(EtatDAppartenance.Actif, organisation.etat)
    }

    /** Un état inconnu non plus. */
    @Test
    fun unEtatInconnuNeFaitPasDisparaitreLOrganisation() {
        val organisation = Organisation.depuis(
            OrganisationDto(orgId = "org-2", name = "Équipe", role = "admin", status = "suspendu"))
        assertEquals(EtatDAppartenance.Inconnu, organisation.etat)
        assertEquals(RoleDOrganisation.Admin, organisation.role)
    }

    /** Une organisation sans nom garde son identifiant : une ligne sans titre ne se désigne pas. */
    @Test
    fun uneOrganisationSansNomGardeSonIdentifiant() {
        assertEquals(
            "org-3",
            Organisation.depuis(OrganisationDto(orgId = "org-3")).nom,
        )
    }

    // ─── Les droits, et le sens dans lequel on se trompe ───

    /**
     * La permission absente retombe sur le rôle, **conservativement**.
     *
     * Se tromper dans ce sens fait manquer un bouton ; se tromper dans l'autre fait perdre
     * une saisie entière à quelqu'un qui découvre au moment d'enregistrer qu'il n'avait pas
     * le droit. Les deux erreurs ne coûtent pas la même chose.
     */
    @Test
    fun laPermissionAbsenteRetombeSurLeRoleEtSeTrompeEnFaveurDeLaLecture() {
        assertEquals(
            PermissionDeCollection.Gestion,
            PermissionDeCollection.depuis(null, RoleDOrganisation.Admin),
        )
        for (role in listOf(
            RoleDOrganisation.Membre, RoleDOrganisation.LectureSeule, RoleDOrganisation.Inconnu,
        )) {
            assertEquals(
                "un rôle non administrateur sans permission explicite doit valoir lecture",
                PermissionDeCollection.Lecture,
                PermissionDeCollection.depuis(null, role),
            )
        }
    }

    /** La permission explicite du serveur l'emporte sur le rôle, dans les deux sens. */
    @Test
    fun laPermissionExpliciteLEmporteSurLeRole() {
        assertEquals(
            "un administrateur explicitement en lecture sur une collection ne doit pas " +
                "s'en croire gestionnaire",
            PermissionDeCollection.Lecture,
            PermissionDeCollection.depuis("read", RoleDOrganisation.Admin),
        )
        assertEquals(
            PermissionDeCollection.Ecriture,
            PermissionDeCollection.depuis("write", RoleDOrganisation.LectureSeule),
        )
    }

    @Test
    fun seuleLaLectureNePeutPasEcrire() {
        assertFalse(PermissionDeCollection.Lecture.peutEcrire)
        assertTrue(PermissionDeCollection.Ecriture.peutEcrire)
        assertTrue(PermissionDeCollection.Gestion.peutEcrire)
    }

    // ─── Ce qu'on dit quand une organisation ne s'ouvre pas ───

    /**
     * Les quatre motifs disent **quatre choses différentes**.
     *
     * Un message unique « impossible d'ouvrir ce coffre » les rendrait tous également
     * décourageants : l'invitation se répare en l'acceptant, la clé manquante en demandant à
     * un administrateur, la clé refusée pas du tout, et le réseau en attendant.
     */
    @Test
    fun chaqueMotifDEchecDitQuoiFaire() {
        val messages = listOf(
            EchecDOrganisation.InvitationEnAttente,
            EchecDOrganisation.AucuneCleRemise,
            EchecDOrganisation.CleRefusee("sceau refusé"),
            EchecDOrganisation.Reseau("injoignable"),
        ).map { Coffre.EchecDOuverture.message(it) }

        assertEquals(
            "quatre motifs, quatre messages : deux identiques rendraient la distinction inutile",
            messages.size,
            messages.toSet().size,
        )
        assertTrue(
            "l'invitation en attente doit parler d'acceptation",
            messages[0].contains("accept"),
        )
    }

    /** Une invitation en attente n'est pas un coffre vide, et l'état le dit. */
    @Test
    fun uneInvitationEnAttenteSeDistingueDunCoffreVide() {
        val invitee = Organisation.depuis(
            OrganisationDto(orgId = "o", name = "Équipe", role = "member", status = "invited"))
        assertEquals(EtatDAppartenance.Invite, invitee.etat)
    }

    // ─── Outillage ───

    private fun compte(email: String): Account =
        register("correct horse battery staple $email", email).account()

    private fun scelle(compte: Account, nom: String, id: String): ElementChiffre {
        val element = ElementDuCoffre(
            name = nom, notes = null, folder = null,
            data = ContenuDElement.Connexion(Identifiants(username = "clara", password = "s3cret")),
        )
        val enveloppe = Json.parseToJsonElement(
            compte.encryptItem(CodecDElement.ecrire(element))) as JsonObject
        return ElementChiffre(
            id = id,
            encryptedKey = (enveloppe["encrypted_key"] as JsonPrimitive).content,
            encryptedData = (enveloppe["encrypted_data"] as JsonPrimitive).content,
        )
    }
}
