# Fase 03.B.6 — seguimiento real de sincronización

Implementación local sobre `staging`, base
`f9c0fd0470dd7e6ed42ebb0c2b561e6627c834c0`. No se ha aplicado la migración
a Neon ni publicado código. Production Demo permanece aislada. La validación
remota de 03.B.5 procede del usuario; no acredita este cambio.

## Diseño y persistencia efectivos

Se mantiene el lease único PostgreSQL `riot`, sin otro lock, heartbeat,
renovación, scheduler ni trabajo en background. La adquisición del lease y el
inicio de una ejecución se confirman en una sola transacción. UUID de run generado
por servidor, distinto del UUID privado de owner. UUID opcional del navegador
correlaciona una solicitud antes de recibir el POST síncrono final; no es una credencial.

`sync_locks.run_progress` contiene un sobre `{ version: 1, latest, previous }`.
Solo retiene dos ejecuciones de sincronización. PATCH/DELETE y el mantenimiento
de remakes usan el mismo guard de escritura sin generar runs ni expulsar resultados
terminales. Al sustituir un propietario con run todavía running se conserva como
interrupted, con hora de observación de la pérdida y sin inventar finishedAt.
La correlación ya retenida no puede iniciar nuevamente trabajo: 409 y rollback
de la adquisición. Esto no es idempotencia perpetua ni autorización mediante UUID.

Esquemas Zod compartidos validan JSON y DTO, y eliminan claves desconocidas.
NULL, versión desconocida o JSON inválido significan seguimiento desconocido;
no se reconstruyen runs desde timestamps de jugadores.

Los campos incluyen acción, origen admin/cron, temporada, jugador UUID si aplica,
fase, inicio, inicio de fase, último checkpoint, finalización, revisión, resultado
reciente independiente, pases recientes/históricos y estados por jugador.
No se duplican nombres, PUUID, detalles de partidas, LP ni mensajes de error libres.
Los errores del run son únicamente código y paso allowlisted. Los diagnósticos
existentes por jugador siguen siendo la fuente del estado persistente de temporada.

## Exclusión, escrituras y checkpoints

`syncWrite` toma **la misma fila del lease** con FOR UPDATE antes de tocar datos
de negocio. Compara owner, run ID, revisión y estado vigente; revalida expiración
con clock_timestamp PostgreSQL al final. Participación, cursor y checkpoint
publicado se confirman juntos o se revierten. La finalización verifica también
propiedad/revisión bajo ese lock y condiciona el UPDATE a una expiración vigente;
cero filas no representa éxito. Un worker obsoleto no puede liberar ni sobrescribir
la nueva ejecución. No hay fetch Riot ni sleeps dentro de transacciones de producción.

El contexto privado se asocia mediante WeakMap **al cliente Riot de esa adquisición**,
no a una variable global de propietario. Esta es la diferencia de implementación
respecto de pasar un contexto extra a cada función: conserva firmas de dominio
existentes. Todos los entrypoints productivos y el script de remakes vinculan su
cliente mediante withSyncLease. Las llamadas directas sin lease conservan su contrato
para pruebas de dominio; no deben añadirse como entrypoints de producción.

Checkpoints obligatorios: selección, fase, verificación oficial persistida,
cobertura reciente completa, resultado del turno y finalización. Cambiar de fase
no acredita éxito. La fecha de verificación/cobertura conserva exactamente el
campo de negocio; tiempos del lease y checkpoints usan reloj DB.

Importaciones/cursor intermedios se agrupan: se publica como máximo una actualización
intermedia por 15 segundos, además de los checkpoints obligatorios. Las actualizaciones
de cursor y participaciones siempre se guardan. Se cuentan exclusivamente inserts
RETURNING nuevos, después del commit; deduplicados, excluidos y 404 no son nuevas
participaciones. El checkpoint histórico captura contadores existentes y cursor.
Al completar conserva el final de la ventana explorada aunque el cursor de negocio
se prepare para la siguiente ventana. Los contadores de reparación incremental
de temporada son NULL y no aparentan un total definitivo.

Si el proceso muere entre una unidad de negocio y el siguiente flush, la telemetría
puede subestimar hasta los avances agrupados. El cursor de negocio no se pierde.
No reconstruirlos ni atribuirlos retroactivamente a otro run. La siguiente ejecución
continúa desde el cursor existente. Fair Scheduling, presupuestos, lotes, pacing

