package ch.stackops.ghostpass.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import ch.stackops.ghostpass.BiometrieDeLAppareil
import ch.stackops.ghostpass.ModeleDuCoffre
import ch.stackops.ghostpass.R
import ch.stackops.ghostpass.theme.BoutonPrincipal
import ch.stackops.ghostpass.theme.BoutonSecondaire
import ch.stackops.ghostpass.theme.ChampGhost
import ch.stackops.ghostpass.theme.FondGhost
import ch.stackops.ghostpass.theme.GP
import ch.stackops.ghostpass.theme.IconeBiometrique
import ch.stackops.ghostpass.theme.LienDiscret
import ch.stackops.ghostpass.theme.LocalCouleurs
import ch.stackops.ghostpass.theme.ValeurFigee
import ch.stackops.ghostpass.theme.carteDeVerre
import ch.stackops.ghostpass.theme.neon

/**
 * Déverrouillage : la carte de verre posée sur la nuit, comme l'écran d'entrée des autres
 * produits de la suite.
 *
 * **Porté structure par structure** de `apps/ios/Ghostpass/Views/UnlockView.swift` (§10), et
 * pas « dans l'esprit ». La hiérarchie est la même, dans le même ordre :
 *
 *     ZStack { GhostBackground ; ScrollView { VStack(24) { enseigne ; carte } } }
 *
 * — c'est-à-dire ici : `Box { FondGhost ; Column(scroll) { enseigne ; carte } }`, la colonne
 * bornée à 420 dp de large et centrée, avec 20 dp de marge horizontale et 40 de marge
 * verticale. L'enseigne est une plaque de 64 dp portant la marque, avec son halo, puis le
 * titre, puis le sous-titre. La carte est une carte de verre portant les champs puis les
 * actions.
 *
 * Ce qui compte dans cette liste, c'est qu'aucun de ces éléments n'est décoratif : c'est
 * leur ensemble qui fait reconnaître le produit. Reprendre la palette sans le langage
 * visuel donne des composants du système simplement recolorés — et ça se voit
 * immédiatement.
 *
 * Deux états, comme sur iOS : une session enregistrée qu'on rouvre d'un mot de passe, ou
 * une connexion complète à décliner.
 */
