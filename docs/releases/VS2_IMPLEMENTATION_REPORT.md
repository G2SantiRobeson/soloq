# SOLOQ — VS 2.0 IMPLEMENTATION REPORT

Estado: implementado y validado localmente; pendiente de revisión visual humana.

## Entorno y aislamiento

- Worktree: `D:\soloq-vs2`.
- Rama: `feat/vs2-competitive-comparison`, sin upstream.
- Base `origin/staging`: `5b1da494f7151428c5e74ab507ea256bf388ca7c`.
- `origin/main` observado por fetch: `d1f60232deb3dbad64daf6213473345bfb9faff5`.
- Sin commit, push, PR, merge ni deployment. No se modificaron ramas locales main/staging ni otros worktrees.
- Emblemas pendientes conservados aparte en `D:\soloq-achievement-emblems`, con el mismo conjunto de cambios sin commit.
- Sin cambios en backend, auth, seguridad, P4.4.D, esquema, Drizzle, dependencias, fixtures o recursos gráficos. No se leyeron ni modificaron credenciales o archivos .env.

## Reutilización e implementación

La misma ruta `/rivalidad/[first]/[second]` conserva validación de IDs, región, modalidad, filtros de retorno y elegibilidad automática. Las comparaciones manuales siguen permitiendo pares no próximos de la misma plataforma; su selección permanece exclusivamente en el navegador. El endpoint antiguo 410 no se reactiva.

Se reutilizan `ManualDuel`, `getLeaderboard`, `getAssets`, `PageHeading`, `QueueTabs`, `Avatar`, `RankDisplay`, `RecentChampionForm`, `ShareRivalry`, los comparadores de rango/LP y los detectores/timeline históricos existentes. No hay lectores nuevos ni consultas N+1 añadidas.

El VS añade identidad enfrentada, tabla de rango/LP/WR/V-D/KDA/cambio semanal, muestras y cobertura por jugador, forma reciente y momento competitivo. Los accesos del perfil ahora son botones «Abrir VS». Compartir mantiene también `tipo=elegida`, además de los IDs, modalidad y filtros.

El rango mostrado puede empatar mientras los LP difieren. Apex conserva categorías oficiales y permite la resta directa aprobada; el mayor LP y la categoría superior pueden corresponder a jugadores distintos. No se producen LP nominales entre tiers/divisiones regulares, puntuaciones globales, predicciones ni un ganador general.

## Límites de evidencia

- Las estadísticas pertenecen a la temporada y modalidad consultadas, sobre muestras importadas propias. Tamaño, estado y ausencia de exhaustividad se declaran por separado; «mayor valor» no equipara cobertura ni significa mejor jugador.
- Cero partidas significa ausencia de muestra, no 0 % de WR ni KDA 0. Un 0 % respaldado por derrotas sí se conserva.
- LP semanal requiere un resumen semanal existente respaldado por el mismo segmento de rango e intervalo. No se renombra una coordenada de ascenso como LP bruto. Intervalos distintos/parciales no reciben una ventaja comparativa.
- Los fixtures actuales no aportan un resumen semanal acreditado para este campo: se muestra «—», sin alterar los fixtures. Los tests ejercitan intervalos positivos, parciales, incompatibles y ausentes.
- El lector operacional actual no aporta cortes emparejados de rivalidad en todos los casos. Sin ellos, el historial es neutral. No se amplía el lector ni se inventan observaciones; Demo conserva su historial ficticio existente.
- No se reconstruyen LP desde partidas, fechas exactas de adelantamiento ni enfrentamientos reales entre los dos jugadores.
- Next transmite la pantalla de carga antes del `notFound()`: los tres casos inválidos del smoke muestran UI de no encontrado y `noindex`, con HTTP 200 por streaming. Los tests verifican rechazo antes de lectores para IDs/modalidades inválidos. No se añade middleware operacional para alterar este comportamiento.

## Validación final

- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `npm run test -- --maxWorkers=2`: 1768 PASS, 0 fallos; 40 PostgreSQL opt-in omitidos (6 logros, 30 concurrencia, 4 progreso), sin certificarlos.
- 31 tests nuevos. La suite ordinaria conserva sus mocks y PGlite en memoria previamente autorizado, sin red; no se ejecutó SQL remoto ni una migración operativa.
- `npm run build`, DEMO_MODE=true: PASS, Next 16.3.8 / Node 24.19.0.
- 24 checks Chrome locales: 1440/390 px, automático, manual, Apex, sin rango, ausente, región distinta, Flex, rutas principales y URLs inválidas. Sin overflow, errores JS, solicitudes externas ni mutaciones de red al guardar la elección local.
- Teclado: compartir, foco visible y apertura/cierre del historial. Las mitades del duelo se verifican mediante bounding boxes con el mismo borde superior y disposición horizontal.
- Entorno de build/servidor sin credenciales, scheduler apagado y guard de red que rechaza destinos externos/puerto 5432.
- Evidencia local ignorada por Git: `artifacts/vs2/validation.json`, logs, `browser.json` y capturas. El prebuild regeneró dos manifiestos con el mismo contenido; se restauró únicamente su formato CRLF original.

## Archivos del cambio

Modificados:
- `src/app/rivalidad/[first]/[second]/page.tsx`
- `src/components/manual-duel.tsx`
- `src/components/manual-rival.tsx`
- `src/components/profile-rival.tsx`
- `src/components/share-rivalry.tsx`
- `src/lib/shared-rivalry.ts`

Nuevos:
- `src/app/rivalidad/[first]/[second]/loading.tsx`
- `src/components/versus-comparison.tsx`
- `src/components/versus.module.css`
- `src/lib/versus-comparison.ts`
- `tests/versus-comparison.test.tsx`
- `tests/versus-page.test.tsx`
- Este informe.

## Revisión local

Servidor Demo, solo loopback:
`http://127.0.0.1:3105/rivalidad/demo-4/demo-5?queue=soloq`

Comparación manual:
`http://127.0.0.1:3105/rivalidad/demo-1/demo-4?queue=soloq&tipo=elegida`

Capturas de la pantalla completa, duelo e historial abierto en `artifacts/vs2/screenshots/`, con sufijos `1440` y `390`. Las capturas se obtuvieron de la aplicación compilada, sin modificar registros para producir el resultado.

La futura integración debe revisarse hacia staging; esta tarea no publica nada ni incorpora los emblemas pendientes.