> =1300ms, reintentos Riot y Retry-After no cambian.

## API y estados

GET `/api/admin/sync/progress` exige sesión admin en cada lectura y rechaza demo
antes de consultar PostgreSQL. Es force-dynamic, no-store incluso en errores,
sin mutaciones, Riot o reintentos. Selector opcional único `runId` o `requestId`,
UUID válido; selector mal formado/desconocido devuelve 400. Sin selector consulta
latest; selector inexistente o expulsado devuelve 200 not_found, jamás otro run.

Forma resumida (el contrato completo está en `src/lib/sync-progress.ts`):

```json
{
  "version": 1,
  "serverNow": "2026-10-09T12:00:00.000Z",
  "selection": "not_found",
  "control": { "state": "available", "until": null, "reason": null },
  "run": null
}
```

Con run, los estados son running/completed/partial/failed/interrupted/
possibly_interrupted. `activity` explica lease_valid/lease_expired/ownership_lost/
not_running. **Running solo acredita inicio registrado y lease vigente**, no que
el proceso esté vivo. Expiración deriva possibly_interrupted sin escribir. Nuevo
owner acredita interrupted. Ninguno inventa finalización.

El control es independiente: available/lease_held/cooldown/busy_unknown, until y
motivo pacing/riot_retry_after cuando hay evidencia. Un resultado completado puede
estar en cooldown; un run propio terminado puede coexistir con otro lease ocupado.
Un lease legacy o de PATCH/DELETE puede tener busy_unknown. El GET normalmente
hace dos SELECT acotados (sesión + fila por PK), sin consultas por jugador/partida.

`recentOutcome` y las marcas globales existentes conservan su semántica:
recientes completos pueden coexistir con histórico parcial o fallido. El estado
del run describe ambas pasadas; error nuevo de una fase da failed, pendientes
por presupuesto dan partial. Errores anteriores de players no se atribuyen a este run.
Importar un lote no acredita cobertura completa ni historial de temporada completo.

POST global, individual, backfill y alta aceptan `X-SoloQ-Sync-Request-Id` opcional
UUID. Respuestas conservan contratos/códigos previos y añaden runId/requestId donde
se conoce adquisición. Los errores posteriores también llevan identidad cuando
el lease pudo finalizar el manejo. La correlación por GET funciona si se pierde
la respuesta. No se añade POST 202 ni ejecución desacoplada.

## Frontend y recuperación

El runner síncrono sigue evitando doble activación antes del render. Se guarda
requestId/acción/inicio local en sessionStorage antes del único POST. Se omite
un run SSR anterior hasta leer la correlación guardada; tras reload solo se manda
GET. Sin correlación se muestra latest como **ejecución observada**, sin atribuir
su progreso a una acción rechazada del navegador. Rechazos definitivos previos al
run limpian la correlación; errores de red/resultados ambiguos la conservan.

El controlador serial usa setTimeout tras cada lectura, aproximadamente 15 s;
timeout GET de 10 s, pausa/abort al ocultar, lectura al volver visible, cleanup al
desmontar y al cerrar sesión. Pin por runId tras la primera coincidencia. Descarta
run ajeno, timestamp anterior, revisión inferior y respuesta de controlador desmontado;
acepta cambio derivado por expiración con la misma revisión.

Backoff de lecturas 15/30/60 s; 429 respeta Retry-After; 401 y 503 detienen retries
automáticos. No se reintenta ninguna mutación. Terminal/interrupción detiene spinner
y polling continuo, refresca roster una vez y permite una lectura al vencer cooldown
o manual. Sin run correlacionado: ventana de observación hasta 330 s desde activación,
después resultado desconocido y consulta manual. Ese plazo no cancela el servidor.

UI conserva estilos oscuros, feedback accesible y fallback indeterminado de 03.B.5.
Muestra operación/jugador, fase iniciada, fechas y contadores confirmados, pendientes,
errores y detalle por jugador. Sin porcentajes ni ETA. No anuncia cada contador ni
cada lectura en aria-live; fase/resultado tienen status polite y detalles son silenciosos.
El botón de consulta tiene mínimo 44px. Cambios de red dejan visible el checkpoint
anterior con aviso de observación posiblemente desactualizada.

