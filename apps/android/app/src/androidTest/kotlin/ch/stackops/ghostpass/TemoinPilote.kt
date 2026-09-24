package ch.stackops.ghostpass

/**
 * Marque un test qui **ne se suffit pas à lui-même** : un script doit le piloter.
 *
 * Le cas est celui d'[InvalidationDeLaCleTest], dont les deux moitiés encadrent un
 * enrôlement d'empreinte qu'aucun test ne peut provoquer. Lancées d'affilée par
 * `connectedAndroidTest`, elles seraient rouges — non parce que le produit est cassé, mais
 * parce qu'il ne s'est rien passé entre les deux.
 *
 * Un tableau rouge qu'on apprend à ignorer est pire qu'un test absent : il finit par
 * masquer le rouge qui compte. `build.gradle.kts` les exclut donc de l'exécution ordinaire,
 * et `tools/android/temoin-de-l-invalidation.sh` les nomme explicitement.
 *
 * L'exclusion est faite par **annotation** et non par nom de classe : un test ajouté demain
 * au même besoin la portera et sera exclu du même coup, là où une liste de noms se serait
 * périmée en silence.
 */
@Retention(AnnotationRetention.RUNTIME)
@Target(AnnotationTarget.CLASS, AnnotationTarget.FUNCTION)
annotation class TemoinPilote
