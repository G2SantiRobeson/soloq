import type { AchievementPresentation } from "@/lib/achievements/presentation";
import { championAsset, type ChampionCatalog } from "@/lib/champion-assets";
import { Avatar } from "@/components/avatar";
import styles from "./achievements.module.css";

export type OtpSpecialization = NonNullable<
  Extract<AchievementPresentation, { status: "available" }>["items"][number]["specialization"]
>;

/** Only an observed OTP evaluation yields a badge; any other state shows nothing. */
export function observedOtp(
  presentation: AchievementPresentation | null,
): OtpSpecialization | null {
  if (presentation?.status !== "available") return null;
  const item = presentation.items.find((i) => i.code === "otp-specialist");
  return item?.status === "observed" ? item.specialization : null;
}

/** Concentration within the imported sample: provisional, never a certification or a grant. */
export function OtpHighlight({
  otp,
  champions,
  demo,
}: {
  otp: OtpSpecialization;
  champions: ChampionCatalog;
  demo: boolean;
}) {
  const asset = championAsset(otp.championId, otp.champion, champions);
  return (
    <aside className={styles.otp} aria-label={`Especialización observada: OTP de ${asset.name}`}>
      <Avatar decorative champion {...asset} size={48} />
      <p className={styles.otpTitle}>
        <span className={styles.otpBadge}>OTP</span> {asset.name}
      </p>
      <p className={styles.otpFigures}>
        <strong>{otp.games}</strong> de {otp.sample} partidas importadas ·{" "}
        <strong>{otp.share} %</strong> de la muestra
      </p>
      <span className={styles.otpMeter} aria-hidden="true">
        <span style={{ width: `${(100 * otp.games) / otp.sample}%` }} />
      </span>
      <p className={styles.otpNote}>
        Experimental · concentración observada en la muestra
        {demo ? " ficticia de demo" : " importada"}, no certificación. Evidencia en Señales
        competitivas.
      </p>
    </aside>
  );
}
