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
                    note:
                        "« Système » suit le réglage de l'appareil, y compris son passage automatique à la nuit."
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
                    note:
                        "Pendant ce délai, le coffre reste ouvert en mémoire — jamais sur le disque — et son contenu est masqué dans le sélecteur d'applications."
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

                // ─── Ce que voit le remplissage automatique ───
                //
                // L'extension est un processus séparé qui ne lit **que** la copie déposée
                // dans le conteneur partagé. Quand cette copie manque, elle affiche
                // « Aucun identifiant » — un message qui décrit son écran sans rien dire
                // de la cause, et qui ressemble à s'y méprendre à un défaut d'appariement
                // de domaine. Rien dans l'application ne permettait de trancher : ni
                // l'état du partage ni le contenu de la copie n'étaient visibles quelque
                // part.
                //
                // Cette section ne répare rien ; elle rend lisible un état invisible, ce
                // qui vaut mieux qu'un second écran silencieux.
                GhostSection(
                    titre: "Remplissage automatique",
                    note:
                        "L'extension ne voit pas le serveur : elle lit une copie chiffrée déposée par l'application. Une copie vide ne propose rien, quel que soit le site."
                ) {
                    ligneDeDiagnostic(
                        "Conteneur partagé",
                        SharedStore.isShared ? "actif" : "indisponible",
                        alerte: !SharedStore.isShared)
                    GhostDivider()
                    ligneDeDiagnostic(
                        "Coffre personnel",
                        elementsEnCopie.map { "\($0) élément(s)" } ?? "absent",
                        alerte: (elementsEnCopie ?? 0) == 0)
                    GhostDivider()
                    // Compté à part, et c'est la leçon : la première version de cette
                    // section ne comptait que le coffre personnel. Elle affichait donc
                    // « 0 » avec la même assurance, que les coffres d'équipe fussent
                    // déposés ou non — un indicateur qui ne mesure pas ce qu'on lui
                    // demande vaut moins que pas d'indicateur du tout, puisqu'on le croit.
                    ligneDeDiagnostic(
                        "Coffres d'équipe",
                        equipesEnCopie.map { "\($0.elements) élément(s) · \($0.coffres) coffre(s)" }
                            ?? "absents",
                        alerte: (equipesEnCopie?.elements ?? 0) == 0)
                }

                GhostSection(
                    titre: "Icônes des sites",
                    note:
                        "Le coffre est chiffré de bout en bout : le serveur n'en connaît pas le contenu. Réclamer une icône, en revanche, lui nomme un domaine. Aucun tiers n'est sollicité."
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

    /// Le nombre d'éléments dans la copie locale, ou `nil` si elle n'existe pas.
    ///
    /// On compte les enregistrements chiffrés **sans les déchiffrer** : la question est
    /// « l'application a-t-elle déposé quelque chose », pas « ce dépôt est-il lisible ».
    /// Les confondre ferait passer un dépôt réussi mais illisible pour une absence.
    private var elementsEnCopie: Int? { VaultCache.load()?.count }

    /// Ce que le dépôt d'équipe contient : combien de coffres, et combien d'éléments en
    /// tout. Les deux comptes séparément, parce qu'ils se trompent différemment — des
    /// coffres sans éléments veut dire « ouverts mais vides », zéro coffre veut dire
    /// « rien n'a été déposé ».
    private var equipesEnCopie: (coffres: Int, elements: Int)? {
        guard let coffres = TeamCache.load() else { return nil }
        return (coffres.count, coffres.reduce(0) { $0 + $1.items.count })
    }

    private func ligneDeDiagnostic(_ titre: String, _ valeur: String, alerte: Bool)
        -> some View
    {
        HStack {
            Text(verbatim: titre).foregroundStyle(Color.gpInk)
            Spacer()
            Text(verbatim: valeur).foregroundStyle(alerte ? Color.gpDanger : Color.gpMuted)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
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
                        lineWidth: choisi ? 1.5 : 1)
            )
            .foregroundStyle(choisi ? Color.gpAccentText : Color.gpMuted)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("tile.apparence.\(cas.rawValue)")
    }
}
