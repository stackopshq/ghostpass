package ch.stackops.ghostpass.ui

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import ch.stackops.ghostpass.LienOtpauth
import ch.stackops.ghostpass.ModeleDuCoffre
import ch.stackops.ghostpass.R
import ch.stackops.ghostpass.theme.BarreDeFeuille
import ch.stackops.ghostpass.theme.EcranGhost
import ch.stackops.ghostpass.theme.LienDiscret
import ch.stackops.ghostpass.theme.LocalCouleurs
import ch.stackops.ghostpass.theme.carteDeVerre
import ch.stackops.ghostpass.theme.reperes
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.ReaderException
import com.google.zxing.common.HybridBinarizer
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Lit à la caméra le QR code que les sites affichent pour activer un second facteur.
 *
 * Porté de `ScanDeTotpView.swift`. Jusqu'ici, Android demandait de **taper** l'URI
 * `otpauth://totp/…` dans un champ, ou de passer par une autre application de scan qui nous
 * livrait le lien par `intent-filter`. La fiche des deux magasins écrit pourtant « scannez
 * le QR code affiché par le site », et c'était faux sur Android.
 *
 * Recopier une clé base32 à la main est le moment où l'on se trompe : trente-deux
 * caractères sans séparateur, dans une police où le 0 et le O se ressemblent. Et le QR code
 * porte **plus** que la clé — l'émetteur, le nombre de chiffres, la période —, que la saisie
 * manuelle laisse forcément aux valeurs par défaut.
 *
 * Rien n'est enregistré : les images ne quittent pas la mémoire, aucune n'est écrite sur le
 * disque, et l'analyse s'arrête dès qu'un lien est retenu.
 */
@Composable
fun EcranDeScanDeTotp(
    modele: ModeleDuCoffre,
    surLien: (String) -> Unit,
    surFermer: () -> Unit,
) {
    val contexte = LocalContext.current
    val couleurs = LocalCouleurs.current

    var autorise by remember { mutableStateOf(camerAutorisee(contexte)) }
    var refusee by remember { mutableStateOf(false) }
    var refus by remember { mutableStateOf<String?>(null) }

    val demande = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { accorde ->
        autorise = accorde
        refusee = !accorde
    }

    // **La demande de permission est une activité du système, et le verrouillage immédiat
    // la prend pour une sortie.**
    //
    // C'est le même défaut que le sélecteur de fichiers de l'import : notre activité passe
    // par `onStop` pendant que la boîte du système est à l'écran, et avec le réglage par
    // défaut — « Immédiatement » — le coffre se referme derrière. L'utilisateur accorde la
    // caméra et retombe sur le mot de passe maître, le formulaire perdu.
    //
    // L'exemption est donc armée **avant** la demande et rendue au retour. Elle ne couvre
    // pas la caméra elle-même : l'aperçu vit dans notre activité, qui ne s'arrête pas.
    LaunchedEffect(Unit) {
        if (!camerAutorisee(contexte) && aUneCamera(contexte)) {
            modele.unSelecteurEstOuvert = true
            demande.launch(android.Manifest.permission.CAMERA)
        }
    }

    EcranGhost(identifiant = "screen.scanTotp") {
        BarreDeFeuille(
            titre = stringResource(R.string.scan_titre),
            gauche = stringResource(R.string.scan_fermer),
            identifiantGauche = "button.closeScan",
            surGauche = surFermer,
        )

        when {
            // Trois issues et non deux : l'appareil peut n'avoir **aucune** caméra — un
            // émulateur, une tablette d'entrée de gamme. Un aperçu muet laisserait croire à
            // une panne, et le dire oriente vers la seule chose qui reste à faire : coller
            // la clé dans le champ.
            !aUneCamera(contexte) -> Impossible(stringResource(R.string.scan_sans_camera))

            refusee -> Impossible(stringResource(R.string.scan_refusee), contexte)

            autorise -> {
                Viseur(
                    surCharge = { charge ->
                        when (val lu = LienOtpauth.lire(charge)) {
                            is LienOtpauth.Lecture.SecondFacteur -> {
                                surLien(lu.uri)
                                surFermer()
                            }
                            // Le message de l'export dit **quoi faire**, là où l'autre dit
                            // seulement que ça ne va pas. Les confondre, c'est répondre
                            // « lien non reconnu » à quelqu'un qui vient de faire
                            // exactement le geste qu'on lui a appris.
                            LienOtpauth.Lecture.ExportDApplication ->
                                refus = contexte.getString(R.string.scan_export_multiple)
                            LienOtpauth.Lecture.AutreChose ->
                                refus = contexte.getString(R.string.scan_pas_un_totp)
                        }
                    },
                )
                // Le refus s'affiche **sans arrêter la lecture** : viser le mauvais code est
                // fréquent — une page en affiche souvent plusieurs — et refermer la caméra à
                // chaque erreur obligerait à tout reprendre.
                Text(
                    refus ?: stringResource(R.string.scan_visez),
                    color = if (refus != null) couleurs.danger else couleurs.attenue,
                    fontSize = 12.sp,
                    modifier = Modifier.reperes(
                        if (refus != null) "text.scanRefus" else "text.scanAide",
                    ),
                )
            }

            else -> Text(
                stringResource(R.string.scan_demande_en_cours),
                color = couleurs.attenue,
                fontSize = 13.sp,
            )
        }
    }
}

