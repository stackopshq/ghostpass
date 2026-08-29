import AVFoundation
import SwiftUI
import UIKit

/// Lit avec l'appareil photo le QR code que les sites affichent pour activer un second
/// facteur.
///
/// Recopier une clé base32 à la main est le moment où l'on se trompe : trente-deux
/// caractères sans séparateur, dans une police où le 0 et le O se ressemblent. Le QR code
/// porte la même clé, plus l'émetteur, le nombre de chiffres et la période — que la saisie
/// manuelle oblige à laisser aux valeurs par défaut.
///
/// Rien n'est enregistré : les images du flux vidéo ne quittent jamais la mémoire, et la
/// session s'arrête dès qu'un code est retenu.
struct ScanDeTotpView: View {
    /// Appelé avec l'URI `otpauth://` retenue. La feuille se referme ensuite.
    let onLecture: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var etat: Etat = .demarrage
    @State private var refus: String?

    enum Etat: Equatable {
        case demarrage
        case lecture
        /// L'utilisateur a refusé l'appareil photo, ou l'appareil n'en a pas — un
        /// simulateur, par exemple. Les deux cas se disent, aucun ne se contourne.
        case indisponible(String)
    }

    var body: some View {
        NavigationStack {
            GhostScreen {
                VStack(spacing: 16) {
                    switch etat {
                    case .demarrage:
                        ProgressView().tint(Color.gpAccentText)
                            .frame(maxWidth: .infinity, minHeight: 200)
                    case .indisponible(let raison):
                        indisponible(raison)
                    case .lecture:
                        viseur
                    }
                }
            }
            .navigationTitle("Scanner le QR code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                        .foregroundStyle(Color.gpAccentText)
                        .accessibilityIdentifier("button.closeScan")
                }
            }
        }
        .tint(Color.gpAccentText)
        .task { etat = await Camera.disponibilite() }
    }

    private var viseur: some View {
        VStack(spacing: 14) {
            VueDeCapture(onCharge: interpreter)
                .frame(maxWidth: .infinity)
                .aspectRatio(3 / 4, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: GP.radius))
                .overlay(
                    RoundedRectangle(cornerRadius: GP.radius)
                        .strokeBorder(Color.gpAccent, lineWidth: 1.5)
                )
                .accessibilityIdentifier("view.scanner")

            // Le refus s'affiche sans arrêter la lecture : viser le mauvais code est
            // fréquent — une page en affiche souvent plusieurs — et refermer la caméra
            // à chaque erreur obligerait à tout recommencer.
            if let refus {
                Text(refus)
                    .font(.footnote)
                    .foregroundStyle(Color.gpDanger)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text("Visez le QR code affiché par le site.")
                    .font(.footnote)
                    .foregroundStyle(Color.gpMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func indisponible(_ raison: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(verbatim: raison)
                .foregroundStyle(Color.gpInk)
                .fixedSize(horizontal: false, vertical: true)
            Text("La clé peut toujours être collée dans le champ.")
                .font(.footnote)
                .foregroundStyle(Color.gpMuted)
            if let reglages = URL(string: UIApplication.openSettingsURLString) {
                Link("Ouvrir les réglages", destination: reglages)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.gpAccentText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard()
    }

    private func interpreter(_ charge: String) {
        switch Totp.depuisUnQrCode(charge) {
        case .totp(let uri):
            onLecture(uri)
            dismiss()
        case .exportDApplication:
            refus = String(
                localized:
                    "Ce code exporte plusieurs comptes depuis une application d'authentification. Affichez le QR code d'un seul compte, depuis le site."
            )
        case .autreChose:
            refus = String(
                localized: "Ce QR code ne contient pas de second facteur.")
        }
    }
}

// MARK: - L'appareil photo

private enum Camera {
    /// Ce qu'on peut faire, demandé au système plutôt que supposé.
    ///
    /// Trois issues, et pas deux : l'autorisation peut être refusée, mais l'appareil peut
    /// aussi n'avoir aucune caméra — c'est le cas du simulateur, où une vue de capture
    /// muette laisserait croire à une panne.
    static func disponibilite() async -> ScanDeTotpView.Etat {
        guard
            AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
                != nil
        else {
            return .indisponible(
                String(localized: "Cet appareil n'a pas de caméra utilisable."))
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            return .lecture
        case .notDetermined:
            let accorde = await AVCaptureDevice.requestAccess(for: .video)
            return accorde
                ? .lecture
                : .indisponible(
                    String(localized: "L'accès à l'appareil photo a été refusé."))
        default:
            return .indisponible(
                String(
                    localized:
                        "L'accès à l'appareil photo est refusé pour GhostPass. Il s'autorise dans les réglages du système."
                ))
        }
    }
}

/// La vue vidéo elle-même. SwiftUI n'expose pas AVFoundation : il faut passer par UIKit.
private struct VueDeCapture: UIViewControllerRepresentable {
    let onCharge: (String) -> Void

    func makeUIViewController(context: Context) -> ControleurDeCapture {
        let c = ControleurDeCapture()
        c.onCharge = onCharge
        return c
    }

    func updateUIViewController(_ controleur: ControleurDeCapture, context: Context) {
        controleur.onCharge = onCharge
    }
}

private final class ControleurDeCapture: UIViewController,
    AVCaptureMetadataOutputObjectsDelegate
{
    var onCharge: ((String) -> Void)?

    private let session = AVCaptureSession()
    /// `startRunning` bloque le fil qui l'appelle. Sur le fil principal, l'interface se
    /// fige le temps que la caméra s'ouvre — une demi-seconde qui se voit.
    private let fil = DispatchQueue(label: "ch.stackops.ghostpass.scan")
    private var dernier: String?

    private final class VuePreview: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var couche: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }

    private var preview: VuePreview { view as! VuePreview }

    override func loadView() { view = VuePreview() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        preview.couche.session = session
        preview.couche.videoGravity = .resizeAspectFill

        guard
            let appareil = AVCaptureDevice.default(
                .builtInWideAngleCamera, for: .video, position: .back),
            let entree = try? AVCaptureDeviceInput(device: appareil),
            session.canAddInput(entree)
        else { return }
        session.addInput(entree)

        let sortie = AVCaptureMetadataOutput()
        guard session.canAddOutput(sortie) else { return }
        session.addOutput(sortie)
        sortie.setMetadataObjectsDelegate(self, queue: .main)
        // L'ordre compte : les types disponibles ne sont connus qu'une fois la sortie
        // rattachée à la session. Régler `metadataObjectTypes` avant lève une exception.
        sortie.metadataObjectTypes = [.qr]
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // L'iPad tourne. Sans ce réglage, l'image reste en portrait dans un cadre en
        // paysage, et l'utilisateur croit que la caméra est cassée.
        guard let connexion = preview.couche.connection else { return }
        let angle: CGFloat
        switch view.window?.windowScene?.interfaceOrientation {
        case .landscapeLeft: angle = 180
        case .landscapeRight: angle = 0
        case .portraitUpsideDown: angle = 270
        default: angle = 90
        }
        if connexion.isVideoRotationAngleSupported(angle) {
            connexion.videoRotationAngle = angle
        }
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        fil.async { [session] in
            if !session.isRunning { session.startRunning() }
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        fil.async { [session] in
            if session.isRunning { session.stopRunning() }
        }
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard
            let objet = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
            let charge = objet.stringValue
        else { return }
        // La caméra rend le même code trente fois par seconde. Sans ce garde, un code
        // refusé ferait clignoter son message, et un code accepté rappellerait la
        // fermeture plusieurs fois.
        guard charge != dernier else { return }
        dernier = charge
        onCharge?(charge)
    }
}
