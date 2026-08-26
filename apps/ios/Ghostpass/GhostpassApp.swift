import SwiftUI

@main
struct GhostpassApp: App {
    init() {
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
            .environmentObject(store)
            .environmentObject(prefs)
            // Les deux réglages s'appliquent à la racine : tout ce qui est présenté
            // par-dessus — feuilles, alertes — en hérite, alors qu'un réglage posé
            // écran par écran laisserait des îlots dans l'autre thème ou l'autre langue.
            .preferredColorScheme(prefs.colorScheme)
            .environment(\.locale, prefs.locale ?? Locale.autoupdatingCurrent)
        }
        .onChange(of: scenePhase) { _, phase in
            // Passer en arrière-plan relâche les clés. Un coffre qui reste ouvert
            // pendant que le téléphone circule n'est plus un coffre.
            if phase == .background { store.lock() }
        }
    }
}
