"use client";

// Le menu de tri de la liste : un critère et un sens, chacun coché.

import { useI18n } from "@/lib/i18n";
import { CRITERES, sensNaturel, type Ordre, type Sens } from "@/lib/vault";
import { Tri } from "@/components/Icones";
import { MenuChoix } from "@/components/MenuChoix";

const LIBELLE_CRITERE = { nom: "app.sortName", modification: "app.sortModified" } as const;
const LIBELLE_SENS = {
  nom: { asc: "app.sortAZ", desc: "app.sortZA" },
  modification: { desc: "app.sortNewest", asc: "app.sortOldest" },
} as const;

export function MenuTri({ ordre, onOrdre }: { ordre: Ordre; onOrdre: (o: Ordre) => void }) {
  const { t } = useI18n();
  return (
    <MenuChoix
      icone={<Tri className="size-3.5" />}
      valeur={t(LIBELLE_CRITERE[ordre.critere])}
      nom={t("app.sortBy")}
      groupes={[
        {
          titre: t("app.sortBy"),
          options: CRITERES.map((c) => ({
            libelle: t(LIBELLE_CRITERE[c]),
            coche: ordre.critere === c,
            agir: () => onOrdre(c === ordre.critere ? ordre : { critere: c, sens: sensNaturel(c) }),
          })),
        },
        {
          titre: t("app.sortOrder"),
          options: (Object.keys(LIBELLE_SENS[ordre.critere]) as Sens[]).map((s) => ({
            libelle: t(LIBELLE_SENS[ordre.critere][s]),
            coche: ordre.sens === s,
            agir: () => onOrdre({ critere: ordre.critere, sens: s }),
          })),
        },
      ]}
    />
  );
}
