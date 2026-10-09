# SoloQ 2.0 — Production Demo RC1

Auditoría y preparación local del 9 de octubre de 2026, desde
`bf4f8d853426e7a5afd9231e8354c378b36c5464` en `staging`.
La decisión del propietario es una Production pública exclusivamente ficticia;
Preview conserva la integración real con Neon staging y Riot.

## Resultado y límites

**GO técnico para la demo aislada. NO-GO para el lanzamiento público hasta resolver
los datos del responsable y verificar manualmente la configuración de Vercel.**

El código puede servir las rutas de demo sin PostgreSQL, sin Riot API Key y sin
migraciones. No se ha publicado ni desplegado este RC1. No se han consultado secretos,
ejecutado migraciones, sincronizado cuentas ni accedido a Neon. La configuración
efectiva de Vercel y el registro/revisión del producto por Riot no se han verificado.

## Hallazgos clasificados

| Severidad                     | Evidencia en el código inicial                                                                                                                                                                                                                        | Corrección                                                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alta                          | `authenticated()` en `src/server/auth.ts` podía consultar PostgreSQL y necesitar el secreto de sesión ante una cookie residual de 64 caracteres, aunque la página admin estuviera deshabilitada en demo. Las API protegidas dependían de esa función. | `authenticated()` devuelve `false` inmediatamente en demo; `requireAdmin()` rechaza con 503 antes de sesiones, SQL y entradas. Se conserva la validación de origen.           |
| Alta                          | `GET /api/cron/sync` consultaba `CRON_SECRET` antes del rechazo demo del lease: una llamada residual sin secretos causaba un error de configuración. `vercel.json` programaba el endpoint diariamente.                                                | El cron declarativo se elimina y el endpoint devuelve 200 con `skipped: true, reason: "demo"` antes de consultar secretos o servicios.                                        |
| Media                         | Banner genérico y etiquetas de LP, snapshots, contadores e importación presentaban fixtures como registros oficiales o cobertura de Riot. Metadatos y documentos públicos no describían claramente esta instancia.                                    | Banner, metadatos, notas, gráfica, historial y cobertura distinguen datos ficticios. Privacidad/términos describen las operaciones técnicas y los pendientes del propietario. |
| Media, riesgo potencial       | `getSignatureBaseline` usaba una caché cuya entrada no distinguía el modo de datos. No hay evidencia operacional de reutilización incorrecta o exposición.                                                                                            | El modo `demo`/`live` es argumento de la función cacheada. La rama demo agrega fixtures directamente.                                                                         |
| Defensa adicional             | La fábrica `db()` y `RiotClient.request()` no bloqueaban llamadas internas directas en demo. No se encontró una ruta pública demo que necesitara usarlas.                                                                                             | Rechazo antes de crear un cliente PostgreSQL o hacer una solicitud Riot, incluso con credenciales configuradas accidentalmente.                                               |
| Bloqueo previo al lanzamiento | Identidad/contacto del responsable, conservación de registros del alojamiento y revisión del producto no están acreditados en el repositorio.                                                                                                         | Se identifican explícitamente como pendientes; no se inventan datos ni aprobaciones.                                                                                          |

No se afirma que estos caminos hayan sido explotados en Production ni que existiera
una filtración. Los hallazgos sobre accesos proceden de la revisión del código; las
correcciones están cubiertas por regresiones y ejecución aislada.

## Auditoría de accesos

| Superficie                              | Resultado con `DEMO_MODE=true`                                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `/`, SoloQ, Flex, 5v5                   | 12 jugadores ficticios; filtros y enlaces conservados; sin contador que prometa sincronización real.                               |
| `/player/demo-*`                        | Perfil, pool, forma, firma, gráficos, LP y partidas provenientes de fixtures. Resumen de 5 y páginas expandidas de 10 conservados. |
| `/metrics`                              | Temporada, 30d y 7d en las tres colas; agregados, gráficos y salones calculados con fixtures.                                      |
| `/privacy`, `/terms`, metadatos y shell | Banner ficticio y disclaimer Riot; texto técnico adaptado al modo efectivo.                                                        |
| `/admin`                                | Página informativa con administración deshabilitada; no consulta sesiones ni SQL.                                                  |
| `POST /api/admin/login`                 | 503 en demo antes de interpretar JSON, secretos o intentos de login. Origen ajeno: 403.                                            |
| `POST /api/admin/logout`                | 503 antes de eliminar sesiones o acceder a cookies/SQL. Origen ajeno: 403.                                                         |
| `GET/POST /api/admin/players`           | 503; sin lecturas o altas. POST conserva control de origen.                                                                        |
| `PATCH/DELETE /api/admin/players/[id]`  | 503 antes de validar ID/body o modificar registros; origen ajeno: 403.                                                             |
| `POST /api/admin/players/[id]/sync`     | 503 antes de SQL, lease o Riot; origen ajeno: 403.                                                                                 |
| `POST /api/admin/players/[id]/backfill` | 503 antes de SQL, lease o Riot; origen ajeno: 403.                                                                                 |
| `POST /api/admin/sync`                  | 503 antes de ejecutar trabajos; origen ajeno: 403.                                                                                 |
| `GET /api/cron/sync`                    | 200 no-op sin `CRON_SECRET`, incluso con Authorization residual.                                                                   |
| `GET /api/ladder/sync-status`           | 200, estado `never`, sin última sincronización ni scheduler, sin SQL.                                                              |
| Perfiles inexistentes y `/dev/*`        | Vista de no encontrado, sin PostgreSQL y sin 500. Las páginas `/dev/*` siguen restringidas a desarrollo.                           |
| Ruta inexistente genérica               | 404 con shell demo.                                                                                                                |