/** L'aperçu de la caméra, et l'analyse de chaque image. */
@Composable
private fun Viseur(surCharge: (String) -> Unit) {
    val contexte = LocalContext.current
    val cycleDeVie = LocalLifecycleOwner.current
    // Un seul fil pour l'analyse : le décodage est synchrone et n'a aucune raison de
    // s'exécuter en parallèle de lui-même. `STRATEGY_KEEP_ONLY_LATEST` jette les images que
    // ce fil n'a pas eu le temps de prendre, ce qui est exactement ce qu'on veut d'un flux
    // vidéo — une image vieille d'une seconde n'apprend rien.
    val executeur = remember { Executors.newSingleThreadExecutor() }
    DisposableEffect(Unit) { onDispose { executeur.shutdown() } }

    AndroidView(
        modifier = Modifier.fillMaxWidth().aspectRatio(3f / 4f).reperes("view.scanner"),
        factory = { ctx ->
            val vue = PreviewView(ctx)
            val fournisseur = ProcessCameraProvider.getInstance(ctx)
            fournisseur.addListener(
                {
                    val camera = fournisseur.get()
                    val apercu = Preview.Builder().build().also {
                        it.surfaceProvider = vue.surfaceProvider
                    }
                    val analyse = ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                    analyse.setAnalyzer(executeur, LecteurDeQrCode(surCharge))
                    runCatching {
                        camera.unbindAll()
                        camera.bindToLifecycle(
                            cycleDeVie,
                            CameraSelector.DEFAULT_BACK_CAMERA,
                            apercu,
                            analyse,
                        )
                    }
                },
                ContextCompat.getMainExecutor(ctx),
            )
            vue
        },
    )
}

/**
 * Le décodeur : un tableau de luminance en entrée, une chaîne en sortie.
 *
 * `ZXing` ne reçoit **que** le plan de luminance (`planes[0]`) du format YUV que CameraX
 * livre. C'est suffisant pour un QR code, qui est noir et blanc, et c'est aussi ce qui rend
 * le décodage bon marché : la chrominance n'est jamais lue.
 *
 * `rowStride` et non `image.width` comme largeur de données : CameraX aligne ses lignes, et
 * la foulée dépasse souvent la largeur utile. Les confondre décale chaque ligne d'un peu
 * plus que la précédente — l'image devient une diagonale, et **plus aucun code ne se
 * décode**, sans aucune erreur pour le dire.
 */
private class LecteurDeQrCode(private val surCharge: (String) -> Unit) : ImageAnalysis.Analyzer {

    private val lecteur = MultiFormatReader().apply {
        setHints(mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE)))
    }

    /**
     * Un seul code est remonté, **et c'est structurel**.
     *
     * L'analyse continue tant que CameraX livre des images, et un QR code resté dans le
     * cadre se décode trente fois par seconde. Sans ce verrou, l'écran appellerait son
     * rappel autant de fois — donc se refermerait et remplirait le champ en boucle.
     */
    private val deja = AtomicBoolean(false)

    override fun analyze(image: ImageProxy) {
        try {
            if (deja.get()) return
            val plan = image.planes[0]
            val tampon = plan.buffer
            val octets = ByteArray(tampon.remaining())
            tampon.get(octets)
            val source = PlanarYUVLuminanceSource(
                octets,
                plan.rowStride,
                image.height,
                0,
                0,
                image.width,
                image.height,
                false,
            )
            val texte = lecteur.decodeWithState(BinaryBitmap(HybridBinarizer(source))).text
            if (texte != null && deja.compareAndSet(false, true)) surCharge(texte)
        } catch (_: ReaderException) {
            // Aucun code dans cette image : c'est le cas **ordinaire**, et de loin le plus
            // fréquent. ZXing le signale par une exception ; la journaliser remplirait les
            // traces à la cadence de la vidéo.
        } catch (_: IllegalStateException) {
            // L'image a été refermée sous nos pieds — la caméra se détache. Rien à dire.
        } finally {
            lecteur.reset()
            image.close()
        }
    }
}

@Composable
private fun Impossible(raison: String, contexte: Context? = null) {
    val couleurs = LocalCouleurs.current
    Column(
        Modifier.fillMaxWidth().carteDeVerre(),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            raison,
            color = couleurs.encre,
            fontSize = 14.sp,
            modifier = Modifier.reperes("text.scanImpossible"),
        )
        // La porte de sortie, et elle est la même dans les deux cas : la clé se colle
        // toujours à la main. Un écran qui ne dit que « refusé » laisse devant un mur.
        Text(
            stringResource(R.string.scan_coller_a_la_main),
            color = couleurs.attenue,
            fontSize = 12.sp,
        )
        if (contexte != null) {
            LienDiscret(
                texte = stringResource(R.string.scan_ouvrir_les_reglages),
                identifiant = "button.openSettings",
            ) {
                // Les réglages **de cette application**, pas ceux du système : c'est là que
                // vit l'interrupteur de la caméra, et y arriver en trois gestes de moins
                // est tout ce que ce lien apporte.
                runCatching {
                    contexte.startActivity(
                        Intent(
                            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.fromParts("package", contexte.packageName, null),
                        ),
                    )
                }
            }
        }
    }
}

private fun camerAutorisee(contexte: Context): Boolean =
    ContextCompat.checkSelfPermission(contexte, android.Manifest.permission.CAMERA) ==
        PackageManager.PERMISSION_GRANTED

/**
 * L'appareil a-t-il une caméra ?
 *
 * `FEATURE_CAMERA_ANY` et non `FEATURE_CAMERA` : le second ne parle que de la caméra
 * arrière, et un appareil qui n'aurait qu'une caméra frontale répondrait « non » alors qu'il
 * sait parfaitement lire un QR code.
 */
private fun aUneCamera(contexte: Context): Boolean =
    contexte.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
