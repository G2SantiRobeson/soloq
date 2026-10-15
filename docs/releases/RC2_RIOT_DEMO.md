# SOLOQ RC2 — CANDIDATA PARA RIOT GAMES

## A. Estado general

**PASS como candidata Demo local para revisión humana. NO AUTORIZADA para publicación.** No es aprobación de Riot ni candidata para operar con datos reales.

Worktree: C:/Users/Studying/Desktop/soloq-rc2. Rama: release/rc2-riot-demo. HEAD sigue en main verificado, sin commit RC2. Consulta GitHub de solo lectura realizada en este encargo: main 635f1ae04f33d8aef894c3aaff4c723bc2e64799; staging d65c43bdc5df3c478af5871462db704d32a45aa5. Staging local protegido conserva 2dbd13a32b58676adf5e70afdbdbe0c34722b92a. No hubo fetch, push, merge, rebase ni cherry-pick.

## B. F6

Único commit creado, local y selectivo: **1b9539e7cd3d727e23bf0a2fbab1636548edb683**.
Mensaje: feat(achievements): add achievement gallery and hall of fame demo.
33 archivos, 3057 inserciones y 3 eliminaciones. Índice coincidió con manifiesto; hashes, diff completo, ausencia de secretos y git diff --cached --check comprobados; hooks no omitidos.

Validación previa reutilizada para el contenido F6 aprobado: 1436 aprobados, 69 PostgreSQL opt-in omitidos, cero fallidos; lint, typecheck, build Demo y 45 comprobaciones HTTP PASS. Manifiesto: ../soloq-logros/artifacts/rc2/f6-commit-manifest.json.