Las respuestas API tienen `Cache-Control: no-store`. Los endpoints conservan su
comportamiento de autenticación, origen, validación, lease y rate limiting cuando
`DEMO_MODE=false`. No se cambian presupuestos, cursores, deduplicación ni planificación.
Los scripts operativos de migración no forman parte del build ni del runtime demo;
no deben ejecutarse para desplegar esta instancia.

La respuesta de una página dinámica que ya comenzó a transmitir puede tener HTTP
200 y terminar en la vista de no encontrado. Es la semántica documentada de Next.js
para `notFound()` con streaming. La prueba exige esa vista explícita y rechaza 500;
no considera un 200 por sí solo como prueba de perfil válido.

## Cron

`vercel.json` ya no declara trabajos programados. La eliminación surte efecto cuando
se despliegue este RC1; no se ha cambiado el deployment actual de Production.
Debe revisarse después del despliegue que Vercel no muestre trabajos residuales.
Una llamada residual al endpoint demo es inocua y no necesita ningún secreto.

Vercel Cron se ejecuta en Production, no en Preview. El scheduler externo de staging
no se configura ni modifica aquí. `LADDER_SCHEDULER_ENABLED` solo comunica su estado
a la interfaz y no crea trabajos.
[Documentación de Vercel Cron](https://vercel.com/docs/cron-jobs) y
[comprobaciones de cron](https://vercel.com/kb/guide/troubleshooting-vercel-cron-jobs).
El flujo protegido y el lease real siguen descritos en [STAGING_SYNC.md](STAGING_SYNC.md).

## Compatibilidad entre ramas y migraciones

La comparación de solo lectura utilizó `main` y `origin/main` locales en
`5586b303bf613ddd6ae47da3a504d9f6ec941b72`, frente al staging inicial `bf4f8d8`.
No se actualizaron ni modificaron esas referencias. El estado remoto efectivo debe
revisarse de nuevo antes de una futura promoción autorizada.

Staging incluye las fases de perfiles, LP, premios y diagnósticos administrativos,
las consultas de temporada y los servicios de sincronización posteriores a main.
Las diferencias de configuración incluyen el indicador documental
`LADDER_SCHEDULER_ENABLED`; RC1 elimina el cron compartido, sin cambiar `.env.example`.

- `0004_far_wiccan.sql`: cuatro columnas aditivas de observabilidad en `sync_locks`:
  `last_successful_sync_at`, `last_started_at`, `last_finished_at`, `last_outcome`.
- `0005_player_sync_states.sql`: cinco columnas aditivas nullable en `players`:
  `rank_checked_at`, `rank_error`, `recent_error`, `backfill_error`, `last_sync_attempt`.

Ambas migraciones y sus metadatos se conservan sin cambios. Son necesarias para las
operaciones reales que dependen de ellas, pero **no para Production Demo**. La prueba
aislada ni siquiera copia `drizzle/`, además de carecer de conexión y secretos. El
build y los accesos públicos finalizan correctamente. No hay nuevas dependencias,
cambios de schema o migraciones en RC1.

## Configuración manual de Vercel

Estos son valores/condiciones a revisar por el propietario, no una descripción de
variables remotas inspeccionadas. No copiar secretos al chat ni al repositorio.
Revisar también variables compartidas, heredadas o procedentes de integraciones.

| Variable                   | Production Demo                                                         | Preview de `staging`                                                                                        |
| -------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `DEMO_MODE`                | Literal `true`                                                          | Literal `false`                                                                                             |
| `APP_URL`                  | `https://soloq-teal.vercel.app`, o el origen canónico real si cambia    | Origen HTTPS del alias/deployment de staging que se utilice; necesario para el control de origen            |
| `DATABASE_URL`             | Ausente del proceso y de su scope                                       | Conexión exclusivamente a Neon staging; verificar el endpoint `ep-falling-king-b6n6ybil` sin revelar la URL |
| `RIOT_API_KEY`             | Ausente                                                                 | Clave autorizada de desarrollo para el Preview protegido                                                    |
| `ADMIN_PASSWORD`           | Ausente                                                                 | Contraseña segura de al menos 16 caracteres                                                                 |
| `ADMIN_SESSION_SECRET`     | Ausente                                                                 | Secreto aleatorio de al menos 32 caracteres                                                                 |
| `CRON_SECRET`              | Ausente                                                                 | Secreto de al menos 32 caracteres si se utiliza el endpoint protegido                                       |
| `LADDER_SCHEDULER_ENABLED` | `false`                                                                 | `true` solo si el scheduler externo existe y se ha verificado; en caso contrario `false`                    |
| `DDRAGON_VERSION`          | Opcional: ausente para selección automática, o versión pública validada | Igual; no es un secreto                                                                                     |
| `RIOT_REQUEST_INTERVAL_MS` | No necesario                                                            | `1300` o un intervalo superior; no disminuir la política existente                                          |

Además, revisar manualmente:

1. Production branch `main`; esta tarea conserva todos sus cambios solo en staging.
2. Runtime Node **24.x**, compatible con el proyecto y usado en la validación.
3. Build command `npm run build`, sin `db:migrate`, scripts de backfill ni comandos de
   inicialización de base en build/install/deploy hooks.
4. Production accesible al público cuando se autorice el lanzamiento. Preview de
   staging conserva Vercel Authentication; no desactivar su protección para la demo.
5. Ausencia de cron de Production tras la futura promoción. No tocar el scheduler
   externo, sus headers secretos, el bypass de automatización o variables de Preview.
6. Aplicar cambios de variables mediante un deployment nuevo; revisar nuevamente
   banner, rutas, API admin y no-op cron en ese deployment antes de promocionarlo.

## Validación reproducible

Con Node 24:

```bash
npm run lint
npm run typecheck
npm run test
node scripts/validate-production-demo.mjs
```

El último comando ejecuta **`npm run build`** y `next start` en una copia temporal
permitida por lista explícita. No copia `.env*`, `.git`, `CLAUDE.md`, `.claude/` ni
`drizzle/`. Descarta variables heredadas de aplicación y establece solo el modo demo,
el origen local y opciones del proceso de validación. No modifica `.env.local`.
Reutiliza las dependencias instaladas mediante un enlace que retira antes de eliminar
la copia. Solo adapta el root de Turbopack en el archivo de configuración temporal.

`demo-network-guard.cjs` se precarga exclusivamente en los hijos de validación. Bloquea
conexiones PostgreSQL y destinos de red no permitidos antes de realizar la conexión.
Solo permite loopback, IPC de los workers y Data Dragon público. Una marca de intento
bloqueado hace fallar la validación incluso si la aplicación captura el error.
Ese interceptor no se activa en deployments.

Las regresiones espían la creación del cliente PostgreSQL y cada llamada fetch:
cualquier acceso SQL o Riot autenticado hace fallar la suite demo. Incluyen cookies
residuales, JSON/IDs inválidos y credenciales dummy accidentalmente presentes. Las
pruebas existentes de modo real utilizan dobles o bases efímeras locales.

Resultados de RC1:

- `npm run lint`: pasa.
- `npm run typecheck`: pasa.
- `npm run test`: 261 pruebas, 20 archivos; incluye 22 casos demo.
- `npm run build`: pasa en el entorno aislado, Node 24.19.0 y Next 16.3.8.
- Runtime de producción: 39 comprobaciones HTTP de páginas y API; sin 500, sin
  intentos PostgreSQL o Riot autenticado y sin errores de migración/configuración.
- Navegador: búsqueda de un jugador, enlace al perfil, resumen de cinco partidas,
  expansión a diez, página siguiente y regreso; navegación a métricas, filtro 7d y
  cambio SoloQ/Flex manteniendo período; gráficos y premios presentes.

## Archivos del ajuste

- Seguridad: `src/db/index.ts`, `src/server/auth.ts`, `src/server/http.ts`,
  `src/server/riot/client.ts`, `src/server/signature-baseline.ts`.
- Cron/configuración: `src/app/api/cron/sync/route.ts`, `vercel.json`.
- Páginas/textos: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/metrics/page.tsx`,
  `src/app/player/[id]/page.tsx`, `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`.
- Componentes: `src/components/shell.tsx`, `src/components/leaderboard.tsx`,
  `src/components/rank-chart.tsx`, `src/components/lp-delta-summary.tsx`,
  `src/components/match-history.tsx`, `src/components/history-status.tsx`.
- Pruebas: `tests/production-demo.test.tsx`, `scripts/demo-network-guard.cjs`,
  `scripts/validate-production-demo.mjs`.
- Documentación: `AGENTS.md`, `docs/STAGING_SYNC.md`, este informe.

## Pendientes y recomendación

El propietario debe completar identidad y contacto, confirmar las condiciones de
alojamiento/conservación y la revisión aplicable a su jurisdicción, y acreditar el
estado del producto en Riot Developer Portal. La demo no afirma aprobación de Riot.
También debe revisar los scopes reales de Vercel: `DEMO_MODE=false` accidental en
Production no se transforma automáticamente en demo y exige las dependencias reales.

La dependencia permitida de Data Dragon/CDN puede afectar imágenes o catálogo si
está indisponible; los emblemas y campeones siguen teniendo recursos locales. No se
validó un deployment remoto ni una sincronización real de staging en esta fase.

Recomendación: cerrar los pendientes del propietario, autorizar por separado la
publicación del commit en `origin/staging` y validar Vercel Preview. Promocionar a
`main` solo con autorización explícita posterior y configuración Production Demo
revisada. No aplicar 0004/0005 en Production para servir esta demo. No avanzar a
03.B.4 dentro del release candidate.
