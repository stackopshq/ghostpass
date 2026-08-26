import SwiftUI

/// Apparence et langue. Deux réglages, présentés comme des choix et non comme des
/// options cachées : celui qui veut son coffre en clair, ou en anglais sur un téléphone
/// français, n'a pas à modifier les réglages de tout l'appareil pour l'obtenir.
struct SettingsView: View {
    @EnvironmentObject private var prefs: Preferences
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            GhostScreen {
                GhostSection(
                    titre: "Apparence",
                    note: "« Système » suit le réglage de l'appareil, y compris son passage automatique à la nuit."
                ) {
                    // Trois vignettes plutôt qu'une liste déroulante : le choix est visuel,
                    // et l'aperçu vaut mieux qu'un nom.
                    HStack(spacing: 10) {
                        ForEach(Apparence.allCases) { cas in
                            vignette(cas)
                        }
                    }
                    .padding(12)
                }

                GhostSection(
                    titre: "Verrouillage",
                    note: "Pendant ce délai, le coffre reste ouvert en mémoire — jamais sur le disque — et son contenu est masqué dans le sélecteur d'applications."
                ) {
                    ForEach(Array(Verrouillage.allCases.enumerated()), id: \.element.id) {
                        index, cas in
                        if index > 0 { GhostDivider() }
                        Button {
                            prefs.verrouillage = cas
                        } label: {
                            HStack(spacing: 12) {
                                Text(cas.libelle).foregroundStyle(Color.gpInk)
                                Spacer(minLength: 8)
                                if prefs.verrouillage == cas {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(Color.gpAccentText)
                                }
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 13)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("row.lock.\(cas.rawValue)")
                    }
                }

                GhostSection(
                    titre: "Icônes des sites",
                    note: "Le coffre est chiffré de bout en bout : le serveur n'en connaît pas le contenu. Réclamer une icône, en revanche, lui nomme un domaine. Aucun tiers n'est sollicité."
                ) {
                    Toggle(isOn: $prefs.afficheLesIcones) {
                        Text("Afficher les logos").foregroundStyle(Color.gpInk)
                    }
                    .tint(Color.gpAccent)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .accessibilityIdentifier("toggle.icons")
                }

                GhostSection(
                    titre: "Langue",
                    note: "Le changement s'applique aussitôt, sans redémarrer l'application."
                ) {
                    ForEach(Array(Langue.allCases.enumerated()), id: \.element.id) { index, cas in
                        if index > 0 { GhostDivider() }
                        Button {
                            prefs.langue = cas
                        } label: {
                            HStack(spacing: 12) {
                                Group {
                                    if let nom = cas.nomNatif {
                                        // Le nom d'une langue s'écrit dans cette langue.
                                        Text(verbatim: nom)
                                    } else {
                                        Text("Système")
                                    }
                                }
                                .foregroundStyle(Color.gpInk)
                                Spacer(minLength: 8)
                                if prefs.langue == cas {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(Color.gpAccentText)
                                }
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 13)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("row.langue.\(cas.rawValue)")
                    }
                }
            }
            .navigationTitle("Réglages")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Terminé") { dismiss() }
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.gpAccentText)
                        .accessibilityIdentifier("button.doneSettings")
                }
            }
        }
        .tint(Color.gpAccentText)
    }

    private func vignette(_ cas: Apparence) -> some View {
        let choisi = prefs.apparence == cas
        return Button {
            prefs.apparence = cas
        } label: {
            VStack(spacing: 8) {
                Image(systemName: cas.icone)
                    .font(.system(size: 19, weight: .medium))
                Text(cas.libelle)
                    .font(.caption.weight(.medium))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(
                choisi ? Color.gpAccent.opacity(0.18) : Color.gpSurface2,
                in: RoundedRectangle(cornerRadius: GP.radius)
            )
            .overlay(
                RoundedRectangle(cornerRadius: GP.radius)
                    .strokeBorder(
                        choisi ? Color.gpAccent : Color.gpBorder,
                        lineWidth: choisi ? 1.5 : 1))
            .foregroundStyle(choisi ? Color.gpAccentText : Color.gpMuted)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("tile.apparence.\(cas.rawValue)")
    }
}