.gitattributes fue revisado e incluido: drizzle/** -text preserva bytes canónicos. No cambia SQL, schema ni journal. Las marcas M residuales de Drizzle y dos catálogos generados en F6 no representan diferencias: bytes iguales a HEAD y git diff vacío para esos archivos. next-env.d.ts sí sigue modificado y excluido. Los 33 archivos del commit conservan sus hashes.

Excluidos: next-env.d.ts, ZIP/PNG fuente, capturas, artifacts, .next, dependencias, .env, credenciales, propuestas SQL y migraciones. No se eliminaron originales.

### Archivos del commit F6

- `.gitattributes`
- `docs/logros/F63_LEGACY_PROPOSAL.md`
- `docs/logros/F6_EXPERIENCE.md`
- `public/achievements/hall-of-fame/el-intocable.webp`
- `public/achievements/hall-of-fame/el-monarca.webp`
- `public/achievements/hall-of-fame/el-primero-de-su-nombre.webp`
- `scripts/achievements-demo-network-guard.cjs`
- `scripts/dev-achievements-demo.mjs`
- `scripts/validate-production-demo.mjs`
- `src/app/globals.css`
- `src/app/logros/page.tsx`
- `src/app/player/[id]/page.tsx`
- `src/app/salon-de-la-fama/page.tsx`
- `src/components/achievements/achievement-catalog.tsx`
- `src/components/achievements/achievement-emblem.tsx`
- `src/components/achievements/achievement-showcase.tsx`
- `src/components/achievements/experience.module.css`
- `src/components/hall-of-fame/hall-of-fame.tsx`
- `src/components/hall-of-fame/hall.module.css`
- `src/components/header-nav.tsx`
- `src/lib/achievements/experience.ts`
- `src/lib/hall-of-fame/contracts.ts`
- `src/lib/hall-of-fame/emblems.ts`
- `src/lib/hall-of-fame/proposals.ts`
- `src/server/achievements/center.ts`
- `src/server/demo.ts`
- `src/server/hall-of-fame/demo.ts`
- `tests/achievements-center-demo.test.tsx`
- `tests/achievements-center.test.tsx`
- `tests/achievements-gallery.test.tsx`
- `tests/achievements-presentation.test.tsx`
- `tests/hall-emblems.test.tsx`
- `tests/hall-of-fame.test.tsx`

## C. Integración

Base de publicación: **635f1ae04f33d8aef894c3aaff4c723bc2e64799**, no staging. F5: **a41d6f37ba24e1d3e4e635db4483944bd6f9593b**. F6: **1b9539e7cd3d727e23bf0a2fbab1636548edb683**. Integración selectiva por blobs y adaptaciones revisadas; no fusión general. El inventario de promoción contiene **156 archivos**, cada uno con hash actual, hash base y procedencia en artifacts/rc2/promotion-manifest.json. El patch tracked complementario no incluye archivos nuevos; para ellos consultar el manifiesto y el archivo completo.

Se mantienen ranking SoloQ/Flex/5v5, perfiles, gráficas y métricas. Se incorporan rivalidades automáticas, semanal, tendencias, cronología, perfiles, preferencia exclusivamente local y enlaces al duelo; tres desafíos experimentales, galería/vitrinas, Salón de la Fama y tres WebP originales.

Dependencias públicas tomadas de staging local: motores puros, contratos/presentación, lector ficticio, componentes de perfil/métricas y pruebas aplicables; listado completo abajo. Ninguna dependencia npm nueva: package.json/package-lock.json iguales a main. Node 24.19.0; dependencias locales copiadas sin descargar paquetes.

Conflictos resueltos:
- Navegación de cinco destinos conserva filtros F5 y añade Logros/Salón F6, bajo Suspense existente.
- Perfil combina rival automático/local, vitrina experimental y legado ficticio sin duplicar evaluación.
- CSS combina diseños aprobados; se reprodujo únicamente la corrección de centrado pendiente de F5, sin tocar su worktree. El stylesheet compartido conserva reglas administrativas inertes ya presentes en F5; no se trasladaron componentes o acciones administrativas nuevos.
- Fixtures conservan los 24 jugadores, LP y snapshots F5; únicamente la racha ficticia aprobada F6 se integra en las mismas partidas de perfil. La Resurrección de Marea resulta No observado con estos snapshots; no se cambió el motor para forzar un positivo. Las conversiones horarias invariantes se calculan una vez por jugador, sin alterar datos.
- La experiencia Production Demo evalúa solo fixtures; el guard experimental real conserva sus restricciones. El adaptador RC2 devuelve unavailable fuera de Demo: no incorpora el lector SQL de evidencia.
- Retratos ficticios reutilizan ilustraciones de campeones existentes. Todas las imágenes Demo son locales; no se solicitan perfiles o catálogos a Data Dragon.
- Metadata Demo tiene origen público por defecto. Privacidad se ajustó tras identificar los dos cambios técnicos reales: almacenamiento local de rival y ausencia de solicitudes CDN en Demo. Aviso Riot conservado.

No quedan conflictos de compilación. Limitación deliberada: las consultas reales de ranking de main se conservan; el enriquecimiento SQL F5 de staging y el lector real F6 no forman parte de esta Demo. No promover esta candidata como activación real de esas funcionalidades.

### Dependencias públicas de staging incluidas

- `src/app/metrics/page.tsx`
- `src/app/player/[id]/loading.tsx`
- `src/components/achievements/achievement-panel.tsx`
- `src/components/achievements/achievements.module.css`
- `src/components/achievements/otp-highlight.tsx`
- `src/components/achievements/profile-achievements.tsx`
- `src/components/achievements/title-preview.tsx`
- `src/components/disclosure.tsx`
- `src/components/history-status.tsx`
- `src/components/info-tip.tsx`
- `src/components/match-history.tsx`
- `src/components/metrics-bento.tsx`
- `src/components/performance-chart.tsx`
- `src/components/player-momentum.tsx`
- `src/components/player-signature-section.tsx`
- `src/components/player-signature.tsx`
- `src/components/profile-freshness.tsx`
- `src/components/profile-overview.tsx`
- `src/components/recent-champion-form.tsx`
- `src/lib/achievements/adapters.ts`
- `src/lib/achievements/catalog.ts`
- `src/lib/achievements/index.ts`
- `src/lib/achievements/matches.ts`
- `src/lib/achievements/otp.ts`
- `src/lib/achievements/presentation.ts`
- `src/lib/achievements/reasons.ts`
- `src/lib/achievements/result.ts`
- `src/lib/achievements/resurrection.ts`
- `src/lib/achievements/types.ts`
- `src/lib/achievements/unstoppable.ts`
- `src/lib/achievements/validation.ts`
- `src/lib/format.ts`
- `src/lib/lp-metrics.ts`
- `src/lib/signature.ts`
- `src/lib/weekly-lp.ts`
- `src/lib/weekly-refresh.ts`
- `src/server/achievements/contracts.ts`
- `src/server/achievements/demo.ts`
- `src/server/achievements/errors.ts`
- `src/server/achievements/evaluate.ts`
- `src/server/achievements/feature.ts`
- `src/server/achievements/presentation.ts`
- `src/server/achievements/profile.ts`
- `src/server/achievements/service.ts`
- `tests/achievements-audit.test.ts`
- `tests/achievements-contracts.test.ts`
- `tests/achievements-feature.test.ts`
- `tests/achievements-fixtures.ts`
- `tests/achievements-matches.test.ts`
- `tests/achievements-properties.test.ts`
- `tests/achievements-resurrection-datasets.ts`
- `tests/achievements-resurrection-reference.ts`
- `tests/achievements-resurrection.test.ts`
- `tests/achievements-rule-copy.test.tsx`
- `tests/achievements-ui-fixtures.ts`
- `tests/achievements-visual.test.tsx`
- `tests/demo-otp-coherence.test.tsx`
- `tests/leaderboard-lp.test.tsx`
- `tests/profile-freshness.test.tsx`
- `tests/profile-refine.test.tsx`
- `tests/profile-transparency.test.tsx`
- `tests/weekly-lp.test.ts`
- `tests/weekly-refresh.test.ts`


### Adaptaciones locales respecto de la fuente seleccionada

- `docs/releases/RC2_RIOT_DEMO.md`
- `scripts/demo-network-guard.cjs`
- `scripts/dev-rc2-demo.mjs`
- `scripts/validate-production-demo.mjs`
- `src/app/globals.css`
- `src/app/layout.tsx`
- `src/app/player/[id]/page.tsx`
- `src/app/privacy/page.tsx`
- `src/components/achievements/achievement-showcase.tsx`
- `src/components/achievements/profile-achievements.tsx`
- `src/components/header-nav.tsx`
- `src/components/manual-duel.tsx`
- `src/components/manual-rival.tsx`
- `src/components/player-identity.tsx`
- `src/components/profile-rival.tsx`
- `src/components/rivalries.tsx`
- `src/lib/profile-icon.ts`
- `src/server/achievements/center.ts`
- `src/server/achievements/feature.ts`
- `src/server/achievements/profile.ts`
- `src/server/achievements/service.ts`
- `src/server/demo.ts`
- `src/server/riot/assets.ts`
- `tests/achievements-center-demo.test.tsx`
- `tests/achievements-center.test.tsx`
- `tests/achievements-presentation.test.tsx`
- `tests/achievements-profile.test.tsx`
- `tests/demo-otp-coherence.test.tsx`
- `tests/hall-of-fame.test.tsx`
- `tests/interactive-controls.test.tsx`
- `tests/production-demo.test.tsx`
- `tests/profile-refine.test.tsx`
- `tests/rc2-demo-boundary.test.ts`
- `tests/rivalry-leadership-query.test.ts`

## D. Validación

| Comprobación | Resultado |
|---|---|
| npm run lint | PASS |
| npm run typecheck | PASS |
| npm run test -- --maxWorkers=2 | 915 PASS, 0 omitidos, 0 fallidos |
| npm run build | PASS en copia aislada Production Demo |
| HTTP | 57/57 PASS |
| Navegador | 36 capturas, cinco grupos de recorridos PASS |
| Anchos | 1920, 1440, 390 y 320 px |
| Red externa / imágenes rotas / errores consola o hidratación / overflow | 0 / 0 / 0 / 0 |

La suite es la completa del conjunto main + dependencias públicas seleccionado para RC2; no equivale a ejecutar toda la infraestructura de staging/F6. Los 69 tests PostgreSQL opt-in y las suites de persistencia/migraciones no se incorporan a la candidata. Los tests PGlite existentes usan únicamente memoria y la autorización anterior, sin red. No hubo SQL operativo, migraciones ni servicios PostgreSQL.

Las primeras pasadas detectaron contratos heredados incompatibles y un timeout de inicialización PGlite durante ejecuciones concurrentes. Se corrigieron expectativas de tamaño/activación y mocks; el timeout se resolvió con dos workers, sin nuevos skips ni aumento de plazos. Las pruebas del lector SQL staging se sustituyeron por el contrato efectivo RC2: historiales originales acotados, colas separadas y cero llamadas DB. El lector no promovido sigue conservado en su origen.

Production Demo se construyó sin .env y sin DATABASE_URL, RIOT_API_KEY, ADMIN_PASSWORD, ADMIN_SESSION_SECRET ni CRON_SECRET. Guard de red bloquea destinos externos y PostgreSQL incluso loopback. Casos HTTP: API admin 503; origen inválido 403; ruta de progreso solo staging ausente 404; cron devuelve skipped/demo; estado sin scheduler; POST compartido 410, otros métodos 405. No hay ruta nueva de grants ni de persistencia de logros. Dev pages no disponibles, incluso si un boundary de streaming entrega HTTP 200 con vista not-found.

Recorridos ejecutados: búsqueda/ordenación/modos/perfiles; filtros, semanal, cronología por teclado, elección local + recarga, compartir + abrir duelo y vacío/5v5; casos de logros, requisitos, evidencia, insuficiencia y vitrina; tres emblemas, pioneros, poseedor actual/anterior, perfiles y Flex vacío; períodos/modalidades de métricas.

Accesibilidad básica: botones/links nativos, disclosures por Enter, aria-expanded, foco visible, reduced motion y lectura responsive. A 1440: rivalidad x=187, ancho=625.19; historial x=836.19, ancho=416.80; centros verticales coinciden (<3 px). A 1920 también queda a la derecha y centrado; a 390/320 se apila sin overflow. No es certificación WCAG ni prueba exhaustiva con lector de pantalla.

Evidencias privadas ignoradas: artifacts/rc2/tests.json, production-demo.json, browser-results.json, protection.json y 36 PNG. Algunas capturas de teclado muestran el enlace de salto/foco; no se interpretan como navegación con ratón. No publicar artifacts.

Revisión local: http://127.0.0.1:3003 (Production Demo). Relanzar con Node 24.19.0 desde RC2: node scripts/validate-production-demo.mjs --serve --port=3003. Ese comando reconstruye una copia sin env y mantiene bloqueo de red; Ctrl+C cierra el servidor propio y limpia únicamente su copia temporal. Alternativa de desarrollo: node scripts/dev-rc2-demo.mjs, usando el puerto libre 3003. No ejecutarlos simultáneamente en el mismo puerto.

## E. Publicación futura — requiere autorización separada

1. Revisar este inventario y los archivos completos; confirmar que main no cambió. Autorizar por separado el commit selectivo RC2, push y Preview; nada de ello está concedido aquí. Si main cambia, preparar una nueva integración revisada sin sobrescribir sus cambios ni tocar staging protegido.
2. Preferir una Preview Demo aislada, con proyecto/entorno aprobado sin integraciones DB/Riot ni credenciales heredadas. Confirmar equipo, proyecto y región gru1. DEMO_MODE=true; LADDER_SCHEDULER_ENABLED=false; APP_URL=origen HTTPS aprobado de esa Preview. ACHIEVEMENTS_EXPERIMENTAL no es necesario para fixtures. No importar variables de staging. Sin crons ni hooks de migración.
3. Conservar Vercel Authentication de staging. La revisión inicial la realiza el operador autenticado; el acceso externo mediante mecanismo de compartir de Vercel requiere autorización específica del operador. No se generó enlace ni bypass, ni se comprobó disponibilidad de plan/cuenta. [Documentación oficial de sharing](https://vercel.com/docs/deployments/sharing-deployments).
4. Validar en esa Preview los mismos recorridos, headers, guardas Demo, recursos, metadata/origen y ausencia de secretos. La validación local no sustituye la remota futura. Registrar deployment inmutable y commit exactos antes de aprobar Production.
5. Promoción solo tras revisión humana, autorización y PR selectiva contra main con este diff auditado; sin merge general de staging. Mantener DEMO_MODE=true y cinco secretos ausentes también en Production. No promover un Preview suponiendo que su build se conserva: Vercel puede reconstruirlo con variables Production; volver a verificar el build que se pretenda servir. [Promoción oficial](https://vercel.com/docs/deployments/promoting-a-deployment).
6. Rollback: registrar previamente el deployment RC1 vigente y sus variables no secretas. Ante errores, reactivar exclusivamente el deployment anterior mediante acción autorizada y comprobar dominio/metadata/guardas. No restaurar bases ni revertir migraciones: RC2 no modifica ninguna. No reescribir historia. Revisar el estado de autoasignación tras rollback antes de nuevos despliegues.

Revisión Riot: el aviso visible de independencia coincide con el requerido; se conservan las atribuciones y no se afirma respaldo. Rangos/LP son ficticios, sin MMR/ELO alternativo. Registro y auditoría de funcionalidades por Riot siguen pendientes de acreditación del operador; tampoco se acredita aquí la titularidad/licencia de los emblemas suministrados ni la suficiencia jurídica de privacidad/retención. [Políticas oficiales Riot](https://developer.riotgames.com/policies/general), [políticas específicas](https://developer.riotgames.com/policies/game-specific). No se realizaron trámites ni llamadas a su API.

Riesgos pendientes: revisión visual humana, prueba Preview autorizada, verificación legal/registro del producto y derechos de recursos; configuración real del proveedor; posible divergencia futura de main. El rival local no se comparte y puede borrarse con el almacenamiento del navegador. Hall es escenográfico e independiente de los desafíos; sin rareza real, concesiones o equipamiento. No hay bloqueos técnicos locales de esta candidata Demo; publicación y operación real permanecen NO-GO sin sus autorizaciones/validaciones.

## F. Protección

Principal: HEAD/branch/28 cambios pendientes y hashes iguales al inicio. F5: HEAD/branch/5 pendientes y bytes iguales al inicio. P4.4.D: 13/13 hashes iguales. F6: único commit autorizado, 33/33 hashes verificados; originales y exclusiones conservados. RC2: índice vacío y HEAD base intacto; sin commit RC2.

No conexiones Neon/Riot operativas, SQL remoto, migraciones, cambios de roles/permisos, ejecuciones de sincronización real, Vercel, push, merge o deploy. La consulta remota Git fue exclusivamente de lectura. Los accesos HTTP a endpoints de cron/sync verificaron su rechazo o estado inerte Demo; no activaron trabajos.

## Inventario exacto RC2 frente a main

Hashes SHA-256 y fuente por archivo en artifacts/rc2/promotion-manifest.json. La lista incluye este informe; excluye artefactos y salidas locales.

| Estado | Archivo | Fuente |
|---|---|---|
| ?? | .gitattributes | 1b9539e7cd3d |
| ?? | docs/logros/F6_EXPERIENCE.md | 1b9539e7cd3d |
| ?? | docs/logros/F63_LEGACY_PROPOSAL.md | 1b9539e7cd3d |
| ?? | docs/releases/RC2_RIOT_DEMO.md | RC2 + adaptación RC2 |
| ?? | docs/rivalidades/F5_R8_LOCAL_PREFERENCES.md | a41d6f37ba24 |
| ?? | public/achievements/hall-of-fame/el-intocable.webp | 1b9539e7cd3d |
| ?? | public/achievements/hall-of-fame/el-monarca.webp | 1b9539e7cd3d |
| ?? | public/achievements/hall-of-fame/el-primero-de-su-nombre.webp | 1b9539e7cd3d |
| ?? | scripts/achievements-demo-network-guard.cjs | 1b9539e7cd3d |
| M | scripts/demo-network-guard.cjs | RC2 + adaptación RC2 |
| ?? | scripts/dev-rc2-demo.mjs | RC2 + adaptación RC2 |
| M | scripts/validate-production-demo.mjs | 1b9539e7cd3d + adaptación RC2 |
| ?? | src/app/api/player/[id]/rival/route.ts | a41d6f37ba24 |
| M | src/app/globals.css | a41d6f37ba24 + adaptación RC2 |
| M | src/app/layout.tsx | RC2 + adaptación RC2 |
| ?? | src/app/logros/page.tsx | 1b9539e7cd3d |
| M | src/app/metrics/page.tsx | 2dbd13a32b58 |
| M | src/app/page.tsx | a41d6f37ba24 |
| M | src/app/player/[id]/loading.tsx | 2dbd13a32b58 |
| M | src/app/player/[id]/page.tsx | a41d6f37ba24 + adaptación RC2 |
| M | src/app/privacy/page.tsx | RC2 + adaptación RC2 |
| ?? | src/app/rivalidad/[first]/[second]/page.tsx | a41d6f37ba24 |
| ?? | src/app/rivalidades/page.tsx | a41d6f37ba24 |
| ?? | src/app/salon-de-la-fama/page.tsx | 1b9539e7cd3d |
| ?? | src/components/achievements/achievement-catalog.tsx | 1b9539e7cd3d |
| ?? | src/components/achievements/achievement-emblem.tsx | 1b9539e7cd3d |
| ?? | src/components/achievements/achievement-panel.tsx | 2dbd13a32b58 |
| ?? | src/components/achievements/achievement-showcase.tsx | 1b9539e7cd3d + adaptación RC2 |
| ?? | src/components/achievements/achievements.module.css | 2dbd13a32b58 |
| ?? | src/components/achievements/experience.module.css | 1b9539e7cd3d |
| ?? | src/components/achievements/otp-highlight.tsx | 2dbd13a32b58 |
| ?? | src/components/achievements/profile-achievements.tsx | 2dbd13a32b58 + adaptación RC2 |
| ?? | src/components/achievements/title-preview.tsx | 2dbd13a32b58 |
| ?? | src/components/disclosure.tsx | 2dbd13a32b58 |
| ?? | src/components/hall-of-fame/hall-of-fame.tsx | 1b9539e7cd3d |
| ?? | src/components/hall-of-fame/hall.module.css | 1b9539e7cd3d |
| M | src/components/header-nav.tsx | 1b9539e7cd3d + adaptación RC2 |
| M | src/components/history-status.tsx | 2dbd13a32b58 |
| M | src/components/info-tip.tsx | 2dbd13a32b58 |
| M | src/components/leaderboard.tsx | a41d6f37ba24 |
| ?? | src/components/manual-duel.tsx | a41d6f37ba24 + adaptación RC2 |
| ?? | src/components/manual-rival.tsx | a41d6f37ba24 + adaptación RC2 |
| M | src/components/match-history.tsx | 2dbd13a32b58 |
| M | src/components/metrics-bento.tsx | 2dbd13a32b58 |
| M | src/components/performance-chart.tsx | 2dbd13a32b58 |
| M | src/components/player-identity.tsx | RC2 + adaptación RC2 |
| M | src/components/player-momentum.tsx | 2dbd13a32b58 |
| M | src/components/player-signature-section.tsx | 2dbd13a32b58 |
| M | src/components/player-signature.tsx | 2dbd13a32b58 |
| ?? | src/components/profile-freshness.tsx | 2dbd13a32b58 |
| ?? | src/components/profile-overview.tsx | 2dbd13a32b58 |
| ?? | src/components/profile-rival.tsx | a41d6f37ba24 + adaptación RC2 |
| M | src/components/recent-champion-form.tsx | 2dbd13a32b58 |
| ?? | src/components/rivalries-summary.tsx | a41d6f37ba24 |
| ?? | src/components/rivalries.tsx | a41d6f37ba24 + adaptación RC2 |
| ?? | src/components/rivalry-leadership.tsx | a41d6f37ba24 |
| ?? | src/components/rivalry-timeline.tsx | a41d6f37ba24 |
| ?? | src/components/share-rivalry.tsx | a41d6f37ba24 |
| M | src/components/shell.tsx | a41d6f37ba24 |
| ?? | src/lib/achievements/adapters.ts | 2dbd13a32b58 |
| ?? | src/lib/achievements/catalog.ts | 2dbd13a32b58 |
| ?? | src/lib/achievements/experience.ts | 1b9539e7cd3d |
| ?? | src/lib/achievements/index.ts | 2dbd13a32b58 |
| ?? | src/lib/achievements/matches.ts | 2dbd13a32b58 |
| ?? | src/lib/achievements/otp.ts | 2dbd13a32b58 |
| ?? | src/lib/achievements/presentation.ts | 2dbd13a32b58 |
| ?? | src/lib/achievements/reasons.ts | 2dbd13a32b58 |
| ?? | src/lib/achievements/result.ts | 2dbd13a32b58 |
| ?? | src/lib/achievements/resurrection.ts | 2dbd13a32b58 |
| ?? | src/lib/achievements/types.ts | 2dbd13a32b58 |
| ?? | src/lib/achievements/unstoppable.ts | 2dbd13a32b58 |
| ?? | src/lib/achievements/validation.ts | 2dbd13a32b58 |
| ?? | src/lib/format.ts | 2dbd13a32b58 |
| ?? | src/lib/hall-of-fame/contracts.ts | 1b9539e7cd3d |
| ?? | src/lib/hall-of-fame/emblems.ts | 1b9539e7cd3d |
| ?? | src/lib/hall-of-fame/proposals.ts | 1b9539e7cd3d |
| ?? | src/lib/local-rival-preference.ts | a41d6f37ba24 |
| M | src/lib/lp-metrics.ts | 2dbd13a32b58 |
| ?? | src/lib/manual-rival.ts | a41d6f37ba24 |
| ?? | src/lib/nearest-rival.ts | a41d6f37ba24 |
| ?? | src/lib/profile-icon.ts | RC2 + adaptación RC2 |
| ?? | src/lib/rival-comparison-label.ts | a41d6f37ba24 |
| ?? | src/lib/rivalries.ts | a41d6f37ba24 |
| ?? | src/lib/rivalry-dynamics.ts | a41d6f37ba24 |
| ?? | src/lib/rivalry-leadership.ts | a41d6f37ba24 |
| ?? | src/lib/rivalry-timeline.ts | a41d6f37ba24 |
| ?? | src/lib/shared-rivalry.ts | a41d6f37ba24 |
| M | src/lib/signature.ts | 2dbd13a32b58 |
| M | src/lib/types.ts | a41d6f37ba24 |
| M | src/lib/weekly-lp.ts | 2dbd13a32b58 |
| ?? | src/lib/weekly-refresh.ts | 2dbd13a32b58 |
| ?? | src/lib/weekly-rivalry.ts | a41d6f37ba24 |
| ?? | src/server/achievements/center.ts | 1b9539e7cd3d + adaptación RC2 |
| ?? | src/server/achievements/contracts.ts | 2dbd13a32b58 |
| ?? | src/server/achievements/demo.ts | 2dbd13a32b58 |
| ?? | src/server/achievements/errors.ts | 2dbd13a32b58 |
| ?? | src/server/achievements/evaluate.ts | 2dbd13a32b58 |
| ?? | src/server/achievements/feature.ts | 2dbd13a32b58 + adaptación RC2 |
| ?? | src/server/achievements/presentation.ts | 2dbd13a32b58 |
| ?? | src/server/achievements/profile.ts | 2dbd13a32b58 + adaptación RC2 |
| ?? | src/server/achievements/service.ts | 2dbd13a32b58 + adaptación RC2 |
| M | src/server/demo.ts | a41d6f37ba24 + adaptación RC2 |
| ?? | src/server/hall-of-fame/demo.ts | 1b9539e7cd3d |
| ?? | src/server/local-rival-options.ts | a41d6f37ba24 |
| ?? | src/server/profile-rival.ts | a41d6f37ba24 |
| M | src/server/riot/assets.ts | RC2 + adaptación RC2 |
| ?? | tests/achievements-audit.test.ts | 2dbd13a32b58 |
| ?? | tests/achievements-center-demo.test.tsx | 1b9539e7cd3d + adaptación RC2 |
| ?? | tests/achievements-center.test.tsx | 1b9539e7cd3d + adaptación RC2 |
| ?? | tests/achievements-contracts.test.ts | 2dbd13a32b58 |
| ?? | tests/achievements-feature.test.ts | 2dbd13a32b58 |
| ?? | tests/achievements-fixtures.ts | 2dbd13a32b58 |
| ?? | tests/achievements-gallery.test.tsx | 1b9539e7cd3d |
| ?? | tests/achievements-matches.test.ts | 2dbd13a32b58 |
| ?? | tests/achievements-presentation.test.tsx | 1b9539e7cd3d + adaptación RC2 |
| ?? | tests/achievements-profile.test.tsx | a41d6f37ba24 + adaptación RC2 |
| ?? | tests/achievements-properties.test.ts | 2dbd13a32b58 |
| ?? | tests/achievements-resurrection-datasets.ts | 2dbd13a32b58 |
| ?? | tests/achievements-resurrection-reference.ts | 2dbd13a32b58 |
| ?? | tests/achievements-resurrection.test.ts | 2dbd13a32b58 |
| ?? | tests/achievements-rule-copy.test.tsx | 2dbd13a32b58 |
| ?? | tests/achievements-ui-fixtures.ts | 2dbd13a32b58 |
| ?? | tests/achievements-visual.test.tsx | 2dbd13a32b58 |
| ?? | tests/apex-lp-comparison.test.tsx | a41d6f37ba24 |
| ?? | tests/demo-community.test.ts | a41d6f37ba24 |
| ?? | tests/demo-otp-coherence.test.tsx | 2dbd13a32b58 + adaptación RC2 |
| ?? | tests/equivalent-lp.test.tsx | a41d6f37ba24 |
| ?? | tests/hall-emblems.test.tsx | 1b9539e7cd3d |
| ?? | tests/hall-of-fame.test.tsx | 1b9539e7cd3d + adaptación RC2 |
| ?? | tests/interactive-controls.test.tsx | a41d6f37ba24 + adaptación RC2 |
| ?? | tests/leaderboard-lp.test.tsx | 2dbd13a32b58 |
| ?? | tests/local-rival-preference.test.ts | a41d6f37ba24 |
| ?? | tests/manual-rival.test.tsx | a41d6f37ba24 |
| ?? | tests/nearest-rival.test.tsx | a41d6f37ba24 |
| M | tests/production-demo.test.tsx | RC2 + adaptación RC2 |
| ?? | tests/profile-coverage.test.tsx | a41d6f37ba24 |
| ?? | tests/profile-freshness.test.tsx | 2dbd13a32b58 |
| ?? | tests/profile-refine.test.tsx | 2dbd13a32b58 + adaptación RC2 |
| ?? | tests/profile-rival-query.test.ts | a41d6f37ba24 |
| ?? | tests/profile-transparency.test.tsx | 2dbd13a32b58 |
| ?? | tests/rc2-demo-boundary.test.ts | RC2 + adaptación RC2 |
| ?? | tests/rival-comparison-label.test.tsx | a41d6f37ba24 |
| ?? | tests/rivalries-page.test.tsx | a41d6f37ba24 |
| ?? | tests/rivalries-ui.test.tsx | a41d6f37ba24 |
| ?? | tests/rivalries.test.ts | a41d6f37ba24 |
| ?? | tests/rivalry-dynamics.test.tsx | a41d6f37ba24 |
| ?? | tests/rivalry-leadership-query.test.ts | a41d6f37ba24 + adaptación RC2 |
| ?? | tests/rivalry-leadership-ui.test.tsx | a41d6f37ba24 |
| ?? | tests/rivalry-leadership.test.ts | a41d6f37ba24 |
| ?? | tests/rivalry-timeline.test.tsx | a41d6f37ba24 |
| ?? | tests/rivalry-visual.test.tsx | a41d6f37ba24 |
| ?? | tests/shared-duel-page.test.tsx | a41d6f37ba24 |
| ?? | tests/shared-rivalry.test.tsx | a41d6f37ba24 |
| M | tests/weekly-lp.test.ts | 2dbd13a32b58 |
| ?? | tests/weekly-refresh.test.ts | 2dbd13a32b58 |
| ?? | tests/weekly-rivalry.test.tsx | a41d6f37ba24 |
