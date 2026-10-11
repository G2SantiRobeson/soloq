import { Suspense } from "react";
import { Radar } from "lucide-react";
import type { View } from "@/lib/queues";
import type { ChampionCatalog } from "@/lib/champion-assets";
import { achievementsExperimentalEnabled } from "@/server/achievements/feature";
import {
  profileAchievementPresentation,
  type ProfileAchievementLoader,
} from "@/server/achievements/profile";
import { AchievementPanel } from "./achievement-panel";
import { observedOtp, OtpHighlight } from "./otp-highlight";
import { DisclosureLabel } from "@/components/disclosure";
import styles from "./achievements.module.css";

type Props = {
  playerId: string;
  view: View;
  asOf: string;
  champions: ChampionCatalog;
  /** Shared with the OTP badge so both read one evaluation. */
  load?: ProfileAchievementLoader;
};

export async function ProfileAchievementsContent(props: Props) {
  const presentation = props.load
    ? await props.load()
    : await profileAchievementPresentation(props.playerId, props.view, props.asOf, props.champions);
  return presentation ? (
    <AchievementPanel presentation={presentation} champions={props.champions} />
  ) : null;
}

/** Native collapsed disclosure: streaming does not push essential information down. */
export function ProfileAchievements(props: Props) {
  if (!achievementsExperimentalEnabled() || props.view === "5v5") return null;
  return (
    <details className={`disclosure disclosure-block profile-disclosure ${styles.profile}`}>
      <summary>
        <DisclosureLabel
          icon={<Radar size={18} />}
          title="Señales competitivas"
          badge="Experimental"
          hint="Observaciones y evidencia · sin concesiones permanentes"
        />
      </summary>
      <Suspense
        fallback={
          <p role="status" aria-busy="true">
            Leyendo evidencia registrada…
          </p>
        }
      >
        <ProfileAchievementsContent {...props} />
      </Suspense>
    </details>
  );
}

export async function ProfileOtpHighlightContent({
  load,
  champions,
}: {
  load: ProfileAchievementLoader;
  champions: ChampionCatalog;
}) {
  const presentation = await load();
  const otp = observedOtp(presentation);
  return otp && presentation?.status === "available" ? (
    <OtpHighlight otp={otp} champions={champions} demo={presentation.demo} />
  ) : null;
}

/** Same gate as the signals panel: no work with the flag off or in 5v5. */
export function ProfileOtpHighlight(props: {
  view: View;
  load: ProfileAchievementLoader;
  champions: ChampionCatalog;
}) {
  if (!achievementsExperimentalEnabled() || props.view === "5v5") return null;
  return (
    <Suspense fallback={null}>
      <ProfileOtpHighlightContent load={props.load} champions={props.champions} />
    </Suspense>
  );
}
