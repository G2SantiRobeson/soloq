# SOLOQ RC3.4.A.1 — COMPATIBILITY REPORT

Estado final: **PASS local**. Publicación, PR y ejecución operacional siguen pendientes de autorización.

## Alcance y método

Worktree exclusivo D:/soloq-rc3-integration; rama codex/rc3-staging-integration, sin upstream. HEAD origin/staging d65c43bdc5df3c478af5871462db704d32a45aa5. No merge completo, commits ni cambios en otras ramas/worktrees.

La selección procede de RC2 origin/main 65c3a1460acb7e499d6d4859ed0cf4331d1fb4be y de los commits RC3 41ac170060a832e1bdf5e57b47f765a87a636ea8 / 05f888eed4a824abd23830260bb54c6b1f3db3bc. Se incorporaron dependencias F5/F6 ausentes y los archivos visuales aprobados; se omitieron configuración de despliegue, documentación de publicación RC2, lanzador RC2, backend reducido, migraciones y P4.4.D. Procedencia exacta: artifacts/rc34a1/import-provenance.json. Inventario final con hashes: artifacts/rc34a1/final-manifest.json.

## Matriz de los 15 conflictos previos

Clases: A visual; B compartido; C funcional; D infraestructura/seguridad. Las resoluciones C/D son adaptaciones explícitas, no una elección global de rama.

| Archivo | Clase / función | RC2 | Staging | Dependencias / contrato público | Riesgo | Resolución aplicada |
| --- | --- | --- | --- | --- | --- | --- |
| scripts/validate-production-demo.mjs | D, validación de aislamiento | Comprueba F5/F6 y ausencia del endpoint de progreso | Endpoint de progreso existe y devuelve 503 en Demo | Guards Demo, HTTP no-store, rutas admin | Confundir ausencia de ruta con aislamiento | Añadir checks RC2/RC3; exigir 503 para progreso conservado y texto RC3 en tipo oración |
| src/app/globals.css | A, sistema visual | Incluye estilos F5/F6 y reglas operacionales heredadas | Estilos de progreso/admin y estados | Tokens, controles, responsive | Perder estilos operacionales o romper layout | Adoptar RC3 aprobado; conservar los selectores operacionales presentes; revisar componentes mediante tests |
| src/app/player/[id]/page.tsx | B, composición del perfil | Rival automático/manual local, vitrina y legado Demo | Métricas, firma, señales con lector compartido diferido | getProfile, loader por request, Suspense, props de cola | Duplicar evaluación o mezclar fixtures y lectores | Composición RC3 con dependencias RC2; mismo loader compartido de staging y consultas base intactas |
| src/components/achievements/profile-achievements.tsx | B, disclosure/OTP | Permite presentación Demo pública | Gate experimental exclusivamente | profileAchievementLoader, View, presentación discriminada | Trabajo real con gate apagado | Solo cambiar las tres referencias al helper de presentación; contenido y lazy loader conservados |
| src/components/leaderboard.tsx | B, filtros y clasificación | Comparte rivalidades, conserva filtros y calendario | Métricas oficiales semanal/últimas cinco | PublicPlayer, cola/plataforma, filtros | Cambiar orden o LP | Componente RC3 aprobado; funciones de ranking, métricas y lectores de staging intactos |
| src/server/achievements/feature.ts | D, gates | Experiencia Demo OR flag experimental | Flag explícito solo local/Preview, nunca Production | isDemo y variables solo servidor | Activar lector real por Demo o por input cliente | Añadir helper OR para presentación; cuerpo de achievementsExperimentalEnabled sin cambios |
| src/server/achievements/profile.ts | C, presentación diferida | Usa helper Demo y conserva mapping de identidad ficticia | Loader lazy/cache y lector interno, errores sanitizados | playerId/view/asOf/champions; null o AchievementPresentation | Omitir estados o iniciar IO prematuro | Solo adaptar import/gate; cache, mapping, lectura y catch originales intactos |
| src/server/achievements/service.ts | D, lector operacional | Devuelve unavailable fuera de Demo | consistentAchievementReader(db()), evaluación y catch | AchievementReadResult; validación previa de request y 5v5 | Deshabilitar staging real | Archivo exactamente idéntico a origin/staging; ninguna sustitución de backend |
| src/server/demo.ts | C, fixtures | 24 jugadores y series F5/F6 coherentes | 12 jugadores con colas/períodos y OTP | demoPlayers, identidad ficticia, snapshots explícitos | Mezclar historial ficticio con datos reales | Fixtures RC2 aprobados; entrada solo por isDemo; no cambios en consultas reales |
| tests/achievements-presentation.test.tsx | D, límites de IO | Espera servicio Demo-only | Verifica lector SQL sin escrituras | Presentation, componentes server, queries | Eliminar cobertura operacional para pasar tests | Conservar inspección del lector queries.ts y añadir límites de vitrina server; no exigir retirada del lector real |
| tests/achievements-profile.test.tsx | C, gates del perfil | Mockea rival y distingue Demo de flag real | Cubre gate apagado, errores, streaming y estados | RSC y servicio mock | Interpretar Demo pública como activación operacional | Conservar casos, añadir mocks F5; probar gate apagado con DEMO_MODE=false |
| tests/demo-otp-coherence.test.tsx | C, identidad/evidencia Demo | Caso flag-off explícitamente no Demo | Evidencia de cada perfil y cola | snapshots y demoAchievementReader | Atribución ficticia incorrecta | Misma evidencia y aserciones; especificar no Demo al verificar flag-off |
| tests/interactive-controls.test.tsx | B, interacción/semántica | Mocks F5 y gate no Demo | Controles y disclosure/gates | Navegación, formularios y props | Regresión funcional oculta por nuevo markup | Tests RC3 aprobados con mocks y distinción Demo/operacional; mantener checks de controles |
| tests/profile-coverage.test.tsx | B, transparencia | Mockea rivales | Cobertura incompleta y no inventar historial | HistoryStatus y perfil simulado | Confundir presentación con cobertura real | Tests RC3 con mocks; conservar estados de cobertura y desconocido |
| tests/profile-refine.test.tsx | C, OTP/lector compartido | Gate apagado solo no Demo | Evidencia y evaluación única | loader, flag y View | Cambiar criterios de concesión | Mantener aserciones y explicitar DEMO_MODE=false en caso gate-off |

