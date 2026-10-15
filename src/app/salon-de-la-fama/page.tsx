import type { Metadata } from "next";
import { parseView } from "@/lib/queues";
import { HallOfFame } from "@/components/hall-of-fame/hall-of-fame";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Salón de la Fama",
  description:
    "Propuestas de legado comunitario y ejemplos ficticios; sin acreditación real activa.",
};
export default async function HallPage({
  searchParams,
}: {
  searchParams: Promise<{ queue?: string }>;
}) {
  const { queue } = await searchParams;
  return <HallOfFame view={parseView(queue)} />;
}
