import SwiftUI

/// Le coffre : la liste des identifiants, posée sur la nuit de la suite.
struct VaultListView: View {
    @EnvironmentObject private var store: VaultStore
    @EnvironmentObject private var remplissage: EtatDuRemplissage
    @State private var search = ""
    /// Une seule feuille à la fois : deux modificateurs `.sheet` sur la même vue se
    /// marchent dessus, et c'est la première déclarée qui cesse de s'ouvrir.
    @State private var sheet: VaultSheet?
    /// Dossier affiché ; `nil` pour tout le coffre.
    @State private var filtre: FiltreDuCoffre = .tout
    /// L'élément d'équipe dont on demande confirmation avant de le détruire.
    @State private var aSupprimerDefinitivement: VaultEntry?
    /// Le chemin de navigation, tenu à la main : c'est ce qui permet à l'écran de santé
    /// d'envoyer directement sur l'élément qu'il signale.
    @State private var chemin: [VaultEntry] = []
    /// L'élément qu'une feuille demande d'ouvrir. On attend qu'elle soit refermée pour
    /// pousser l'écran : présenter et empiler en même temps, et l'un des deux se perd.
    @State private var aOuvrir: VaultEntry?
    @ObservedObject private var prefs = Preferences.shared

    /// L'emoji de la barre, purement décoratif.
    ///
    /// Sorti du corps de la vue : la barre d'outils y était déjà longue et le vérificateur
    /// de types abandonnait — « unable to type-check this expression in reasonable time ».
    /// Un contenu de barre nommé lui rend la tâche possible, et se lit mieux.
    @ToolbarContentBuilder private var ornementDuCoffre: some ToolbarContent {
        if !Emoji.coffre.isEmpty {
            // iOS 26 enferme chaque élément de barre dans une capsule de verre. Elle
            // convient à un bouton, pas à un ornement : elle en a l'air, elle se touche,
            // et rien ne se produit — Kevin l'a essayée. `sharedBackgroundVisibility`
            // retire ce fond, mais n'existe qu'à partir d'iOS 26 ; en deçà la capsule
            // reste, et l'emoji au moins ne réagit plus.
            if #available(iOS 26.0, *) {
                ToolbarItem(placement: .topBarLeading) { emojiDuCoffre }
                    .sharedBackgroundVisibility(.hidden)
            } else {
                ToolbarItem(placement: .topBarLeading) { emojiDuCoffre }
            }
        }
    }

    /// Le bandeau qui propose d'activer le remplissage automatique.
    ///
    /// **Un bandeau, pas une fenêtre au premier lancement.** Une modale qu'on repousse une
    /// fois ne revient jamais, et la fonction resterait éteinte sans que rien ne le
    /// rappelle ; celui-ci reste tant que ce n'est pas activé et disparaît de lui-même dès
    /// que ça l'est. Il n'y a d'ailleurs rien à rejeter : ce n'est pas une réclame, c'est
    /// l'état d'une fonction qui ne marche pas.
    ///
    /// Il n'apparaît que sur un `false` franc. Tant que le système n'a pas répondu, l'état
    /// vaut `nil` et l'on n'affiche rien — sans quoi le bandeau clignoterait à chaque
    /// lancement, le temps de la réponse.
    private var bandeauDuRemplissage: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(
                "Remplissage automatique désactivé",
                systemImage: "rectangle.and.pencil.and.ellipsis"
            )
            .font(.system(.subheadline, weight: .semibold))
            .foregroundStyle(Color.gpInk)
            Text(
                "Tant que GhostPass n'est pas autorisé dans les réglages d'iOS, il ne vous proposera jamais vos identifiants dans Safari ni dans les applications."
            )
            .font(.footnote)
            .foregroundStyle(Color.gpMuted)
            .fixedSize(horizontal: false, vertical: true)
            Button("Ouvrir les réglages") { remplissage.ouvrirLesReglages() }
                .buttonStyle(SecondaryButtonStyle())
                .accessibilityIdentifier("button.enableAutofill")
        }
        .glassCard()
        .accessibilityIdentifier("banner.autofill")
    }

    private var emojiDuCoffre: some View {
        Text(verbatim: Emoji.coffre)
            .font(.title3)
            // Décoratif : rien à annoncer, et le titre le suit aussitôt.
            .accessibilityHidden(true)
            .allowsHitTesting(false)
    }

    private var visible: [VaultEntry] {
        store.entries.filter { entry in
            guard filtre.retient(entry) else { return false }
            guard !search.isEmpty else { return true }
            return entry.item.name.localizedCaseInsensitiveContains(search)
                || (entry.login?.username.localizedCaseInsensitiveContains(search) ?? false)
                || (entry.login?.uris.contains { $0.localizedCaseInsensitiveContains(search) }
                    ?? false)
                // Chercher le nom de l'équipe rassemble tout ce qu'elle partage.
                || (entry.origine.nomDeLEquipe?.localizedCaseInsensitiveContains(search)
                    ?? false)
        }
    }

    var body: some View {
        NavigationStack(path: $chemin) {
            ZStack {
                GhostBackground()

                List {
                    if store.isOffline {
                        bandeauHorsLigne
                            .listRowInsets(.init(top: 0, leading: 16, bottom: 8, trailing: 16))
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }

                    if remplissage.active == false {
                        bandeauDuRemplissage
                            .listRowInsets(
                                .init(top: 0, leading: 16, bottom: 12, trailing: 16)
                            )
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }

                    filtreDeDossier
                        .listRowInsets(.init(top: 0, leading: 16, bottom: 8, trailing: 16))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)

                    // Les favoris en tête, et seulement quand on regarde le coffre
                    // entier : sous un filtre ou une recherche, les répéter reviendrait à
                    // montrer deux fois les mêmes lignes.
                    if !favoris.isEmpty {
                        Section {
                            ForEach(favoris) { entry in
                                ligne(entry)
                            }
                        } header: {
                            // L'intitulé s'affiche en capitales : c'est l'identifiant, et
                            // non le libellé, qui permet de le retrouver dans les tests.
                            Text("Favoris").sectionLabel().padding(.leading, 2)
                                .accessibilityIdentifier("header.favorites")
                        }
                        .listRowInsets(.init(top: 4, leading: 16, bottom: 4, trailing: 16))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }

                    ForEach(visible) { entry in
                        ligne(entry)
                            .listRowInsets(.init(top: 4, leading: 16, bottom: 4, trailing: 16))
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .overlay {
                    if store.entries.isEmpty {
                        coffreVide
                    } else if visible.isEmpty {
                        aucunResultat
                    }
                }
            }
            .navigationDestination(for: VaultEntry.self) { entry in
                // On repart de l'entrée telle qu'elle est dans le coffre, pas de la copie
                // capturée à la navigation : sinon une seconde modification rouvrirait
                // le formulaire avec le contenu d'avant la première.
                // Un élément d'équipe ouvert depuis la liste doit respecter le rôle : sans
                // cela, un membre en lecture seule se voyait proposer « Modifier » et
                // « Supprimer », que le serveur refusait ensuite. L'écran d'équipe le
                // faisait déjà ; la liste, non, parce qu'elle ignorait ces éléments.
                ItemDetailView(
                    entry: entry,
                    // Une entrée illisible est en lecture seule, quels que soient les
                    // droits : enregistrer écraserait un contenu qu'on n'a jamais lu, et
                    // ce serait la seule façon de perdre pour de bon ce qui n'était que
                    // temporairement inaccessible.
                    lectureSeule: !entry.lisible
                        || (entry.origine.appartenance.map { !$0.peutEcrire } ?? false)
                ) {
                    sheet = .editItem(store.entries.first { $0.id == entry.id } ?? entry)
                }
            }
            .searchable(text: $search, prompt: "Rechercher")
            .alert(item: $aSupprimerDefinitivement) { cible in
                Alert(
                    title: Text("Supprimer définitivement ?"),
                    message: Text(
                        "Cet élément appartient à une équipe : il disparaîtra pour tous ses membres, et il n'y a pas de corbeille pour le récupérer."
                    ),
                    primaryButton: .destructive(Text("Supprimer")) {
                        Task { await store.delete(cible) }
                    },
                    secondaryButton: .cancel(Text("Annuler")))
            }
            .refreshable { await store.refresh() }
            .navigationTitle("Coffre")
            .toolbarBackground(Color.gpBase.opacity(0.9), for: .navigationBar)
            .toolbar {
                // L'ornement vit dans la barre, pas dans le titre.
                //
                // Collé au titre, il partait avec lui partout où le titre sert
                // d'identité : le bouton retour des fiches devenait « ‹ 🪎 Coffre », et
                // VoiceOver annonçait l'emoji avant le mot à chaque fois. Ici il ne
                // décore que l'écran auquel il appartient.
                ornementDuCoffre
                // Le bouton n'a de sens que si le verrouillage automatique attend.
                //
                // Avec le réglage par défaut — immédiat — quitter l'application verrouille
                // déjà : le bouton occuperait alors la meilleure place de la barre pour un
                // geste que le système fait tout seul. Dès qu'un délai est réglé, il
                // redevient le seul moyen de verrouiller sur-le-champ.
                if prefs.verrouillage != .immediat {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Verrouiller") { store.lock() }
                            .foregroundStyle(Color.gpAccentText)
                            .accessibilityIdentifier("button.lock")
                    }
                }
                // Les réglages sortent du menu « … » : ils s'ouvrent plusieurs fois par
                // séance, et les chercher parmi douze entrées coûte deux gestes là où un
                // suffit. Le reste du menu, lui, ne se visite qu'à l'occasion — il garde
                // sa liste.
                //
                // Placée avant le menu, donc à sa gauche : le « + » reste l'action de
                // droite, celle que le pouce atteint sans regarder.
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        sheet = .settings
                    } label: {
                        Image(systemName: "gearshape")
                            .foregroundStyle(Color.gpAccentText)
                    }
                    .accessibilityLabel("Réglages")
                    .accessibilityIdentifier("button.preferences")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if store.biometryAvailable {
                            if store.isBiometricEnabled {
                                Button("Désactiver \(store.biometryLabel)", role: .destructive) {
                                    store.disableBiometrics()
                                }
                                .accessibilityIdentifier("button.biometricOff")
                            } else {
                                Button("Activer \(store.biometryLabel)") { sheet = .biometrics }
                                    .accessibilityIdentifier("button.biometricOn")
                            }
                        }
                        Button("Santé du coffre", systemImage: "checkmark.shield") {
                            sheet = .health
                        }
                        .accessibilityIdentifier("button.health")
                        Button("Clé de récupération", systemImage: "key.horizontal") {
                            sheet = .recoveryKey
                        }
                        .accessibilityIdentifier("button.recoveryKey")
                        Button("Accès d'urgence", systemImage: "person.2.badge.key") {
                            sheet = .emergency
                        }
                        .accessibilityIdentifier("button.emergency")
                        Button("Coffres partagés", systemImage: "person.2") {
                            sheet = .organizations
                        }
                        .accessibilityIdentifier("button.organizations")
                        Button("Partager un secret", systemImage: "paperplane") {
                            sheet = .send
                        }
                        .accessibilityIdentifier("button.send")
                        Button("Second facteur", systemImage: "lock.shield") {
                            sheet = .mfa
                        }
                        .accessibilityIdentifier("button.mfa")
                        Button("Journal du compte", systemImage: "list.bullet.rectangle") {
                            sheet = .activity
                        }
                        .accessibilityIdentifier("button.activity")
                        Button("Importer un CSV", systemImage: "square.and.arrow.down") {
                            sheet = .importCSV
                        }
                        .accessibilityIdentifier("button.import")
                        Button("Exporter le coffre", systemImage: "square.and.arrow.up") {
                            sheet = .exportCSV
                        }
                        .accessibilityIdentifier("button.export")
                        Button("Corbeille", systemImage: "trash") { sheet = .trash }
                            .accessibilityIdentifier("button.trash")
                        Button("Se déconnecter", role: .destructive) {
                            Task { await store.signOut() }
                        }
                        .accessibilityIdentifier("button.signOut")
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .foregroundStyle(Color.gpAccentText)
                    }
                    .accessibilityIdentifier("button.settings")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        sheet = .newItem
                    } label: {
                        Image(systemName: "plus")
                            .foregroundStyle(Color.gpAccentText)
                    }
                    .accessibilityIdentifier("button.add")
                }
            }
            // Un lien de second facteur peut arriver avant que cet écran existe — le
            // coffre était fermé quand le système l'a transmis. On le consomme donc à
            // l'apparition **et** au changement, sinon le cas le plus courant, celui du
            // QR code scanné depuis l'appareil photo, serait précisément celui qui échoue.
            .onAppear(perform: consommerLeLienEnAttente)
            .onChange(of: store.lienDeTotpEnAttente) { _, _ in consommerLeLienEnAttente() }
            .sheet(item: $sheet, onDismiss: ouvrirLElementDemande) { destination in
                switch destination {
                case .newItem:
                    ItemEditView(target: .new).environmentObject(store)
                case .lienDeTotp(let uri):
                    ItemEditView(target: .nouveauDepuisUnLien(uri)).environmentObject(store)
                case .editItem(let entry):
                    ItemEditView(target: .existing(entry)).environmentObject(store)
                case .biometrics:
                    BiometricSetupView().environmentObject(store)
                case .trash:
                    TrashView().environmentObject(store)
                case .folders:
                    FoldersView(selection: $filtre).environmentObject(store)
                case .settings:
                    SettingsView().environmentObject(Preferences.shared)
                case .biometricOffer:
                    BiometricOfferView().environmentObject(store)
                case .health:
                    HealthView { aOuvrir = $0 }.environmentObject(store)
                case .recoveryKey:
                    RecoveryKeyView().environmentObject(store)
                case .importCSV:
                    ImportView().environmentObject(store)
                case .exportCSV:
                    ExportView().environmentObject(store)
                case .emergency:
                    EmergencyView().environmentObject(store)
                case .organizations:
                    OrganizationsView().environmentObject(store)
                case .send:
                    SendView().environmentObject(store)
                case .mfa:
                    MfaView().environmentObject(store)
                case .activity:
                    ActivityView().environmentObject(store)
                }
            }
            // Une seule alerte, et rien d'autre par-dessus : deux modificateurs `.alert`
            // sur la même vue se marchent dessus exactement comme deux `.sheet`. La
            // liaison écrit en retour — un `.constant` ignore la fermeture que le système
            // lui demande d'enregistrer, et SwiftUI croit ensuite l'alerte encore là.
            .alert(
                "Erreur", isPresented: erreurAffichee,
                actions: { Button("OK") { store.errorMessage = nil } },
                message: { Text(verbatim: store.errorMessage ?? "") }
            )
            // La proposition d'activer la biométrie arrive avec le coffre, une fois le
            // déchiffrement terminé.
            .onAppear { proposerLaBiometrieSiBesoin() }
            .onChange(of: store.offersBiometricEnrollment) { _, _ in
                proposerLaBiometrieSiBesoin()
            }
        }
        .tint(Color.gpAccentText)
    }

    /// Une liaison qui écrit en retour : fermer l'alerte efface le message qu'elle
    /// portait, plutôt que de laisser SwiftUI la croire encore présentée.
    /// L'alerte d'erreur de cet écran — et seulement de cet écran.
    ///
    /// Elle se tait tant qu'une feuille est présentée. Sans cette condition, une erreur
    /// survenue *dans* une feuille — le second facteur qui interroge le serveur, un partage
    /// refusé, une équipe injoignable — fait présenter l'alerte par le parent, et SwiftUI
    /// referme la feuille pour y parvenir. L'utilisateur se retrouve brutalement rendu au
    /// coffre, sans avoir rien lu.
    ///
    /// Chaque feuille affiche déjà `store.errorMessage` en ligne, à l'endroit du geste qui
    /// a échoué. C'est là que le message a du sens.
    private var erreurAffichee: Binding<Bool> {
        Binding(
            get: { store.errorMessage != nil && sheet == nil && aOuvrir == nil },
            set: { presente in
                if !presente { store.errorMessage = nil }
            })
    }

    /// Les favoris, tant qu'aucun filtre ne restreint déjà la liste.
    private var favoris: [VaultEntry] {
        guard filtre.estTout, search.isEmpty else { return [] }
        return store.favoriteEntries
    }

    /// Une ligne du coffre. Un lien en bonne et due forme : masquer le `NavigationLink`
    /// sous une opacité nulle le rendrait inatteignable, au clavier comme au doigt. Le
    /// chevron du système fait donc l'affaire.
    /// Peut-on supprimer cet élément ?
    ///
    /// Toujours dans le coffre personnel. Dans une équipe, seulement avec le droit
    /// d'écriture — et l'absence de permission vaut refus : un serveur antérieur au
    /// champ `permission` ne l'envoie pas, et mieux vaut cacher une action permise qu'en
    /// promettre une qui échouera.
    private func peutSupprimer(_ entry: VaultEntry) -> Bool {
        entry.origine.appartenance.map(\.peutEcrire) ?? true
    }

    /// Demande confirmation avant de supprimer — ou supprime directement.
    ///
    /// La différence n'est pas cosmétique : le coffre personnel fait une suppression
    /// douce, l'élément part à la corbeille et se restaure. **Une collection d'équipe n'a
    /// pas de corbeille** : la suppression y est définitive, et elle l'est pour tous les
    /// membres. Le geste était pourtant le même — un balayage, sans un mot.
    private func demanderLaSuppression(_ entry: VaultEntry) {
        if entry.origine.appartenance != nil {
            aSupprimerDefinitivement = entry
        } else {
            Task { await store.delete(entry) }
        }
    }

    private func ligne(_ entry: VaultEntry) -> some View {
        NavigationLink(value: entry) {
            VaultRow(
                entry: entry, favori: store.isFavorite(entry),
                couleurs: store.couleursDEquipe)
        }
        .swipeActions(edge: .leading) {
            Button(store.isFavorite(entry) ? "Retirer des favoris" : "Mettre en favori") {
                Task { await store.toggleFavorite(entry) }
            }
            .tint(Color.gpAccent)
        }
        .swipeActions {
            // Le droit d'écrire commande la suppression : un membre en lecture seule
            // recevait un 403 d'un bouton que l'interface venait de lui tendre. Une action
            // cachée vaut mieux qu'une action promise qui échoue — et l'absence de
            // permission vaut refus, pour qu'un serveur plus ancien ne l'ouvre pas.
            if peutSupprimer(entry) {
                Button("Supprimer", role: .destructive) { demanderLaSuppression(entry) }
                    // La teinte de l'écran, posée plus haut pour colorer la navigation,
                    // **écrase le rouge** que SwiftUI donne au rôle destructif : le bouton
                    // de balayage s'affichait en bleu, comme n'importe quelle action.
                    //
                    // Le rôle ne suffit donc pas dès qu'une teinte est en vigueur, et rien
                    // dans le code ne le laisse voir — il faut regarder l'écran. C'est le
                    // deuxième endroit aujourd'hui où un style d'ensemble a effacé la
                    // couleur d'un danger.
                    .tint(Color.gpDanger)
            }
        }
        // Sur un téléphone, la raison d'ouvrir un identifiant est le plus souvent de le
        // recopier. L'appui long l'offre depuis la liste, sans traverser deux écrans.
        .contextMenu {
            if let login = entry.login {
                if !login.password.isEmpty {
                    Button("Copier le mot de passe", systemImage: "key") {
                        Clipboard.copy(login.password)
                    }
                }
                if !login.username.isEmpty {
                    Button("Copier le nom d'utilisateur", systemImage: "person") {
                        Clipboard.copy(login.username)
                    }
                }
                if let config = login.totp.flatMap(Totp.parse),
                    let otp = Totp.code(for: config)
                {
                    Button("Copier le code", systemImage: "number") {
                        Clipboard.copy(otp.code)
                    }
                }
            }
            Button(
                store.isFavorite(entry) ? "Retirer des favoris" : "Mettre en favori",
                systemImage: store.isFavorite(entry) ? "star.slash" : "star"
            ) {
                Task { await store.toggleFavorite(entry) }
            }
            if peutSupprimer(entry) {
                Button("Supprimer", systemImage: "trash", role: .destructive) {
                    demanderLaSuppression(entry)
                }
            }
        }
    }

    /// Prend le lien retenu, l'affiche, et le retire. Le retirer importe : sans cela il
    /// rouvrirait le formulaire à chaque retour sur la liste.
    private func consommerLeLienEnAttente() {
        guard let uri = store.lienDeTotpEnAttente else { return }
        store.lienDeTotpEnAttente = nil
        sheet = .lienDeTotp(uri)
    }

    private func ouvrirLElementDemande() {
        guard let entry = aOuvrir else { return }
        aOuvrir = nil
        chemin = [entry]
    }

    /// N'ouvre la feuille que si rien d'autre n'est déjà présenté : deux feuilles qui se
    /// succèdent trop vite s'annulent, et l'utilisateur se retrouve devant rien.
    private func proposerLaBiometrieSiBesoin() {
        guard store.offersBiometricEnrollment, sheet == nil else { return }
        sheet = .biometricOffer
    }

    private var iconeDuFiltre: String {
        switch filtre {
        case .tout: return "tray.full"
        case .personnel: return "person.crop.square"
        case .dossier: return "folder.fill"
        case .collection: return "person.2.fill"
        }
    }

    /// Le filtre courant, toujours visible : un dossier ou une collection sélectionnés
    /// qu'on aurait oubliés donneraient l'impression d'un coffre amputé.
    private var filtreDeDossier: some View {
        Button {
            sheet = .folders
        } label: {
            HStack(spacing: 8) {
                Image(systemName: iconeDuFiltre)
                    .font(.system(size: 13, weight: .medium))
                Group {
                    switch filtre {
                    case .tout: Text("Tous les éléments")
                    case .personnel: Text("Personnel")
                    case .dossier(let chemin): Text(verbatim: chemin)
                    case .collection(_, _, let nom): Text(verbatim: nom)
                    }
                }
                .font(.subheadline.weight(.medium))
                .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .semibold))
                Spacer(minLength: 4)
                Text("\(visible.count)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Color.gpMuted)
            }
            .foregroundStyle(filtre.estTout ? Color.gpMuted : Color.gpAccentText)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(
                filtre.estTout ? Color.gpSurface2 : Color.gpAccent.opacity(0.16),
                in: RoundedRectangle(cornerRadius: GP.radius)
            )
            .overlay(
                RoundedRectangle(cornerRadius: GP.radius)
                    .strokeBorder(
                        filtre.estTout ? Color.gpBorder : Color.gpAccent, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("button.folderFilter")
    }

    private var bandeauHorsLigne: some View {
        Label("Hors ligne — coffre affiché depuis cet appareil", systemImage: "wifi.slash")
            .font(.footnote)
            .foregroundStyle(Color.gpMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Color.gpSurface2, in: RoundedRectangle(cornerRadius: GP.radius))
            .accessibilityIdentifier("banner.offline")
    }

    private var coffreVide: some View {
        ContentUnavailableView {
            Label("Coffre vide", systemImage: "lock")
        } description: {
            Text("Ajoutez un identifiant avec le bouton +.")
        }
        .foregroundStyle(Color.gpMuted)
    }

    private var aucunResultat: some View {
        ContentUnavailableView.search(text: search)
            .foregroundStyle(Color.gpMuted)
    }
}

/// Ce que la liste peut présenter par-dessus elle.
enum VaultSheet: Identifiable {
    case newItem
    /// Un lien `otpauth://` ouvert depuis l'extérieur — un QR code photographié par
    /// l'appareil, un lien touché dans un courriel.
    case lienDeTotp(String)
    case editItem(VaultEntry)
    case biometrics
    case trash
    case folders
    case settings
    case biometricOffer
    case health
    case recoveryKey
    case importCSV
    case exportCSV
    case emergency
    case organizations
    case send
    case mfa
    case activity

    var id: String {
        switch self {
        case .newItem: return "new"
        case .lienDeTotp(let uri): return "lien:" + uri
        case .editItem(let entry): return entry.id
        case .biometrics: return "biometrics"
        case .trash: return "trash"
        case .folders: return "folders"
        case .settings: return "settings"
        case .biometricOffer: return "biometricOffer"
        case .health: return "health"
        case .recoveryKey: return "recoveryKey"
        case .emergency: return "emergency"
        case .organizations: return "organizations"
        case .send: return "send"
        case .mfa: return "mfa"
        case .activity: return "activity"
        case .importCSV: return "import"
        case .exportCSV: return "export"
        }
    }
}

/// Cible d'édition : soit un item existant, soit une création.
enum EditTarget: Identifiable {
    case new
    case existing(VaultEntry)
    /// Un élément neuf, pré-rempli depuis un lien `otpauth://` que le système nous a
    /// confié. Distinct de `.new` : l'identité doit changer avec le lien, sinon SwiftUI
    /// réutiliserait la feuille déjà affichée et le second lien n'arriverait jamais.
    case nouveauDepuisUnLien(String)

    var id: String {
        switch self {
        case .new: return "new"
        case .existing(let entry): return entry.id
        case .nouveauDepuisUnLien(let uri): return "lien:" + uri
        }
    }

    /// Cet élément existe-t-il déjà ?
    ///
    /// C'est cette question, et non « est-ce le cas `.new` ? », qui gouverne le titre de
    /// l'écran et le bouton d'enregistrement. La formuler par la négative — tout ce qui
    /// n'est pas `.existing` est neuf — fait que le prochain cas ajouté sera correct par
    /// défaut. La version positive ne l'était pas : `.nouveauDepuisUnLien` s'est affiché
    /// « Modifier », et disait ainsi qu'on corrigeait un élément qui n'existait pas.
    var estNeuf: Bool {
        if case .existing = self { return false }
        return true
    }
}

/// Une ligne du coffre : une pastille de type, le nom, ce qui aide à le reconnaître.
private struct VaultRow: View {
    let entry: VaultEntry
    var favori = false
    /// Passées plutôt qu'observées : cette ligne est reconstruite pour chaque élément, et
    /// lui donner tout le magasin la ferait redessiner à chaque changement qui ne la
    /// concerne pas.
    var couleurs: [String: String] = [:]

    var body: some View {
        HStack(spacing: 14) {
            // Un identifiant se reconnaît à son logo bien avant son nom ; une note ou une
            // carte n'en a pas, et garde son pictogramme.
            if case .login(let login) = entry.item.data {
                SiteIcon(nom: entry.item.name, adresse: login.uris.first)
            } else {
                ZStack {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color.gpAccent.opacity(0.16))
                    Image(systemName: icon)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Color.gpAccentText)
                }
                .frame(width: 38, height: 38)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: entry.item.name)
                    .font(.system(.body, weight: .medium))
                    .foregroundStyle(Color.gpInk)
                    .lineLimit(1)
                if let subtitle, !subtitle.isEmpty {
                    Text(verbatim: subtitle)
                        .font(.caption)
                        .foregroundStyle(Color.gpMuted)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 8)

            // Un élément d'équipe se distingue de ce qui n'appartient qu'à soi : le
            // modifier touche tout le monde, le supprimer aussi. La pastille porte le nom
            // de l'équipe plutôt qu'une icône seule — savoir *laquelle* compte dès qu'on
            // appartient à deux.
            if let etiquette = entry.origine.etiquette {
                // La couleur distingue les équipes entre elles. Elle est attribuée d'office
                // à partir de l'identifiant — trois équipes toutes bleues n'apprennent rien
                // de plus qu'aucune pastille — et se personnalise dans l'écran des équipes.
                let teinte =
                    entry.origine.appartenance.map {
                        CouleurDEquipe.couleur(de: $0.organisation, choisies: couleurs)
                    } ?? Color.gpAccentText
                Label {
                    Text(verbatim: etiquette).lineLimit(1)
                } icon: {
                    Image(systemName: "person.2.fill")
                }
                .font(.caption2.weight(.medium))
                .foregroundStyle(teinte)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(teinte.opacity(0.16), in: Capsule())
                .layoutPriority(-1)
            }

            if favori {
                Image(systemName: "star.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.gpAccentText)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(Color.gpSurface.opacity(0.7), in: RoundedRectangle(cornerRadius: GP.radius))
        .overlay(
            RoundedRectangle(cornerRadius: GP.radius)
                .strokeBorder(Color.gpBorder, lineWidth: 1))
    }

    private var icon: String {
        switch entry.item.data {
        case .login: return "person.badge.key"
        case .secureNote: return "note.text"
        case .card: return "creditcard"
        }
    }

    private var subtitle: String? {
        switch entry.item.data {
        case .login(let login): return login.username
        case .secureNote: return "Note sécurisée"
        case .card(let card): return card.cardholder
        }
    }
}
