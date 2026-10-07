import type { View } from "@/lib/queues";
import { computeSignature, type SignaturePlayer } from "@/lib/signature";
import { getSignatureBaseline } from "@/server/signature-baseline";
import { PlayerSignature } from "./player-signature";

/** Streams in after the profile: a cold community baseline never delays the rest of the page. */
export async function PlayerSignatureSection({
  input,
  view,
  name,
  tier,
}: {
  input: SignaturePlayer;
  view: View;
  name: string;
  tier: string | null;
}) {
  const baseline = await getSignatureBaseline(view);
  const { featured, others } = computeSignature(input, baseline);
  return (
    <PlayerSignature
      name={name}
      tier={tier}
      featured={featured}
      others={others}
      communityBaseline={baseline !== null}
    />
  );
}

export function PlayerSignatureSkeleton({ name }: { name: string }) {
  return (
    <section className="signature" aria-busy="true" aria-labelledby="signature-heading">
      <div className="section-heading">
        <h2 id="signature-heading">Firma de {name}</h2>
      </div>
      <span className="sr-only">Calculando la firma…</span>
      <div className="signature-cards" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton" style={{ height: 196 }} />
        ))}
      </div>
    </section>
  );
}
