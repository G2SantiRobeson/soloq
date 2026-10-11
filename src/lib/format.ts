/** Spanish count agreement for UI copy: "1 partida", "0 partidas", "2 partidas". */
export function countLabel(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