No se usa SSR para atribuir automáticamente un run al navegador: se hace una lectura
inicial adicional a la del contexto, evitando problemas de hidratación/correlación.
Cuatro lecturas/minuto por pestaña visible durante trabajo; cero polling periódico
cuando idle sin run. No se garantiza detectar inmediatamente acciones de otra pestaña
mientras está idle. Dos runs retenidos no constituyen auditoría permanente.

## Migración revisada y despliegue

`drizzle/0006_sync_run_progress.sql`, generado desde cambio real de schema:

```sql
ALTER TABLE "sync_locks" ADD COLUMN "run_progress" jsonb;
```

Una sola columna nullable, sin default, backfill, índice ni cambio de registros de
players/partidas/snapshots. Journal 0000–0005 intacto; snapshot 0006 encadena al 0005.
Compatible con escrituras anteriores; filas existentes quedan NULL. ALTER requiere
un lock DDL de PostgreSQL, por eso debe aplicarse sin writers en curso. La generación
usó configuración local sin cargar .env ni conectarse a una base.

Orden **futuro, con autorizaciones separadas**:

1. Revisar commit, SQL y resultados locales. No publicar primero: el código selecciona
   la columna y no es compatible con una base que aún no la tiene.
2. Ventana de staging: no permitir nuevas acciones ni tráfico de escritura a antiguos
   Preview/deployments; esperar finalización/vencimiento. No crear scheduler.
3. Preflight readonly: confirmar proyecto/rama/endpoint staging, precedencia de URL
   efectiva sin revelar secretos, migraciones aplicadas exactamente 0000–0005,
   único pendiente 0006, ausencia de otras migraciones y respaldo/restauración adecuados.
   Toda ambigüedad detiene el procedimiento. No acceder a Production.
4. Con autorización explícita para migración, ejecutar una vez `npm run db:migrate`
   existente sobre Neon staging. No ALTER manual ni cambios al runner/config/secretos.
5. Postflight readonly: jsonb nullable/NULL inicial, journal 0006, mismos conteos de
   jugadores/partidas/participaciones/snapshots y ninguna eliminación/modificación histórica.
6. Con autorización de publicación, push fast-forward exclusivo origin/staging.
   Esperar Preview y confirmar SHA/deployment remoto antes de probar la funcionalidad.
7. Con autorización de sincronización real acotada, validar global/individual/histórico,
   GET autenticado/no-store, reload durante POST, dos pestañas, finales/cooldown y cursores.
   Medir tamaño JSON, latencia GET/SQL, overhead y consumo real. No provocar 429 reales.
8. Autorizar uso normal de staging solo después de esa validación. No promover a main
   ni configurar cron como consecuencia de esta fase.

Rollback: detener solicitudes, drenar/vencer writers y volver al código anterior.
**Conservar columna, migración/journal y datos de negocio**, sin DROP ni borrar
migraciones. No mezclar tráfico de writers antiguos sin fencing con los nuevos.
Un JSON incompatible queda desconocido; respaldo completo solo ante daño acreditado
y autorización independiente. La Production Demo no requiere esta migración.

## Validación local y límites

Pruebas en PGlite efímero: migración con fila previa y valores intactos, metadata
Drizzle, dominio/checkpoints, selección/elegibilidad, cursor progresivo y dedup,
rank sin cambios/fallo reciente, expiración dentro de write, owner/revisión obsoletos,
dos runs/evicción, GET auth/no-store/sanitización, cooldown y correlación POST.
Pruebas con reloj/fetch simulados: polling serial, hidden/unmount, respuesta perdida,
reload de sessionStorage, respuestas ajenas/obsoletas, 429/backoff y fin desconocido.
Demo prueba GET nuevo antes de DB/Riot incluso con cookie residual.

`node scripts/validate-sync-progress-postgres.mjs` ejecuta además cuatro regresiones
contra PostgreSQL 17 local con pools/conexiones independientes: adquisición simultánea,
espera real por lock de fila, rollback por vencimiento y takeover frente a worker viejo.
Usa imagen Docker ya instalada (`--pull=never`), tmpfs, puerto exclusivamente loopback,
base de prueba sin credenciales reales; elimina su contenedor/config temporal al terminar.
La suite correspondiente se omite en `npm run test` cuando no hay configuración QA;
se debe ejecutar el validador para acreditar estas cuatro pruebas. Nunca usa DATABASE_URL.

