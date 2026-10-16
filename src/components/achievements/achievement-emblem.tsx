import Image from "next/image";
import type { AchievementCode } from "@/lib/achievements/types";
import type { AchievementDisplay } from "@/lib/achievements/presentation";
import { championAsset } from "@/lib/champion-assets";
import styles from "./experience.module.css";

/** Original artwork only: evaluation states and experimental labels remain outside the emblem. */
export function AchievementEmblem({
  code,
  compact = false,
  specialization,
}: {
  code: AchievementCode;
  compact?: boolean;
  /** Pass only the specialization from an observed OTP evaluation, never profile aggregates. */
  specialization?: AchievementDisplay["specialization"];
}) {
  // An empty catalog deliberately limits portraits to existing local champion assets.
  const portrait =
    code === "otp-specialist" && specialization
      ? championAsset(specialization.championId, specialization.champion, {})
      : null;
  return (
    <span className={compact ? styles.emblemCompact : styles.emblem} aria-hidden="true">
      <span className={styles.emblemFrame}>
        {code === "otp-specialist" && (
          <span className={styles.otpPortrait}>
            {portrait?.src && (
              <Image src={portrait.src} alt="" width={128} height={128} unoptimized />
            )}
          </span>
        )}
        <Image
          className={styles.emblemArt}
          src={`/achievements/catalog/${code}.webp`}
          alt=""
          width={768}
          height={768}
          sizes={compact ? "72px" : "(max-width: 700px) 80px, (max-width: 1100px) 96px, 112px"}
        />
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
