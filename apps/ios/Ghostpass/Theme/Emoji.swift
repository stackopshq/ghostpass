import CoreText
import UIKit

/// Un emoji que le système ne sait peut-être pas dessiner.
///
/// Le coffre au trésor — `U+1FA8E` — vient d'Emoji 17, livré avec iOS 26. La cible
/// minimale de l'application est iOS 17 : sur un appareil plus ancien, la police n'a pas
/// ce glyphe et l'affiche en **carré vide**, en plein milieu du titre de l'écran
/// principal. Un ornement qui devient une case blanche est pire que pas d'ornement.
///
/// On demande donc à la police si elle sait le dessiner, plutôt que de le supposer.
enum Emoji {
    /// Le coffre du titre, ou rien si le système ne le connaît pas.
    static let coffre: String = disponible("\u{1FA8E}") ? "\u{1FA8E}" : ""

    /// La police emoji du système sait-elle dessiner ce caractère ?
    ///
    /// Trois pièges, découverts l'un après l'autre :
    ///
    /// 1. `CTFontGetGlyphsForCharacters` ne traite pas les caractères hors du plan de
    ///    base. Le coffre s'écrit sur **deux** unités UTF-16 et cette API échoue dessus,
    ///    en rendant « absent » pour un caractère que la police connaît.
    /// 2. N'inspecter que la première des deux unités donne l'erreur inverse — un
    ///    « présent » pour un caractère absent. Les deux se ressemblent dans le code et
    ///    se contredisent à l'écran.
    /// 3. Composer une ligne ne suffit pas non plus : CoreText **remplace** la police
    ///    quand elle ne couvre pas le caractère, et rend un glyphe malgré tout. C'est
    ///    précisément le carré vide qu'on cherchait à éviter.
    ///
    /// D'où cette forme : on compose, puis on vérifie que le glyphe vient bien de la
    /// police demandée et non d'un repli.
    static func disponible(_ caractere: String) -> Bool {
        let demandee = CTFontCreateWithName("AppleColorEmoji" as CFString, 12, nil)
        let attendu = CTFontCopyPostScriptName(demandee) as String
        let ligne = CTLineCreateWithAttributedString(
            NSAttributedString(string: caractere, attributes: [.font: demandee]))
        guard let passages = CTLineGetGlyphRuns(ligne) as? [CTRun], let passage = passages.first
        else { return false }
        let attributs = CTRunGetAttributes(passage) as NSDictionary
        guard let brute = attributs[kCTFontAttributeName as String] else { return false }
        let utilisee = brute as! CTFont
        return (CTFontCopyPostScriptName(utilisee) as String) == attendu
    }
}
