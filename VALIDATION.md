# Validación de historial de temporada y métricas

Validación realizada el 6 de octubre de 2026 (America/Santiago), en la rama Git
`staging`, con Neon `staging` y Riot Development API Key. Production no fue utilizada.

| Verificación | Resultado |
| --- | --- |
| `npm run lint` | Correcto |
| `npm run typecheck` | Correcto |
| `npm run test` | 86 tests, 8 archivos, todos correctos |
| `npm run build` | Correcto, Next.js 16.3.8 |
| Backfill real y reanudación | 16 lotes, 393 / 393 IDs procesados, estado completed |
| Historial real compatible | 357 partidas; primera: 1 de marzo de 2026; 317 anteriores a 30 días |
| Incremental posterior | HTTP 200, complete, 0 participaciones nuevas/duplicadas |
| Historial de rango | Dos snapshots reales del jugador; no se crearon snapshots al importar partidas antiguas |
| Revisión local en navegador | Métricas, filtros, colas, perfil y estados de importación; escritorio y móvil |
| Vercel Preview | Pendiente de validación manual del usuario; requiere autenticación Vercel |

Los tests de PostgreSQL embebido cubren paginación de 0, 1, 99, 100, 101 y 205 IDs,
preservación del cursor ante 403, deadline y detalles 404, idempotencia, cambio de
temporada y consulta Season/30d/7d sin eliminación. También verifican el inicio de
un lote durante el alta, exclusión de remakes, forma reciente limitada a 20 partidas,
umbrales de muestra y separación entre partidas y snapshots. Los deltas observados
exigen resultados compatibles; ascensos y descensos permanecen indeterminados.

La prueba real utilizó un jugador existente de staging (Red Raiot). Los 393 IDs
incluyen modos excluidos, mientras que las 357 partidas guardadas son compatibles;
los agregados de rendimiento excluyen además remakes. Completar el recorrido indica
que se agotó lo que Riot devolvió, no que Riot conserve toda la temporada desde enero.
El resto del roster mantiene su progreso y continúa mediante Administración o cron.

Evidencia local, excluida de Git, en `artifacts/season-validation/`:
`staging-before.json`, `staging-batches.json`, `staging-incremental.json`,
`staging-after.json` y `profile-mobile.png`. No contiene secretos ni PUUID.

No se modificó `.env.local`, no se generaron ni aplicaron migraciones nuevas y no
se desplegó en Production. La apertura del Preview protegido fue detenida por la
revisión automática al requerir acceso al proveedor de autenticación. El usuario
indicó que revisará Preview personalmente.

## Registro de la primera versión

Validación realizada el 4 de octubre de 2026 (America/Santiago).

| Verificación | Resultado |
| --- | --- |
| Instalación de dependencias y lockfile | Completada |
| `npm run db:generate` | Migraciones de esquema y RLS generadas |
| Migraciones ejecutadas en PostgreSQL embebido (PGlite) | Correctas |
| `npm run lint` | Correcto, sin errores ni warnings |
| `npm run typecheck` | Correcto |
| `npm run test` | 38 tests, 4 archivos, todos correctos |
| `npm run build` | Correcto, Next.js 16.3.8 |
| `npm audit --omit=dev` | 0 vulnerabilidades reportadas |
| Bundle público | Sin referencias a las variables de secretos del servidor |
| Exclusiones Git | `.env.local`, dependencias, caché y artefactos locales ignorados |

## Cobertura funcional

Dominio: queues, exclusión de modos, ranking oficial, divisiones y LP, winrate,
KDA, KP, agregaciones y routing. Cliente Riot: schema de respuestas, PUUID,
encoding, 429/Retry-After, retries limitados y deadline. Se verificó por separado
la diferencia ASIA/SEA entre ACCOUNT-V1 y MATCH-V5.

Integración: esquema PostgreSQL real ejecutado por PGlite, RLS sin políticas para
roles públicos, PUUID único, partidas idempotentes, snapshots de cambios,
reanudación tras fallo parcial, cascadas y conservación de partidas compartidas,
lease/cooldown entre ejecuciones y limitación atómica de login. Las consultas
públicas calculan agregados, ocultan perfiles pausados y no devuelven PUUID.
Las sesiones se prueban con almacenamiento real, hash, expiración, logout y
rotación del secreto. Riot y el contenedor de cookies se simulan en estos tests.

## Revisión en navegador

Se probaron las pestañas SoloQ/Flex/5v5, búsqueda, búsqueda sin resultados,
filtro de región, ordenación, perfil individual, gráfico de rango y entrada
administrativa deshabilitada en demo. Se revisaron los assets oficiales y la
ausencia de errores de consola durante esa navegación.

En la vista móvil se corrigió un desbordamiento causado por la etiqueta accesible
de la tabla. El documento cabe en el viewport; la tabla conserva su desplazamiento
horizontal propio para mantener legibles las columnas.

Las páginas principales, perfiles demo, administración y páginas legales
responden correctamente. La API del roster devuelve HTTP 401 sin sesión.
Next.js puede devolver HTTP 200 con la vista de no encontrado cuando la respuesta
ya comenzó a transmitirse; `notFound()` incorpora la indicación `noindex`.

La captura local de revisión está en `artifacts/soloq-preview.jpg` (excluida de Git).

## Alcance pendiente

