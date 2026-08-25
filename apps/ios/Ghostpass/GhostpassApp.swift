import SwiftUI

@main
struct GhostpassApp: App {
    @StateObject private var store = VaultStore()
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
        }
        .onChange(of: scenePhase) { _, phase in
            // Passer en arrière-plan relâche les clés. Un coffre qui reste ouvert
            // pendant que le téléphone circule n'est plus un coffre.
            if phase == .background { store.lock() }
        }
    }
}
