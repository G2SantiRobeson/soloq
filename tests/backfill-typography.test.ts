import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, basename } from "node:path";
import { expect, it } from "vitest";
import { writeBackfillVisualDocument } from "./backfill-visual-document";

it("exports the root font variables, identical local font files and compiled global CSS", async () => {
  const directory = mkdtempSync(join(tmpdir(), "soloq-backfill-font-"));
  try {
    await writeBackfillVisualDocument(
      directory,
      "<main><h1>Historial</h1><button>Detener</button></main>",
    );
    const html = readFileSync(join(directory, "backfill.html"), "utf8");
    expect(html).toContain('class="qa-root-fonts"');
    expect(html).toContain('--font-body:"Barlow"');
    expect(html).toContain('--font-display:"Barlow Condensed"');
    expect(html).toContain("font-weight:400");
    expect(html).toContain("font-weight:600");
    expect(html).not.toContain('@import "tailwindcss"');
    expect(html).not.toContain("@theme inline");
    for (const file of [
      "Barlow-Regular.ttf",
      "Barlow-SemiBold.ttf",
      "BarlowCondensed-SemiBold.ttf",
    ]) {
      expect(html).toContain(`fonts/${file}`);
      expect(readFileSync(join(directory, "fonts", file))).toEqual(
        readFileSync(join("src/app/fonts", file)),
      );
    }
  } finally {
    if (
      dirname(resolve(directory)) !== resolve(tmpdir()) ||
      !basename(directory).startsWith("soloq-backfill-font-")
    )
      throw new Error("Refusing unexpected QA cleanup path");
    rmSync(directory, { recursive: true });
  }
});
