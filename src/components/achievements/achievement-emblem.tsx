import { Flame, RotateCcw, Target } from "lucide-react";
import type { AchievementCode } from "@/lib/achievements/types";
import styles from "./experience.module.css";
/** Temporary code-native emblem slot; a future original asset can replace its icon. */
export function AchievementEmblem({
  code,
  compact = false,
}: {
  code: AchievementCode;
  compact?: boolean;
}) {
  const Icon = { resurrection: RotateCcw, unstoppable: Flame, "otp-specialist": Target }[code];
  return (
    <span className={compact ? styles.emblemCompact : styles.emblem} aria-hidden="true">
      <span className={styles.emblemFrame}>
        <Icon strokeWidth={1.5} />
      </span>
    </span>
  );
}
export const achievementArt = {
  resurrection: {
    theme: "recovery",
    motto: "Vuelve más fuerte",
    description: "Recupera el nivel de LP que perdiste tras una caída registrada.",
  },
  unstoppable: {
    theme: "streak",
    motto: "Que no te frenen",
    description: "Encadena victorias y deja una racha que hable por ti.",
  },
  "otp-specialist": {
    theme: "mastery",
    motto: "Un campeón. Tu sello.",
    description: "Haz de un campeón el protagonista de tu muestra de partidas.",
  },
} as const;
