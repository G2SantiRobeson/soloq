// Use Riot's explicit early-surrender marker; duration alone cannot identify a remake.
export function isRemake(match: {
  info: { participants: { gameEndedInEarlySurrender?: boolean }[] };
}) {
  return match.info.participants.some((p) => p.gameEndedInEarlySurrender === true);
}
export function matchOutcome(match: { win: boolean; isRemake?: boolean | null }) {
  return match.isRemake ? "Remake" : match.win ? "Victoria" : "Derrota";
}
