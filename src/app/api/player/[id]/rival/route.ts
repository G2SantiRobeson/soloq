/**
 * Legacy public shared-preference endpoint, retained for backwards compatibility.
 * F5.R8 retires its writes in all modes. Existing records are neither read nor removed.
 */
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  void request;
  void context;
  return Response.json(
    {
      error:
        "La selección ahora es una preferencia local del navegador. Este endpoint ya no admite escrituras compartidas.",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
