import { readFileSync, mkdirSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

/** Mirrors root font variables and the installed CSS pipeline without importing Next's layout. */
export async function writeBackfillVisualDocument(target: string, markup: string) {
  const fonts = [
    { file: "Barlow-Regular.ttf", family: "Barlow", weight: 400 },
    { file: "Barlow-SemiBold.ttf", family: "Barlow", weight: 600 },
    { file: "BarlowCondensed-SemiBold.ttf", family: "Barlow Condensed", weight: 600 },
  ];
  const layout = readFileSync("src/app/layout.tsx", "utf8");
  for (const font of fonts) {
    if (!layout.includes(`./fonts/${font.file}`))
      throw new Error("QA font mapping differs from root layout");
  }
  if (!layout.includes('variable: "--font-body"') || !layout.includes('variable: "--font-display"'))
    throw new Error("QA font variables differ from root layout");
  const source = resolve("src/app/globals.css");
  const css = await postcss([tailwind()]).process(readFileSync(source, "utf8"), { from: source });
  mkdirSync(join(target, "fonts"), { recursive: true });
  for (const font of fonts)
    copyFileSync(join("src/app/fonts", font.file), join(target, "fonts", font.file));
  const fontCss = fonts
    .map(
      (font) =>
        `@font-face{font-family:"${font.family}";font-style:normal;font-weight:${font.weight};font-display:swap;src:url("fonts/${font.file}") format("truetype")}`,
    )
    .join("\n");
  const axe = existsSync("node_modules/axe-core/axe.min.js");
  if (axe) copyFileSync("node_modules/axe-core/axe.min.js", join(target, "axe.min.js"));
  writeFileSync(
    join(target, "backfill.html"),
    `<!doctype html><html lang="es" class="qa-root-fonts"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SoloQ · QA ficticio de backfill</title><style>${fontCss}\n.qa-root-fonts{--font-body:"Barlow";--font-display:"Barlow Condensed"}\n${css.css}</style>${axe ? '<script src="axe.min.js"></script>' : ""}</head><body>${markup}${axe ? '<pre id="qa-audit" style="white-space:pre-wrap;overflow-wrap:anywhere">Evaluando…</pre><script>document.fonts.ready.then(()=>axe.run(document.querySelector("main"),{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}})).then(r=>{document.getElementById("qa-audit").textContent=JSON.stringify({violations:r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length})),passes:r.passes.length,incomplete:r.incomplete.map(v=>v.id)})})</script>' : ""}</body></html>`,
  );
}