No se proporcionaron credenciales Riot ni una base alojada, por lo que no se
afirma haber probado la integración con una cuenta real, la conexión de red a
Neon/Supabase ni un despliegue en Vercel. La implementación real está separada de
la demo y preparada para configurarse con los pasos del README.

La auditoría completa conserva cinco avisos altos en dependencias transitivas de
desarrollo del tooling ESLint/Next (`braces` y sus dependientes), sin corrección
estable disponible en el registro consultado. Las dependencias de producción
no tienen avisos reportados. Se documentan la compatibilidad con ESLint 9 y el
override de esbuild en el README.

## Validación Δ SEMANA y contador global — 2026-10-06

- Rama `staging`; conservado todo el trabajo previo. Sin push, merge, despliegue ni cambios en Production o `.env.local`.
- `npm run lint`, `npm run typecheck`, `npm run test` y `npm run build`: PASS con Node 24. Tests: 122 en 10 archivos.
- Casos semanales: signos/0, +154/-130, magnitudes >100, divisiones, promociones/descensos, Diamond→Master, continuidad Master/GM/Challenger y caída apex; baseline ausente, exacto lunes, anterior al lunes, reset de contadores y timestamps inválidos; Santiago invierno/verano y ambos cambios DST.
- PostgreSQL aislado: historial de más de 30 snapshots mantiene baseline; SoloQ/Flex separados; 5v5 sin delta; no puente de temporadas; metadata global al completar, preservada en parcial/error/trabajo individual; leases abandonados, endpoint público solo lectura y servicio global completo frente a backfill parcial.
- Polling con reloj controlado: requests cada 15 s, ninguno por tick visual de 1 s; sin solapamiento; abort al desmontar; pestaña oculta; recuperación tras fallo; refresco una sola vez por éxito nuevo.
- Migración `0004_far_wiccan.sql`: cuatro ADD COLUMN nullable a `sync_locks`, revisados y probados en PostgreSQL aislado; aplicada únicamente al host de Neon staging confirmado por el usuario. Sin alteración de matches/snapshots ni eliminación de migraciones previas.
- UI desktop (1280 px) y móvil (390 px): +154/-130/0/— legibles, alas completas; móvil scrollWidth 375 < viewport 390. Capturas en `artifacts/weekly-validation/desktop.png` y `mobile.png`, con datos ficticios claramente identificados.
- Auditoría visual `/dev/ladder`: `00:02 → Actualizando… → nuevo ciclo`; el render del servidor cambió de 20:16:41.902Z a 20:16:59.508Z tras detectar el éxito simulado. No escrituras ni Riot en la simulación.
- Build local con NODE_ENV=production: auditoría rechazada por `notFound()`, sin título/fixtures. Next devuelve HTTP 200 por streaming de su loading boundary y codifica el fallback 404; es el comportamiento documentado de esta versión.
- Home real local: 16 jugadores, columna entre LP y WR, `—` cuando no existe baseline real anterior al lunes. Metadata muestra running durante el proceso real y schedulerConfigured=false.
- Scheduler: no existe job de 10 minutos en staging. Cron diario existente de Production intacto. Configuración externa de runner/autenticación Preview pendiente y documentada en README; no se configuró infraestructura ni se declaró el scheduler activo.
- Validación manual en Vercel Preview pendiente del usuario; se continuó localmente por el límite de autenticación ya acordado.
- Sync real local contra Neon staging: HTTP 200, 1 jugador complete y 8 partial antes del límite global; metadata `never → running → partial`. `lastSuccessfulSyncAt` y `nextExpectedSyncAt` permanecieron null (no se fabricó éxito ni se reinició el contador). Informe sin secretos: `artifacts/weekly-validation/staging-sync.json`. El progreso de backfill se conserva para posteriores ejecuciones.

## Corrección del regreso desde perfil — 2026-10-06

- `Volver a la clasificación` usa ahora un enlace HTML con navegación completa, independiente del router cliente. Conserva `?queue=soloq`, `flex` o `5v5`.
- Verificado con clics de navegador desde el perfil real de ReZzix en las tres colas; retorno a la clasificación correspondiente.
- Lint sin warnings, typecheck, 122 pruebas y build: PASS. Sin cambios en datos, Riot, `.env.local` o Production.

## Visibilidad del contador — 2026-10-06

- Estado de sincronización movido a una línea propia sobre la tabla, fuera del título y filtros. Incluye icono, etiqueta Próxima actualización y texto de mayor contraste; aplica a SoloQ, Flex y 5v5 y permite wrap móvil.
- Sin próxima hora válida muestra —:—, con motivo de ausencia/intento parcial/fallido. Mantiene el aviso de programación pendiente y los mismos timestamps, polling y refresco; no se inventa un ciclo de 10 minutos.
- Lint, typecheck, 122 pruebas y build: PASS. Sin cambios de datos, scheduler, `.env.local` o Production.
- Inspección visual de esta revisión pendiente: la política de seguridad del navegador rechazó el acceso a la pestaña abierta; no se intentó sortear el bloqueo.

## Acceso superior a métricas — 2026-10-06

- Añadido botón Ver métricas con icono junto a las pestañas de cola, antes de la ladder. Conserva la cola actual en `/metrics?queue=…`; el layout permite wrap en móvil.
- Lint, typecheck, 122 pruebas y build: PASS. Revisión visual pendiente por el bloqueo del navegador informado anteriormente. Sin cambios de datos ni de Production.
