import SwiftUI
import UIKit

/// Rendre les captures d'écran vides, là où iOS ne permet pas de les interdire.
///
/// # ⚠︎ NON ACTIVÉ, ET NON VÉRIFIÉ
///
/// Ce fichier n'est branché nulle part. Il attend une mesure **sur un vrai iPhone**, et il
/// ne doit pas être activé avant.
///
/// Pourquoi le simulateur ne suffit pas : `xcrun simctl io screenshot` lit la mémoire
/// d'affichage, et rend l'écran **complet** même avec la couche en place. On ne peut donc
/// pas y distinguer « la protection ne prend pas » de « le simulateur ne la simule pas ».
/// Les deux rendent la même image, et conclure de l'une à l'autre serait précisément la
/// faute que cette base de code passe sa journée à traquer.
///
/// ## Le protocole, quand un iPhone sera branché
///
/// 1. rebrancher `ProtectionDesCaptures { … }` autour du `Group` de `GhostpassApp` ;
/// 2. installer sur l'appareil, ouvrir le coffre ;
/// 3. **bouton latéral + volume haut**, la capture de l'utilisateur ;
/// 4. regarder l'image dans Photos : elle doit être vide.
///
/// Et le contrôle négatif, sans lequel l'étape 4 ne prouve rien : refaire la même chose
/// **sans** la protection, et vérifier que l'image montre bien le coffre. Une capture vide
/// pour une autre raison — écran verrouillé, application en arrière-plan — passerait pour
/// un succès.
///
/// Android a `FLAG_SECURE` (voir `docs/adr/0003`). iOS n'a **aucune API** pour empêcher une
/// capture — c'est un choix d'Apple, et il ne changera pas parce qu'on le souhaite.
///
/// Il existe en revanche un comportement du système qu'on peut détourner : la couche de
/// rendu d'un `UITextField` en **saisie sécurisée** est exclue des captures, des
/// enregistrements d'écran et du partage d'écran. On y range le contenu de l'application,
/// et le système rend du vide à sa place.
///
/// Idée de Kevin, le 2026-08-31 : « ok ça screenshot, mais c'est juste une image blanche ».
///
/// ─── Ce que ça coûte, et qu'il faut savoir avant de s'en servir ───
///
/// **Ce n'est pas une API publique.** On n'appelle rien de privé — `UITextField` et
/// `isSecureTextEntry` sont publics — mais on s'appuie sur la *structure interne* de sa
/// hiérarchie de vues, qu'Apple ne documente ni ne garantit. La technique tient depuis des
/// années et de grandes applications s'en servent ; elle peut cesser de fonctionner à une
/// version d'iOS près.
///
/// **Et si elle cesse, elle échoue en s'ouvrant.** Les captures redeviennent lisibles, sans
/// erreur, sans plantage, sans le moindre signe. Une protection qui se dégrade en silence
/// est pire qu'une protection absente, parce qu'on continue de compter dessus.
///
/// D'où [`estActive`], qui dit si le détournement a pris. Un test le lit ; il n'y a pas de
/// raison de le croire sur parole plus que le reste.
struct ProtectionDesCaptures<Contenu: View>: UIViewControllerRepresentable {
    @ViewBuilder var contenu: Contenu

    func makeUIViewController(context: Context) -> UIViewController {
        let hote = UIHostingController(rootView: contenu)
        let controleur = ControleurProtege(hote: hote)
        return controleur
    }

    func updateUIViewController(_ controleur: UIViewController, context: Context) {
        (controleur as? ControleurProtege)?.mettreAJour(contenu)
    }
}

/// Le porteur : il loge la vue hôte dans la couche sécurisée quand il la trouve, et dans sa
/// propre vue sinon.
final class ControleurProtege: UIViewController {
    private let hote: UIHostingController<AnyView>
    /// Le détournement a-t-il pris sur cet appareil et cette version d'iOS ?
    ///
    /// Faux ne casse rien : l'application s'affiche normalement, seulement sans la
    /// protection. C'est précisément pour ça qu'il faut pouvoir le lire.
    private(set) var estActive = false

    init<Contenu: View>(hote: UIHostingController<Contenu>) {
        self.hote = UIHostingController(rootView: AnyView(hote.rootView))
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("non disponible") }

    func mettreAJour<Contenu: View>(_ contenu: Contenu) {
        hote.rootView = AnyView(contenu)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        addChild(hote)

        // On **déplace la couche sécurisée dans notre vue**, puis on y range l'hôte.
        // La première version fouillait `superview.superview` pour retrouver le champ ;
        // elle plantait au lancement. Le geste juste est plus court : la couche se
        // détache de son champ et devient notre vue de contenu.
        if let couche = Self.couchePrivee() {
            estActive = true
            couche.subviews.forEach { $0.removeFromSuperview() }
            couche.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(couche)
            NSLayoutConstraint.activate([
                couche.topAnchor.constraint(equalTo: view.topAnchor),
                couche.bottomAnchor.constraint(equalTo: view.bottomAnchor),
                couche.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                couche.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            ])
            ajouter(hote.view, dans: couche)
        } else {
            // Le détournement n'a pas pris : l'application s'affiche normalement, sans la
            // protection. Elle ne doit surtout pas cesser de fonctionner pour autant.
            ajouter(hote.view, dans: view)
        }
        hote.didMove(toParent: self)
    }

    private func ajouter(_ vue: UIView, dans parent: UIView) {
        vue.translatesAutoresizingMaskIntoConstraints = false
        parent.addSubview(vue)
        NSLayoutConstraint.activate([
            vue.topAnchor.constraint(equalTo: parent.topAnchor),
            vue.bottomAnchor.constraint(equalTo: parent.bottomAnchor),
            vue.leadingAnchor.constraint(equalTo: parent.leadingAnchor),
            vue.trailingAnchor.constraint(equalTo: parent.trailingAnchor),
        ])
    }

    /// La couche de rendu d'un champ en saisie sécurisée, si on la trouve.
    ///
    /// On la cherche par forme et non par nom de classe : chercher
    /// `_UITextLayoutCanvasView` marcherait aujourd'hui et casserait au premier renommage,
    /// sans qu'on l'apprenne autrement qu'en le mesurant.
    static func couchePrivee() -> UIView? {
        let champ = UITextField()
        champ.isSecureTextEntry = true
        champ.translatesAutoresizingMaskIntoConstraints = false
        // La hiérarchie n'existe qu'une fois la mise en page faite.
        champ.layoutIfNeeded()
        return champ.subviews.first
    }
}
