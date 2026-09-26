/// Ce que la carte « Double authentification » doit proposer.
///
/// Trois états et non deux, parce que la lecture peut échouer — `mfaStatus`
/// a son propre `.catch`. `null` veut dire « je n'ai pas pu regarder », et
/// dans ce cas on ne propose RIEN : affirmer que le second facteur est
/// inactif sans l'avoir lu est précisément ce qui trompait.
export type ActionSecondFacteur = "activer" | "desactiver" | null;

/// La condition vivait en ligne dans le JSX de `Securite.tsx`, et elle ne
/// consultait pas l'état du tout : le bouton « Activer la 2FA » s'affichait
/// toujours. Il restait donc là après une activation réussie, juste à côté du
/// décompte « 10 codes de récupération restants sur 10 » qui prouvait le
/// contraire — deux moitiés du même panneau qui se contredisaient.
///
/// Extraite ici pour qu'un test puisse la tenir. Une condition dans du JSX
/// n'est éprouvable que par un rendu complet, et c'est ce qui l'avait laissée
/// fausse.
export function actionSecondFacteur(actif: boolean | null): ActionSecondFacteur {
  if (actif === null) return null;
  return actif ? "desactiver" : "activer";
}
