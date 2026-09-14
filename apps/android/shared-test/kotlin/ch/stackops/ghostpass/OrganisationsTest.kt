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

    // ─── L'écriture d'équipe, et la clé sous laquelle on scelle ───

    /**
     * L'aller-retour sous l'Org Key : ce qu'on scelle pour l'équipe, l'équipe le rouvre.
     *
     * `scellerSousOrg` et `ouvrirSousOrg` vivent côte à côte précisément pour cela — deux
     * conversions camelCase / snake_case écrites à deux endroits finissent par diverger.
     */
    @Test
    fun lAllerRetourSousLOrgKeyRendLElement() {
        val org = compte("clara@ghostpass.test").createOrg().org()
        val depart = ElementDuCoffre(
            name = "Routeur de l'agence", notes = null, folder = null,
            data = ContenuDElement.Connexion(Identifiants(username = "admin", password = "d3ploy")),
        )
        val (cle, donnees) = Coffre.scellerSousOrg(depart, org)
        val relu = Coffre.ouvrirSousOrg(
            ElementChiffre(id = "x", encryptedKey = cle, encryptedData = donnees), org)
        assertEquals(depart, relu)
    }

    /**
     * **Un élément scellé sous une autre Org Key est illisible — et c'est pourquoi la
     * génération de la clé compte.**
     *
     * C'est le défaut que `Coffre.exigerLaCleCourante` existe pour empêcher, vu depuis son
     * effet : une session ouverte avant une rotation détient l'ancienne clé. Si elle
     * enregistrait, le serveur accepterait, l'écran afficherait « enregistré », et l'élément
     * serait illisible pour tous ceux qui n'ont que la nouvelle — **y compris son auteur**,
     * à sa prochaine ouverture. Aucune erreur nulle part.
     *
     * Ce test montre la conséquence ; la garde qui l'empêche demande un serveur, et le
     * parcours de bout en bout la traverse.
     */
    @Test
    fun unElementScelleSousUneAutreCleDEquipeEstIllisible() {
        val moi = compte("clara@ghostpass.test")
        val ancienne = moi.createOrg().org()
        val nouvelle = moi.createOrg().org()

        val element = ElementDuCoffre(
            name = "Scellé avant la rotation", notes = null, folder = null,
            data = ContenuDElement.NoteSecrete(Note("secret")),
        )
        val (cle, donnees) = Coffre.scellerSousOrg(element, ancienne)
        val chiffre = ElementChiffre(id = "avant", encryptedKey = cle, encryptedData = donnees)

        // Sous la nouvelle clé, la ligne **garde sa place** et dit pourquoi (§5).
        val lecture = Coffre.lectureSous(listOf(chiffre)) { Coffre.ouvrirSousOrg(it, nouvelle) }
        assertEquals(1, lecture.entrees.size)
        assertEquals(1, lecture.nombreDIllisibles)
        assertTrue(
            "la cause doit être un sceau refusé, pas une clé absente : la clé est là, elle " +
                "n'ouvre pas celui-ci",
            (lecture.entrees.single() as EntreeDuCoffre.Illisible).raison
                is RaisonDIllisibilite.SceauRefuse,
        )

        // Et sous l'ancienne, il s'ouvre — sans quoi ce test passerait sur un élément que
        // personne ne peut ouvrir.
        assertEquals(
            1,
            Coffre.lectureSous(listOf(chiffre)) { Coffre.ouvrirSousOrg(it, ancienne) }.lisibles.size,
        )
    }

    /**
     * Deux organisations d'un même compte ont bien **deux** clés distinctes.
     *
     * Le contrôle du contrôle : si `createOrg` rendait deux fois la même clé, le test
     * ci-dessus échouerait pour une raison qui n'est pas celle qu'on croit — et un jour où
     * il passerait, il ne prouverait rien.
     */
    @Test
    fun deuxOrganisationsNOntPasLaMemeCle() {
        val moi = compte("clara@ghostpass.test")
        val a = moi.createOrg().org()
        val b = moi.createOrg().org()
        val element = ElementDuCoffre(
            name = "x", notes = null, folder = null,
            data = ContenuDElement.NoteSecrete(Note("y")),
        )
        val (cle, donnees) = Coffre.scellerSousOrg(element, a)
        var refuse = false
        try {
            Coffre.ouvrirSousOrg(
                ElementChiffre(id = "x", encryptedKey = cle, encryptedData = donnees), b)
        } catch (_: Exception) {
            refuse = true
        }
        assertTrue("deux organisations doivent avoir deux clés", refuse)
    }

    // ─── Le coffre d'accueil fond le personnel et l'équipe ───

    private fun lisible(nom: String, origine: OrigineDuCoffre = OrigineDuCoffre.Personnel) =
        EntreeDuCoffre.Lisible(
            id = nom,
            element = ElementDuCoffre(
                name = nom, notes = null, folder = null,
                data = ContenuDElement.NoteSecrete(Note("x")),
            ),
            origine = origine,
        )

    private val appartenance = Appartenance(
        organisation = "org-1", collection = "col-1",
        nomEquipe = "Équipe StackOps", nomCollection = "Coffre commun",
        peutEcrire = true,
    )

    /**
     * **Le coffre d'accueil contient les deux, et l'on sait lesquels sont d'équipe.**
     *
     * Le défaut que cela corrige : quelqu'un dont tout vit dans une organisation voyait
     * « aucun élément » et concluait à une perte de données.
     *
     * Le test n'affirme pas « il y a au moins un élément » — il serait vert sans la fusion,
     * le coffre personnel suffisant à le satisfaire. Il exige **les deux noms** et la
     * **marque** qui les distingue : retirer la fusion fait disparaître le second, retirer
     * le marquage fait disparaître l'étiquette.
     */
    @Test
    fun leCoffreDAccueilFondLePersonnelEtLEquipe() {
        val personnel = LectureDuCoffre(entrees = listOf(lisible("Forgejo")))
        val equipe = Coffre.marquerCommeDEquipe(
            LectureDuCoffre(entrees = listOf(lisible("Routeur de l'agence"))),
            appartenance,
        )

        val fondu = Coffre.fusionner(personnel, listOf(equipe))
        val noms = fondu.lisibles.map { it.element.name }

        assertTrue("l'élément personnel a disparu de l'accueil : $noms", "Forgejo" in noms)
        assertTrue(
            "l'élément d'équipe n'est pas dans l'accueil — c'est le défaut qui ressemble à " +
                "une perte de données : $noms",
            "Routeur de l'agence" in noms,
        )

        val duPersonnel = fondu.lisibles.first { it.element.name == "Forgejo" }
        val delEquipe = fondu.lisibles.first { it.element.name == "Routeur de l'agence" }
        assertEquals(OrigineDuCoffre.Personnel, duPersonnel.origine)
        assertEquals(
            "l'étiquette doit nommer l'équipe ET la collection : avec plusieurs équipes, " +
                "« Coffre commun » seul ne dit pas de laquelle il s'agit",
            "Équipe StackOps · Coffre commun",
            delEquipe.origine.etiquette,
        )
    }

    /**
     * Une ligne d'équipe **illisible** garde sa marque.
     *
     * Sans elle, elle se lirait comme un élément personnel abîmé, et l'on irait chercher le
     * défaut dans le mauvais coffre — alors que la cause est presque toujours une clé
     * d'organisation qu'on n'a pas encore reçue.
     */
    @Test
    fun uneLigneDEquipeIllisibleGardeSaMarque() {
        val equipe = Coffre.marquerCommeDEquipe(
            LectureDuCoffre(
                entrees = listOf(
                    EntreeDuCoffre.Illisible("x", RaisonDIllisibilite.CleManquante),
                ),
            ),
            appartenance,
        )
        val entree = equipe.entrees.single()
        assertTrue("une ligne illisible d'équipe doit rester marquée", entree.origine.estDEquipe)
        assertEquals("Équipe StackOps · Coffre commun", entree.origine.etiquette)
    }

    /**
     * Le tri mêle vraiment les deux origines, au lieu de les accoler.
     *
     * Deux listes concaténées se lisent comme deux listes, pas comme un coffre. Le contrôle
     * est concluant parce que l'ordre attendu **alterne** : une simple concaténation
     * donnerait `Alpha, Zoulou, Bravo`, qui n'est pas l'ordre demandé.
     */
    @Test
    fun lOrdreMeleLesDeuxOrigines() {
        val personnel = LectureDuCoffre(entrees = listOf(lisible("Alpha"), lisible("Zoulou")))
        val equipe = Coffre.marquerCommeDEquipe(
            LectureDuCoffre(entrees = listOf(lisible("Bravo"))), appartenance)
        assertEquals(
            listOf("Alpha", "Bravo", "Zoulou"),
            Coffre.fusionner(personnel, listOf(equipe)).lisibles.map { it.element.name },
        )
    }

    /**
     * Sans équipe, la lecture personnelle traverse **inchangée**.
     *
     * Le contrôle du contrôle : si la fusion réordonnait ou recopiait toujours, les tests
     * ci-dessus passeraient pour une raison qui n'est pas la fusion. Ici on vérifie aussi
     * que les registres et dossiers du coffre personnel survivent — ils ne viennent que de
     * lui, et une fusion maladroite les perdrait en silence.
     */
    @Test
    fun sansEquipeLaLecturePersonnelleEstIntacte() {
        val personnel = LectureDuCoffre(
            entrees = listOf(lisible("Zoulou"), lisible("Alpha")),
            dossiersVides = listOf("Travail"),
            favoris = setOf("Zoulou"),
        )
        val fondu = Coffre.fusionner(personnel, emptyList())
        assertEquals(listOf("Zoulou", "Alpha"), fondu.lisibles.map { it.element.name })
        assertEquals(listOf("Travail"), fondu.dossiersVides)
        assertEquals(setOf("Zoulou"), fondu.favoris)
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
