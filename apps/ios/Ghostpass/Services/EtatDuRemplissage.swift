import AuthenticationServices
import SwiftUI

/// Le remplissage automatique est-il activé dans les réglages d'iOS ?
///
/// ─── Pourquoi cet objet existe ───
///
/// Poser l'application ne suffit pas : tant que GhostPass n'est pas coché dans
/// *Réglages > Général > Saisie automatique et mots de passe*, **l'extension n'est jamais
/// appelée**. Rien ne se passe, aucune erreur n'est levée, et l'absence de proposition
/// ressemble trait pour trait à une extension défaillante. Le script de déploiement
/// rappelle ce geste à qui pose l'application ; il n'y avait rien pour le dire à qui
/// l'utilise.
///
/// ─── Ce qu'on lit, et ce qu'on n'a pas le droit de supposer ───
///
/// `ASCredentialIdentityStore.state().isEnabled` répond pour de bon : c'est le système qui
/// parle, pas une préférence qu'on aurait écrite de notre côté. Un drapeau local dirait
/// « activé » après que l'utilisateur a décoché la case ailleurs, et proposerait alors un
/// remplissage qui ne viendra pas.
///
/// D'où la relecture **à chaque retour au premier plan** : le seul chemin normal pour
/// activer l'extension passe par les réglages, donc par une sortie de l'application.
@MainActor
final class EtatDuRemplissage: ObservableObject {
    /// `nil` tant qu'on n'a pas demandé — à distinguer de « non activé ». Les confondre
    /// ferait clignoter le bandeau au lancement, le temps que le système réponde.
    @Published private(set) var active: Bool?

    func relire() async {
        active = await ASCredentialIdentityStore.shared.state().isEnabled
    }

    /// Ouvre l'écran des réglages où la case se coche — le geste unique.
    ///
    /// `ASSettingsHelper` mène droit à la liste des fournisseurs. L'ancienne manière,
    /// `UIApplication.openSettingsURLString`, ouvre la fiche de **l'application**, d'où il
    /// faut encore remonter deux niveaux et trouver une rubrique qui ne porte pas le même
    /// nom d'une version d'iOS à l'autre. C'est cette incertitude de libellé qui rend le
    /// tap unique préférable à une instruction écrite.
    func ouvrirLesReglages() {
        ASSettingsHelper.openCredentialProviderAppSettings()
    }
}