Build/smoke mediante `node scripts/validate-production-demo.mjs`: ejecuta `npm run build`
en copia aislada sin .env/secretos y prohíbe PostgreSQL y Riot autenticado; incluye
GET de progreso 503. No ejecutar un build del checkout con .env.local apuntando a Neon.

Límites: sin timeout SQL cancelable nuevo ni renovación de lease. Transacciones cortas
y fencing reducen riesgo, pero no acreditan latencia bajo carga de Neon/Vercel. Retención
de dos runs y flush agrupado son deliberados. No acredita progreso total de temporada,
vitalidad de proceso, capacidad económica ni éxito remoto. QA visual local con datos
sintéticos: escritorio y iframe móvil de 390px, resumen y expansión de 18 jugadores,
sin desbordamiento horizontal (375px de contenido/viewport tras scrollbar), estados
running/partial/possibly_interrupted. Fuentes fallback locales y render estático, no
se acredita el flujo autenticado del Preview mediante esa QA. Este último debe
completarse después del despliegue autorizado.

## Archivos de esta fase

Validación final local del 9 de octubre de 2026:

- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `npm run test`: 321 PASS; cuatro pruebas Docker omitidas sin config temporal.
- `node scripts/validate-sync-progress-postgres.mjs`: esas cuatro pruebas PASS
  en PostgreSQL 17 con conexiones independientes; contenedor/config eliminados.
- `npm run build`: PASS en la copia aislada creada por
  `node scripts/validate-production-demo.mjs`; smoke HTTP PASS y bloqueo DB/Riot activo.
- QA estática local de escritorio/móvil con datos sintéticos: PASS para lectura,
  expansión y ausencia de overflow; no equivale a validar el Preview autenticado.

No se realizó push, migración remota, sincronización real ni despliegue. La migración
0006 está propuesta y validada localmente, **no aplicada a Neon**.

| Área               | Archivos modificados o nuevos                                                                                                                                                                                                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contrato y polling | `src/lib/sync-progress.ts`, `src/lib/admin-progress-polling.ts`, `src/lib/admin-operation.ts`, `src/lib/admin-errors.ts`, `src/lib/admin-sync.ts`                                                                                                                                                                                                         |
| Persistencia       | `src/db/schema.ts`, `drizzle/0006_sync_run_progress.sql`, `drizzle/meta/0006_snapshot.json`, `drizzle/meta/_journal.json`                                                                                                                                                                                                                                 |
| Lease/checkpoints  | `src/server/sync/progress.ts`, `src/server/sync/lease.ts`, `src/server/sync/service.ts`, `src/server/sync/player-state.ts`, `src/server/sync/recent.ts`, `src/server/sync/history.ts`                                                                                                                                                                     |
| API/admin          | `src/server/http.ts`, `src/server/admin-queries.ts`, `src/app/api/admin/sync/progress/route.ts`, `src/app/api/admin/sync/route.ts`, `src/app/api/admin/players/route.ts`, `src/app/api/admin/players/[id]/route.ts`, `src/app/api/admin/players/[id]/sync/route.ts`, `src/app/api/admin/players/[id]/backfill/route.ts`, `src/app/api/cron/sync/route.ts` |
| UI                 | `src/components/admin-panel.tsx`, `src/components/admin-operation-feedback.tsx`, `src/components/admin-run-feedback.tsx`, `src/components/use-admin-progress.ts`, `src/app/globals.css`                                                                                                                                                                   |
| Mantenimiento/QA   | `scripts/backfill-remakes.ts`, `scripts/validate-production-demo.mjs`, `scripts/validate-sync-progress-postgres.mjs`                                                                                                                                                                                                                                      |
| Pruebas            | `tests/database.test.ts`, `tests/production-demo.test.tsx`, `tests/sync-progress.test.tsx`, `tests/sync-progress-migration.test.ts`, `tests/sync-progress-postgres.test.ts`                                                                                                                                                                               |
| Documentación      | `docs/REAL_SYNC_PROGRESS_DESIGN.md`, `docs/REAL_SYNC_PROGRESS.md`, `docs/SYNC_UX.md`                                                                                                                                                                                                                                                                      |

El diseño previo se incluye porque era un documento local no publicado de esta
misma fase. Artefactos de QA bajo `artifacts/` no se incluyen en el commit.
CLAUDE.md/.claude y .env.local se mantienen intactos; ningún fixture público cambia.
