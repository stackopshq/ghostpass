import Foundation

/// Une couche réseau qui refuse une réponse trop grosse **pendant** qu'elle arrive.
///
/// `URLSession.data(for:)` ne rend la main qu'une fois la réponse entière en mémoire :
/// mesurer sa taille après coup borne le décodage, jamais le transfert. Un serveur —
/// hostile, ou simplement en panne — pouvait donc faire tuer l'application par le système
/// avant qu'une seule ligne de contrôle ne s'exécute. Le message d'erreur arrivait trop
/// tard pour exister.
///
/// Ici la réponse est lue par morceaux, et la tâche s'annule dès que le seuil est franchi.
/// Deux occasions de refuser, dans cet ordre :
///
/// 1. **À l'en-tête**, si le serveur annonce sa taille. C'est la seule qui n'a rien coûté :
///    rien du corps n'a encore été reçu.
/// 2. **En cours de réception**, sinon — un serveur peut mentir, ou ne rien annoncer du
///    tout en découpant sa réponse. On s'arrête alors au premier morceau qui dépasse, donc
///    après le seuil et non après le tout.
final class ReseauBorne: NSObject, @unchecked Sendable {
    /// 32 Mio. Mesuré : un élément de coffre chiffré pèse environ 450 octets, soit 8,5 Mo
    /// pour vingt mille éléments. La marge est d'un ordre de grandeur sur le coffre le
    /// plus lourd qu'on puisse raisonnablement migrer depuis un concurrent.
    static let limiteParDefaut = 32 * 1024 * 1024

    static let partage = ReseauBorne(limite: limiteParDefaut)

    let limite: Int

    /// Ce qu'on accumule pour une tâche en cours.
    private final class Collecte {
        var donnees = Data()
        var reponse: URLResponse?
        var suite: CheckedContinuation<(Data, URLResponse), Error>?
    }

    /// Les rappels du délégué arrivent sur la file de la session, l'attente est reprise
    /// ailleurs : le dictionnaire est touché des deux côtés, il lui faut un verrou.
    private let verrou = NSLock()
    private var collectes: [Int: Collecte] = [:]

    private let configuration: URLSessionConfiguration

    private lazy var session: URLSession = {
        let file = OperationQueue()
        // Sérialisée : deux rappels concurrents sur la même tâche n'auraient aucun sens,
        // et cela rend le raisonnement sur l'ordre des événements tenable.
        file.maxConcurrentOperationCount = 1
        return URLSession(configuration: configuration, delegate: self, delegateQueue: file)
    }()

    /// - Parameter configuration: injectable pour que les tests posent un `URLProtocol` et
    ///   fabriquent des réponses énormes sans serveur. Du code de concurrence qu'on ne
    ///   sait pas éprouver est du code dont on ne saura pas qu'il bloque.
    init(limite: Int, configuration: URLSessionConfiguration = .default) {
        self.limite = limite
        self.configuration = configuration
        super.init()
    }

    /// Même signature que `URLSession.data(for:)`, à l'annulation près.
    func donnees(pour requete: URLRequest) async throws -> (Data, URLResponse) {
        let tache = session.dataTask(with: requete)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { suite in
                let collecte = Collecte()
                collecte.suite = suite
                verrou.lock()
                collectes[tache.taskIdentifier] = collecte
                verrou.unlock()
                tache.resume()
            }
        } onCancel: {
            tache.cancel()
        }
    }

    /// Reprend l'attente **une seule fois**, en retirant la collecte du dictionnaire.
    ///
    /// C'est ce retrait qui garantit l'unicité : une tâche qu'on annule reçoit ensuite un
    /// `didCompleteWithError`, qui ne trouvera plus rien à reprendre. Reprendre deux fois
    /// une continuation fait tomber le processus, et c'est le genre de faute qui ne se
    /// manifeste que sous charge.
    private func terminer(_ identifiant: Int, _ resultat: Result<(Data, URLResponse), Error>) {
        verrou.lock()
        let collecte = collectes.removeValue(forKey: identifiant)
        verrou.unlock()
        collecte?.suite?.resume(with: resultat)
    }

    private func collecte(_ identifiant: Int) -> Collecte? {
        verrou.lock()
        defer { verrou.unlock() }
        return collectes[identifiant]
    }
}

extension ReseauBorne: URLSessionDataDelegate {
    func urlSession(
        _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        // `expectedContentLength` vaut **-1** quand le serveur ne l'annonce pas — la
        // constante `NSURLResponseUnknownLength` n'est pas exposée à Swift. Sans cette
        // garde, une réponse sans `Content-Length` serait refusée par comparaison de
        // signe : c'est-à-dire précisément les grosses réponses légitimes, servies en
        // morceaux.
        let annoncee = response.expectedContentLength
        if annoncee >= 0 && annoncee > Int64(limite) {
            terminer(dataTask.taskIdentifier, .failure(APIError.reponseTropGrande))
            completionHandler(.cancel)
            return
        }
        collecte(dataTask.taskIdentifier)?.reponse = response
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let collecte = collecte(dataTask.taskIdentifier) else { return }
        collecte.donnees.append(data)
        if collecte.donnees.count > limite {
            terminer(dataTask.taskIdentifier, .failure(APIError.reponseTropGrande))
            dataTask.cancel()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?)
    {
        guard let collecte = collecte(task.taskIdentifier) else { return }
        if let error {
            terminer(task.taskIdentifier, .failure(error))
            return
        }
        guard let reponse = collecte.reponse else {
            terminer(task.taskIdentifier, .failure(APIError.malformedResponse))
            return
        }
        terminer(task.taskIdentifier, .success((collecte.donnees, reponse)))
    }
}
