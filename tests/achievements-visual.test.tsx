import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AchievementPanel } from "@/components/achievements/achievement-panel";
import { AchievementTitlePreview } from "@/components/achievements/title-preview";
import styles from "@/components/achievements/achievements.module.css";
import { uiFixture, uiPresentation, uiStateFixture } from "./achievements-ui-fixtures";

/** Opt-in isolated visual artifact; never creates a Next route or accesses a database. */
it("renders isolated fictional visual states (optional HTML export)", async () => {
  const result = await uiFixture();
  const markup = renderToStaticMarkup(
    <main>
      <h1>SoloQ · Logros experimentales</h1>
      <p>Previsualización local aislada. Evidencia ficticia; sin concesiones.</p>
      <AchievementTitlePreview title="Resurgente" />
      <AchievementPanel
        presentation={uiPresentation(result)}
        future={[
          {
            key: "future",
            name: "Concepto futuro",
            description: "No disponible; pendiente de criterios aprobados.",
          },
        ]}
      />
      <AchievementPanel
        presentation={uiPresentation(await uiStateFixture("insufficient_evidence"))}
      />
      <AchievementPanel
        presentation={uiPresentation(await uiStateFixture("not_observed", "flex"))}
      />
      <AchievementPanel presentation={uiPresentation(await uiStateFixture("invalid_input"))} />
    </main>,
  );
  expect(markup).toContain("Datos insuficientes");
  const target = process.env.ACHIEVEMENT_VISUAL_DIR;
  if (!target) return;
  const tokens = readFileSync("src/app/globals.css", "utf8").match(/:root\s*\{([\s\S]*?)\n\}/)![0];
  let css = readFileSync("src/components/achievements/achievements.module.css", "utf8");
  // Vitest's CSS-module proxy exposes properties but not enumerable entries.
  const classes = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => match[1]));
  for (const key of classes)
    css = css.replace(new RegExp(`\\.${key}(?![\\w-])`, "g"), `.${styles[key]}`);
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SoloQ · QA ficticio de logros</title><style>${tokens}*{box-sizing:border-box}body{background:var(--bg);color:var(--text);font:15px/1.5 Arial,sans-serif;margin:0}main{max-width:1120px;margin:auto;padding:16px;overflow-wrap:anywhere}h1{font-size:24px}section{margin-top:24px}${css}</style></head><body>${markup}</body></html>`;
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "achievements.html"), html);
  // Optional browser accessibility audit using the already installed transitive tool.
  // The application and no-JS fixture never import this script.
  if (existsSync("node_modules/axe-core/axe.min.js")) {
    writeFileSync(join(target, "axe.min.js"), readFileSync("node_modules/axe-core/axe.min.js"));
    writeFileSync(
      join(target, "accessibility.html"),
      html
        .replace("</head>", '<script src="axe.min.js"></script></head>')
        .replace(
          "</body>",
          '<pre id="qa-audit" aria-label="Resultado auditoría QA">Evaluando…</pre><script>axe.run(document.querySelector("main"),{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}}).then(r=>{document.getElementById("qa-audit").textContent=JSON.stringify({violations:r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length})),passes:r.passes.length,incomplete:r.incomplete.map(v=>v.id)},null,2)})</script></body>',
        ),
    );
  }
  // Same components and styles in width-constrained frames; no emulation claim.
  writeFileSync(
    join(target, "responsive.html"),
    `<!doctype html><html lang="es"><meta charset="utf-8"><title>SoloQ · tamaños QA</title><style>body{background:#070b18;color:#eef2ff;font:16px Arial}iframe{display:block;border:1px solid #62759f;margin-bottom:24px}</style><h1>Componentes ficticios · tamaños de viewport</h1>${[1440, 1024, 768, 390, 375, 320].map((width) => `<h2>${width} px</h2><iframe title="Logros a ${width} px" width="${width}" height="760" src="achievements.html"></iframe>`).join("")}</html>`,
  );
});
