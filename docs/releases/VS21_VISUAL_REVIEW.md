# SOLOQ — VS 2.1 VISUAL REVIEW

Estado: PASS local; pendiente de revisión visual humana. Sin commit ni publicación.
Worktree: D:/soloq-vs2 · feat/vs2-competitive-comparison.

## Cambios exclusivos de presentación

- Se conserva el encabezado enfrentado de VS 2.0, con avatares, emblemas completos, nombres, LP y VS central. El marcador continúa su superficie, sin duplicar identidades.
- Seis filas enfrentadas sustituyen la tabla estadística: winrate, KDA, rango, LP, V/D y cambio semanal. Los valores siguen procediendo de los comparadores existentes. Solo winrate recibe barras independientes de 0–100 %, sin puntaje, normalización conjunta ni predicción.
- Muestras visibles junto a WR/KDA; procedencia y limitación de cobertura visibles. El detalle completo de fuentes, cobertura, límites e intervalos queda en un disclosure nativo, cerrado inicialmente y accesible por teclado.
- Forma reciente en dos lados, hasta cinco partidas originales por jugador, reutilizando retratos, resultados y tooltips existentes; no se afirma que jugaran entre sí.
- Momento competitivo destacado: líder anterior → líder del corte posterior observado. La ventaja actual queda separada. Se conserva el desplegable histórico original; los estados sin evidencia siguen siendo neutrales.
- CSS Modules con tokens RC3 existentes y sin nuevas dependencias, assets, animaciones, gradientes o glow. Las dos mitades se mantienen visibles también en 320 px; la forma puede organizar sus cinco retratos en dos líneas.

Archivos de esta revisión:
- src/components/versus-comparison.tsx
- src/components/versus.module.css
- src/components/rivalry-leadership.tsx: prop de presentación showSummary, true por defecto; sin cambios en detector, observaciones ni timeline.
- tests/versus-visual.test.tsx: siete casos nuevos.
- docs/releases/VS21_VISUAL_REVIEW.md

Los demás cambios sin commit de VS 2.0 se conservan. Diez hashes funcionales previos coinciden exactamente (artifacts/vs21/protected-before.json). Backend, auth, seguridad, Drizzle, assets, dependencias y configuración no difieren de HEAD. No se modificaron otros worktrees ni P4.4.D.

## Validaciones

- Lint: PASS.
- Typecheck: PASS.
- Tests ordinarios completos: 1775 PASS, 0 fallos, 40 PostgreSQL opt-in omitidos; no se certifican como aprobados.
- Build Demo: PASS (Next 16.3.8 / Node 24.19.0).
- 40 comprobaciones Chrome locales: PASS, sin overflow, errores JS, solicitudes externas ni mutaciones de red al guardar la elección del navegador.
- Resoluciones verificadas: 1440, 768, 390 y 320 px. Bounding boxes de identidades, filas y forma conservan lados y alineación. Verificación de barras frente a porcentajes originales, foco visible, apertura/cierre por teclado de metodología/historial/tooltips, compartir y cambio de modalidad.
- Casos: automático, manual, Apex, sin rango, otra región, jugador ausente, Flex, selección local, rutas principales y URLs inválidas.
- Ejecución aislada, sin credenciales y con guard de red. PGlite únicamente en memoria bajo autorización existente; sin PostgreSQL operativo, Neon o Riot. Los dos archivos generados por prebuild conservaron su contenido y se restauró exclusivamente su formato original.

Evidencia: artifacts/vs21/validation.json, logs, browser.json y visual-geometry.json.

## Capturas reales y revisión

Misma ruta Demo y anchos, capturadas antes y después de modificar la presentación:
- Antes: artifacts/vs21/before/page-{1440,768,390,320}.png y scoreboard-{ancho}.png.
- Después: artifacts/vs21/after/page-{1440,768,390,320}.png y scoreboard-{ancho}.png.
- Detalles: after/form-{ancho}.png, moment-{ancho}.png, history-open-{ancho}.png y methodology-open-{ancho}.png.

Las capturas finales no alteran DOM, estilos ni datos para producir el resultado. El encuadre anterior era el contenido principal; el posterior incluye también la cabecera global. Los screenshots originales permanecen conservados.

Demo local disponible: http://127.0.0.1:3105/rivalidad/demo-4/demo-5?queue=soloq
Manual: http://127.0.0.1:3105/rivalidad/demo-1/demo-4?queue=soloq&tipo=elegida

Límites heredados: sin observaciones semanales compatibles se muestra —; sin historial suficiente no se inventa evolución. Las URLs inválidas conservan la UI 404/noindex con HTTP 200 por streaming ya documentada en VS 2.0. No se amplía alcance operacional.
