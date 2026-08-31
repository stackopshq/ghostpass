import SwiftUI

@main
struct GhostpassApp: App {
    init() {
        // Aucune réponse réseau ne touche le disque.
        //
        // Le cache d'URL écrit les requêtes et leurs réponses dans un fichier système que
        // l'application ne protège pas et ne contrôle pas. Les seules qui y passaient
        // étaient celles du proxy d'icônes — `?domain=github.com` — et cela suffisait :
        // le coffre restait chiffré, mais **la liste des sites qu'il contient** cessait de
        // l'être, ce que le chiffrement de bout en bout visait précisément à cacher.
        //
        // Purger à la déconnexion ne traitait qu'un moment. Un cache sans disque ferme la
        // classe entière, y compris pour la requête qu'on ajoutera un jour sans y penser :
        // la donnée sensible n'est ni dans le corps ni chiffrable, elle est dans le chemin,
        // et le chemin est ce que toute couche journalise par défaut. La mémoire suffit —
        // les icônes se rechargent, et elles ne coûtent rien.
        URLCache.shared = URLCache(memoryCapacity: 16 * 1024 * 1024, diskCapacity: 0)

        // Les barres de navigation gardent leurs teintes système, qui jurent avec la nuit
        // de la suite : on les aligne une fois pour toutes plutôt qu'écran par écran.
        let barre = UINavigationBarAppearance()
        barre.configureWithTransparentBackground()
        barre.titleTextAttributes = [.foregroundColor: UIColor(Color.gpInk)]
        barre.largeTitleTextAttributes = [.foregroundColor: UIColor(Color.gpInk)]
        UINavigationBar.appearance().standardAppearance = barre
        UINavigationBar.appearance().scrollEdgeAppearance = barre
        UINavigationBar.appearance().compactAppearance = barre
    }

    @StateObject private var store = VaultStore()
    @StateObject private var prefs = Preferences.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Group {
                if store.isUnlocked {
                    VaultListView()
                } else {
                    UnlockView()
                }
            }
            // Le sélecteur d'applications photographie l'écran à la sortie. Si le coffre
            // reste ouvert derrière, son contenu se retrouverait dans cette vignette, et
            // dans les captures que le système garde sur disque.
            .overlay {
                if scenePhase != .active && store.isUnlocked {
                    VoileDeConfidentialite()
                }
            }
            .environmentObject(store)
            .environmentObject(prefs)
            // « Configurer les codes dans » désigne l'application qui ouvre les liens et
            // les QR codes de second facteur. Déclarer le schéma sans traiter ce qui
            // arrive serait pire que ne rien déclarer : le système enverrait ces liens à
            // une application qui les avale en silence.
            .onOpenURL { store.recevoirUnLien($0) }
            // Les deux réglages s'appliquent à la racine : tout ce qui est présenté
            // par-dessus — feuilles, alertes — en hérite, alors qu'un réglage posé
            // écran par écran laisserait des îlots dans l'autre thème ou l'autre langue.
            .preferredColorScheme(prefs.colorScheme)
            .environment(\.locale, prefs.locale ?? Locale.autoupdatingCurrent)
        }
        .onChange(of: scenePhase) { _, phase in
            // Un coffre qui reste ouvert pendant que le téléphone circule n'est plus un
            // coffre — mais refermer à chaque aller-retour vers Safari fait renoncer à
            // s'en servir. Le délai est donc réglable, et vaut zéro par défaut.
            switch phase {
            case .background: store.noterLaSortieDeLEcran(delai: prefs.verrouillage.delai)
            case .active: store.verrouillerSiLeDelaiEstEcoule(delai: prefs.verrouillage.delai)
            // « Immédiatement » doit vouloir dire ce qu'il dit. Un aller-retour rapide ne
            // passe jamais par `.background` : sans cette branche, le coffre restait
            // ouvert et le réglage ne verrouillait qu'au bon vouloir du système.
            case .inactive: store.noterLInactivite(delai: prefs.verrouillage.delai)
            @unknown default: break
            }
        }
    }
}