## Contratos conservados

- service.ts, queries.ts, evaluador, reglas de concesión, persistencia, captura, auth, endpoints admin/cron, sync, schema y journal conservan sus blobs originales de staging.
- En DEMO_MODE=false el helper coincide con el gate experimental previo. No se cambian roles, permisos, credenciales, escrituras ni criterios de concesión.
- En Demo se permite presentación ficticia aunque el gate real esté apagado. El lector de staging ya separaba ambas fuentes. Las vitrinas consumen el mismo loader y los resultados siguen siendo observaciones sin concesión/certificación.
- El centro y los consumidores F5/F6 usan las APIs revisadas de RC2; no se añaden SQL o escrituras nuevas a esos adaptadores. Los campos de historial de rivalidad son opcionales: ausencia de evidencia no se convierte en LP inventados.
- AdminPanel conserva runners, polling, fencing de acciones, backfill, diagnóstico, cancelación y errores. Solo se adaptaron dos etiquetas visuales RC3.
- Assets Demo locales se incorporan mediante un early return; la rama real del lector de assets se conserva.
- Las preferencias manuales siguen siendo locales al navegador y el endpoint antiguo continúa retirado (410); sin persistencia compartida nueva.

## Incidencia de checkout y trazabilidad

La primera suite detectó dos fallos de hashes: 1735 PASS, 2 FAIL, 40 omitidos opt-in. Se acreditó que 17 archivos Drizzle diferían solo por CRLF/LF introducido por el checkout de Windows. Se materializaron los bytes exactos de origin/staging, sin editar SQL, hashes esperados, snapshot ni journal. La regla .gitattributes de RC2 (drizzle/** -text) evita nuevas conversiones. El diff final de Drizzle debe ser vacío y sus bytes idénticos a los blobs originales. Evidencia inicial preservada en initial-test.log y checkout-line-endings.json.

## Validación

- npm run lint: PASS.
- npm run typecheck: PASS.
- npm run test -- --maxWorkers=2: 1737 PASS, 40 omitidos opt-in, 0 fallidos; 94 archivos aprobados y tres opt-in omitidos.
- Omisiones existentes: achievements-postgres (6), evidence-concurrency-postgres (30), sync-progress-postgres (4). Requieren PostgreSQL local independiente; no se ejecutaron.
- npm run build: PASS en Demo aislado.
- Segunda verificación focalizada con mocks: 40/40 PASS (13 nuevos + 27 gates existentes).
- HTTP sobre el build local: 57/57 PASS; páginas principales, colas, períodos, API retirada, guards de administración, cron inocuo y sync-status sin scheduler.
- Chrome a 1440 y 390 px: 18/18 combinaciones sin overflow, errores JS ni peticiones externas; dos guards /dev/stress sin exposición y con noindex. Capturas en artifacts/rc34a1/screens/.
- El primer harness visual asumía una sola meta robots y falló tras aprobar las 18 vistas; se corrigió solo ese locator, comprobando todas las etiquetas noindex, y se repitieron únicamente los dos guards. Evidencia inicial conservada.
- Servidor temporal detenido y puerto 3180 cerrado. git diff --check PASS. Schema, backend protegido, dependencias, next-env y bytes autoritativos Drizzle comprobados.

Node 24.19.0. Runner con allowlist de entorno, sin credenciales, red externa bloqueada y scheduler desactivado. Servidor/build DEMO_MODE=true; los tests controlan sus mocks de modos. PGlite exclusivamente en memoria según la autorización existente; ningún SQL operacional, migrador o PostgreSQL de red ejecutado. Los tests opt-in que necesitan PostgreSQL independiente se mantienen omitidos por sus gates originales: no se añadieron skips.

## Revisión React y límites

Se conservaron límites server/client, props serializables y lazy loader por request. Sin hooks condicionales, nuevos paquetes o evaluación cliente. No se sustituyó estado desconocido por resultados inventados. RC3 comparte PageHeading, QueueTabs, TierDistribution y tokens. Se preservan las limitaciones visuales previas (Chrome, no dispositivo físico/lector de pantalla humano) y estilos heredados ya documentados; no se hizo otro rediseño.

La compatibilidad operacional real con Neon, concurrencia entre procesos, credenciales, migración o Riot no se probó ni se declara PASS. Se verifica mediante contratos existentes, mocks y PGlite aislado. P4.4.D y staging local 2dbd13a no se incorporaron: la base es exclusivamente origin/staging y su journal 0000–0008.

## Git e integración futura

Todos los cambios quedan sin commit ni staging selectivo. No hay merge/cherry-pick/rebase en curso. Los commits originales RC3 permanecen intactos. Antes de una futura autorización de commit, revisar el manifiesto final, excluir artifacts/node_modules/.next y comprobar nuevamente el alcance.

Ruta staging: autorizar después el commit selectivo, push de esta rama y PR hacia staging; revisar conciliación y validar Preview, sin aplicar migraciones o activar operaciones automáticamente.

Ruta Production: desde main actualizado promover solo 41ac170 y 05f888e y correcciones visuales aprobadas que resulten necesarias. No promover esta rama completa ni sus 44 commits operacionales de staging. Comparar ambas rutas con los mismos fixtures Demo, reloj, filtros y resoluciones; conservar validaciones de contrato separadas de la equivalencia visual.