@Composable
fun EcranDeDeverrouillage(modele: ModeleDuCoffre) {
    val couleurs = LocalCouleurs.current

    var serveur by rememberSaveable { mutableStateOf(modele.serveurEnregistre) }
    var email by rememberSaveable { mutableStateOf(modele.emailEnregistre) }
    var motDePasse by rememberSaveable { mutableStateOf("") }
    var codeTotp by rememberSaveable { mutableStateOf("") }
    /** Une session enregistrée se rouvre avec le seul mot de passe maître, sans réseau. */
    var sessionEnregistree by rememberSaveable {
        mutableStateOf(modele.sessionEnregistree != null)
    }

    val contexte = LocalContext.current
    val activite = contexte as FragmentActivity
    /**
     * La biométrie ne se propose qu'une fois par ouverture d'écran.
     *
     * Sans ce verrou, un refus recomposerait l'écran, qui la relancerait : l'utilisateur
     * qui veut taper son mot de passe maître ne pourrait jamais atteindre le clavier.
     */
    var biometrieTentee by rememberSaveable { mutableStateOf(false) }

    /**
     * L'écran de récupération, posé **par-dessus** celui-ci.
     *
     * Il ne quitte pas l'entrée pour y revenir : il la recouvre, et le retour arrière le
     * referme. C'est la feuille modale d'iOS, et elle compte ici — on n'arrive à cet écran
     * que parce qu'on ne peut pas entrer, et se retrouver ailleurs après un geste ajouterait
     * de la confusion à un moment déjà inquiet.
     */
    var recuperationOuverte by rememberSaveable { mutableStateOf(false) }
    if (recuperationOuverte) {
        BackHandler { recuperationOuverte = false }
        EcranDeRecuperationDuCompte(
            modele = modele,
            serveur = serveur,
            email = email,
            surFermer = { recuperationOuverte = false },
            surReussite = {
                recuperationOuverte = false
                // Rien ne s'ouvre : le serveur a invalidé toutes les sessions. Le champ est
                // vidé et l'écran dit quoi faire, plutôt que de laisser croire à un échec.
                motDePasse = ""
                modele.message = "Mot de passe réinitialisé. Connectez-vous avec le nouveau."
            },
        )
        return
    }

    // Une identité vérifiée par SSO enregistre une session : l'écran doit alors basculer sur
    // « compte enregistré, entrez votre mot de passe maître ». Sans cela, l'utilisateur
    // reviendrait du navigateur devant le même formulaire vide, sans savoir si quelque chose
    // s'est passé.
    LaunchedEffect(modele.identitesVerifiees) {
        if (modele.identitesVerifiees > 0) sessionEnregistree = true
    }

    LaunchedEffect(sessionEnregistree, modele.biometrieActivee) {
        if (sessionEnregistree && modele.biometrieActivee && !biometrieTentee) {
            biometrieTentee = true
            modele.deverrouillerParBiometrie(activite)
        }
    }

    Box(Modifier.fillMaxSize()) {
        FondGhost()
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                Modifier
                    // Bornée à 420 (charte §2) : au-delà, sur tablette, les champs
                    // s'étirent sur toute la dalle et le formulaire perd sa forme.
                    .widthIn(max = GP.largeurMax)
                    .padding(horizontal = 20.dp, vertical = 40.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                Enseigne(sessionEnregistree)

                // ─── La carte ───
                Column(
                    Modifier.fillMaxWidth().carteDeVerre(),
                    verticalArrangement = Arrangement.spacedBy(GP.ecartChamps),
                ) {
                    if (sessionEnregistree) {
                        ValeurFigee("Compte", modele.emailEnregistre)
                        ChampGhost(
                            intitule = "Mot de passe maître",
                            valeur = motDePasse,
                            invite = "Votre mot de passe",
                            identifiant = "field.master",
                            secret = true,
                            typeDeClavier = KeyboardType.Password,
                            onChange = { motDePasse = it },
                        )
                    } else {
                        ChampGhost(
                            intitule = "Serveur",
                            valeur = serveur,
                            // Le domaine est celui que la RFC 2606 réserve aux exemples : il
                            // ne résout nulle part, donc personne ne se connectera par
                            // mégarde à l'instance d'un tiers. Et c'est une invite, pas une
                            // valeur par défaut — **aucun point de terminaison de
                            // l'éditeur n'est en dur dans l'application** (§7).
                            invite = "https://ghostpass.example.com",
                            identifiant = "field.server",
                            typeDeClavier = KeyboardType.Uri,
                            onChange = { serveur = it },
                        )
                        ChampGhost(
                            intitule = "Adresse e-mail",
                            valeur = email,
                            invite = "vous@exemple.ch",
                            identifiant = "field.email",
                            typeDeClavier = KeyboardType.Email,
                            onChange = { email = it },
                        )
                        ChampGhost(
                            intitule = "Mot de passe maître",
                            valeur = motDePasse,
                            invite = "Votre mot de passe",
                            identifiant = "field.master",
                            secret = true,
                            typeDeClavier = KeyboardType.Password,
                            onChange = { motDePasse = it },
                        )
                        if (modele.secondFacteurRequis) {
                            ChampGhost(
                                intitule = "Code à six chiffres",
                                valeur = codeTotp,
                                invite = "123456",
                                identifiant = "field.totp",
                                typeDeClavier = KeyboardType.NumberPassword,
                                onChange = { codeTotp = it },
                            )
                        }
                    }

                    modele.message?.let { texte ->
                        Row(
                            verticalAlignment = Alignment.Top,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Text("⚠", color = couleurs.danger, fontSize = 13.sp)
                            Text(texte, color = couleurs.danger, fontSize = 13.sp)
                        }
                    }

                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        BoutonPrincipal(
                            texte = if (sessionEnregistree) "Déverrouiller" else "Se connecter",
                            actif = !modele.occupe && motDePasse.isNotEmpty(),
                            occupe = modele.occupe,
                            identifiant = "button.submit",
                        ) {
                            if (sessionEnregistree) {
                                modele.deverrouillerHorsLigne(motDePasse)
                            } else {
                                modele.ouvrirUneSession(
                                    serveur, email, motDePasse,
                                    if (modele.secondFacteurRequis) codeTotp else null,
                                )
                            }
                        }

                        // L'authentification unique (§8). Elle n'apparaît que dans le
                        // formulaire complet : elle a besoin d'une adresse de serveur, et
                        // une session déjà enregistrée n'a plus rien à authentifier.
                        //
                        // Elle **n'ouvre pas le coffre** : au retour, le mot de passe maître
                        // reste à saisir. Le libellé le dit — « s'identifier », pas
                        // « se connecter » — parce que confondre les deux est la première
                        // erreur de conception d'un client à connaissance nulle.
                        if (!sessionEnregistree) {
                            LienDiscret(
                                texte = "S'identifier par authentification unique",
                                actif = !modele.occupe && serveur.isNotBlank(),
                                identifiant = "button.sso",
                            ) { modele.demarrerLeSso(contexte, serveur) }
                        }

                        // La biométrie **ne remplace pas** le mot de passe maître : elle
                        // raccourcit les déverrouillages suivants (ADR-0002). Le champ reste
                        // donc au-dessus, et ceci est une action secondaire — pas l'inverse.
                        if (sessionEnregistree && modele.biometrieActivee) {
                            // **Une icône seule, comme iOS** — le geste attendu se reconnaît
                            // à son symbole plus vite qu'il ne se lit.
                            //
                            // Cet alignement était bloqué : `BoutonSecondaire` se servait de
                            // la `contentDescription` comme identifiant de témoin, si bien
                            // qu'un bouton sans texte n'avait plus rien à annoncer — ou
                            // annonçait « button.biometric » à haute voix. `testTag` a séparé
                            // les deux (voir `reperes`), et le bouton peut enfin porter les
                            // deux repères à la fois.
                            //
                            // Le libellé écrit était en outre **faux** : « par empreinte », en
                            // dur, sur un appareil à reconnaissance faciale. L'icône comme le
                            // nom suivent désormais le matériel.
                            val genre = BiometrieDeLAppareil.genre(contexte)
                            BoutonSecondaire(
                                texte = "Déverrouiller avec ${BiometrieDeLAppareil.nom(contexte)}",
                                actif = !modele.occupe,
                                identifiant = "button.biometric",
                                description = "Déverrouiller avec ${BiometrieDeLAppareil.nom(contexte)}",
                                contenu = { IconeBiometrique(genre, couleurs.accentTexte) },
                            ) { modele.deverrouillerParBiometrie(activite) }
                        }

                        // **« Mot de passe oublié » n'a de sens que sur la connexion
                        // complète** : la récupération a besoin de l'adresse du serveur et
                        // du compte, et elle réinitialise — elle n'ouvre pas la session
                        // enregistrée, elle l'invalide avec toutes les autres.
                        if (!sessionEnregistree) {
                            LienDiscret(
                                texte = "Mot de passe maître oublié",
                                actif = !modele.occupe && serveur.isNotBlank() &&
                                    email.isNotBlank(),
                                identifiant = "button.forgotMaster",
                            ) {
                                modele.message = null
                                recuperationOuverte = true
                            }
                        }

                        if (modele.sessionEnregistree != null) {
                            LienDiscret(
                                texte = if (sessionEnregistree) {
                                    "Utiliser un autre compte"
                                } else {
                                    "Revenir au coffre enregistré"
                                },
                                identifiant = "button.switchAccount",
                            ) {
                                sessionEnregistree = !sessionEnregistree
                                motDePasse = ""
                                modele.message = null
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * L'enseigne : la plaque, la marque, le titre, le sous-titre.
 *
 * La marque est sur fond transparent : posée à même l'écran, elle flotterait. Une plaque
 * franchement noire ou franchement blanche la détache — **pas une surface du thème**, qui
 * la ferait se fondre à nouveau. C'est le seul néon de cet écran, et c'est ce qui rattache
 * GhostPass au reste de la suite.
 */
@Composable
private fun Enseigne(sessionEnregistree: Boolean) {
    val couleurs = LocalCouleurs.current
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier
                .neon(1f, GP.rayonCarte + 6.dp)
                .background(
                    if (couleurs.sombre) Color.Black else Color.White,
                    RoundedCornerShape(22.dp),
                )
                .border(1.dp, couleurs.bordure, RoundedCornerShape(22.dp))
                .padding(14.dp),
            contentAlignment = Alignment.Center,
        ) {
            // La silhouette de la marque, rendue par `tools/android/make-brand-assets.sh`
            // depuis le SVG de charte et recadrée par `icone-ios.py --cadre` : la plaque
            // donne sa marge autour de l'**image**, pas autour de la silhouette, et sans ce
            // recadrage elle remplit sa boîte bord à bord et paraît à l'étroit.
            //
            // Un emoji tenait la place « en attendant l'outil Android ». L'outil est arrivé
            // et le bouchon est resté — vu par Clara en lançant l'application sur son
            // téléphone, pas par nous en relisant le code. Un provisoire ne se signale pas
            // tout seul.
            //
            // `contentDescription = null` : c'est un ornement. Le titre « GhostPass » le
            // suit immédiatement, et l'annoncer une seconde fois n'apprendrait rien.
            Image(
                painter = painterResource(R.drawable.marque),
                contentDescription = null,
                modifier = Modifier.size(64.dp),
            )
        }
        Text(
            "GhostPass",
            color = couleurs.encre,
            fontSize = 26.sp,
            fontWeight = FontWeight.Bold,
        )
        Text(
            if (sessionEnregistree) {
                "Coffre enregistré sur cet appareil"
            } else {
                "Coffre chiffré de bout en bout"
            },
            color = couleurs.attenue,
            fontSize = 13.sp,
        )
    }
}
