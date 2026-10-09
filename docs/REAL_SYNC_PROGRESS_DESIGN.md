# Fase 03.B.6, paso 1 — diseño del seguimiento real

Estado: diseño autorizado e implementado localmente en 03.B.6. Véase
[REAL_SYNC_PROGRESS.md](REAL_SYNC_PROGRESS.md) para el contrato efectivo, validación
y procedimiento de despliegue. Las secciones siguientes conservan la propuesta
y el diagnóstico de la base anterior, no describen una migración ya aplicada.
Base revisada: `staging`, `f9c0fd0470dd7e6ed42ebb0c2b561e6627c834c0`.
Fecha: 9 de octubre de 2026. La validación de Preview de 03.B.5 procede del
contexto del usuario; este trabajo no consulta deployments, Neon ni Riot.

## 1. Diagnóstico de la arquitectura actual

| Archivo / función                                    | Comportamiento comprobado                                                                                                                | Implicación para seguimiento                                                                                                                |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/sync/lease.ts`, `withSyncLease`          | Adquisición atómica de la fila `riot`; UUID privado de propietario; reemplazo solo después de vencer; liberación compara propietario.    | Es el único mecanismo de exclusión. `expiresAt` describe ocupación o cooldown, no actividad demostrada de un proceso.                       |
| `src/db/schema.ts`, `syncLocks`                      | `name`, `owner`, `expiresAt` y cuatro marcas del resultado global.                                                                       | No hay identificador de ejecución pública, progreso ni resultado individual durable en esa fila.                                            |
| `src/server/sync/service.ts`, `syncAllPlayers`       | Dos pasadas seriales y callbacks globales de éxito/outcome/cooldown.                                                                     | Hay puntos concretos para publicar selección, turnos y resultados sin cambiar su orden.                                                     |
| `syncPlayer`                                         | Persiste el rango y snapshots en una transacción; después comienza recientes.                                                            | Una verificación de rango puede estar guardada aunque recientes falle. Se debe conservar esa distinción.                                    |
| `recent.ts`, `importRecent`                          | Deduplica participaciones; cada inserción es transaccional. Solo avanza `lastSyncedAt` al agotar la ventana.                             | Importar partidas no equivale a completar cobertura. El offset local no es cursor reciente durable.                                         |
| `history.ts`, `importHistory`                        | Página de IDs/cursor persistidos; participación y retirada del ID pendiente atómicas.                                                    | Son avances verificables. `processed` incluye existentes, excluidos y 404; no significa partidas nuevas.                                    |
| `player-state.ts` y `PlayerSyncState`                | Última fase por jugador; errores independientes y marcas oficiales/cobertura.                                                            | Es diagnóstico de temporada, no una secuencia de eventos atribuible a un run. No reconstruir runs antiguos desde esas fechas.               |
| POST global / individual                             | Responden al terminar, con duración máxima declarada de 300 s.                                                                           | El navegador no conoce un UUID generado en el servidor hasta recibir la respuesta final, salvo añadir correlación previa.                   |
| POST `players/[id]/backfill`                         | Ejecuta `syncPlayer` y después `syncBackfillPlayer`, con el mismo lease.                                                                 | «Continuar historial» incluye rango y recientes; no mostrar histórico activo antes de alcanzarlo. Devuelve `results`, no un outcome global. |
| POST de alta                                         | Lease, identidad, inserción y sincronización inicial; presupuesto de 35 s; puede devolver 201 con sincronización pendiente.              | Promesa resuelta/HTTP 201 no acredita éxito de todas las fases. Conviene reconocer este consumidor del lease.                               |
| PATCH/DELETE y `scripts/backfill-remakes.ts`         | También adquieren el lease compartido.                                                                                                   | No deben parecer una sincronización global ni dejar un run anterior como activo al cambiar el propietario.                                  |
| `admin-queries.ts` / `admin/page.tsx`                | Contexto con `serverNow`/`leaseUntil`, roster y diagnósticos sanitizados.                                                                | Se puede ampliar esa lectura del lease para el estado inicial sin N+1.                                                                      |
| `admin-operation.ts`, `admin-operation-feedback.tsx` | Guard síncrono, reloj local e indicador indeterminado; sin polling de progreso.                                                          | Mantenerlos como fallback y separar espera local de inicio confirmado en servidor.                                                          |
| `status.ts`, `/api/ladder/sync-status`               | Metadatos públicos del último global. Individuales no modifican sus callbacks.                                                           | No convertir ese GET público en endpoint de progreso administrativo.                                                                        |
| `http.ts`, `auth.ts`, `env.ts`, `db/index.ts`        | `requireAdmin` rechaza demo antes de sesión/DB; auth de sesión consulta PostgreSQL. `json` aplica `no-store`; DB es lazy y rechaza demo. | Reutilizar los guards. Presupuestar también la consulta de autenticación en cada GET.                                                       |

Límites que permanecen: 230 s globales; recientes hasta 180 s, 30 s/12 despachos
por turno y cinco participaciones nuevas; histórico hasta 20 s/6 despachos y 25 IDs
por turno. Cliente serial, pacing mínimo de 1300 ms, timeout de request de 10 s,
tres intentos acotados y `Retry-After`. Lease de 330 s, sin renovación periódica.
La selección reciente e histórica es independiente. SQL todavía no tiene un
deadline cancelable nuevo.

La comparación del propietario protege hoy la liberación, pero no cada escritura
de negocio. Un worker que sobreviva al vencimiento podría continuar escribiendo:
riesgo confirmado en la estructura del código, no incidente operacional demostrado.
Un simple `UPDATE` de progreso condicionado al owner no resuelve ese riesgo.

Journal revisado: 0000–0005. 0005 añade cinco campos nullable a `players`; 0004
añade las marcas globales a `sync_locks`. No se puede acreditar el estado remoto
actual leyendo el journal local. No hay scheduler externo según el contexto del
usuario; no se configura ninguno en esta fase.

## 2. Decisión recomendada y alternativas

Añadir **una columna nullable JSONB `sync_locks.run_progress`**, en la fila `riot`.
Guardar un sobre versionado con el run más reciente y un run anterior. Mantener
owner/expiresAt y los callbacks globales existentes como autoridad del lease.
El run ID es distinto del owner y no constituye una credencial.

La comunidad pequeña y una única ejecución permitida hacen innecesarios índices,
joins o una cola. Dos snapshots permiten que una pestaña resuelva su respuesta
perdida si empieza inmediatamente otra sincronización. No constituyen un historial
permanente: una tercera ejecución puede expulsar la más antigua. Esa limitación
debe aparecer explícitamente en API/UI; nunca sustituirla por el resultado del run
actual. PATCH/DELETE no expulsan resultados terminales de sincronización.

| Alternativa                                                     | Decisión                                                                                                                                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tabla de ejecuciones, PK run ID y retención                     | Mejor para auditoría duradera, búsqueda de cualquier run o muchos jugadores. Añade tabla, política de limpieza e índices. Posponer hasta que exista ese requisito; no descartarla como arquitectura inválida. |
| Solo un snapshot JSON                                           | Cambio aún más pequeño, pero una siguiente ejecución borra inmediatamente el resultado de la pestaña anterior. Se recomienda conservar también el anterior dentro de la misma columna.                        |
| Reconstruir progreso desde marcas de jugadores                  | No identifica el run ni distingue checkpoints de otra solicitud. Descartado.                                                                                                                                  |
| Usar owner como run ID público                                  | Acopla observabilidad y exclusión; el DTO no debe publicar owner. Descartado.                                                                                                                                 |
| UUID solo al final del POST                                     | No permite correlacionar el polling inicial. Descartado.                                                                                                                                                      |
| POST 202 y trabajo en background, SSE/WebSocket, colas externas | Cambian ciclo de vida/hosting y recuperación. No se necesitan para observar el POST síncrono existente.                                                                                                       |
| Heartbeats, renovación del lease o segundo lock                 | Cambiarían las garantías de duración/exclusión. No se introducen.                                                                                                                                             |

Al terminar se conservan acción, origen, run ID, fases, checkpoints, contadores,
resultados por jugador y códigos sanitizados. No se guarda un log de eventos,
payloads Riot, detalles de partidas ni nombres de cuenta duplicados.

## 3. Esquema y contrato de persistencia propuestos

SQL ilustrativo para una **migración futura**, no generada ni ejecutada:

```sql
ALTER TABLE "sync_locks" ADD COLUMN "run_progress" jsonb;
```

Sin default, backfill, índice ni cambio en `players`. Filas existentes: NULL,
seguimiento desconocido. No inferir inicios anteriores. El número de migración
se asignará con el journal vigente al implementar (previsiblemente 0006 si no cambia).

Forma conceptual; tipos compartidos y validación runtime se crearían posteriormente:

```ts
type RunProgressEnvelope = {
  version: 1;
  latest: PersistedRun;
  previous: PersistedRun | null;
};
type PersistedRun = {
  runId: string; // UUID aleatorio generado por el servidor
  requestId: string | null; // Correlación UUID del navegador; no autorización
  leaseOwner: string; // SOLO interno: owner de la adquisición original
  source: "admin" | "cron";
  action: "global" | "player_recent" | "player_history" | "player_add";
  playerId: string | null; // UUID interno, nunca PUUID
  season: string;
  status: "running" | "completed" | "partial" | "failed" | "interrupted";
  phase: "planning" | "identity" | "rank" | "recent" | "history" | "finalizing";
  currentPlayerId: string | null;
  startedAt: string;
  phaseStartedAt: string;
  lastCheckpointAt: string | null;
  finishedAt: string | null;
  interruptionObservedAt: string | null;
  cooldownReason: "pacing" | "riot_retry_after" | null;
  revision: number;
  recentOutcome: "success" | "partial" | "failed" | null;
  recent: PassProgress | null;
  history: PassProgress | null;
  players: PlayerRunProgress[];
};
type PassProgress = {
  eligible: number; // Selección de jugadores de ESTA pasada
  visited: number; // Turnos cuyo comienzo quedó registrado
  settled: number; // Turnos con resultado explícito, incluso no atendidos
  complete: number;
  partial: number;
  errors: number;
  skipped: number;
  unvisited: number;
  imported: number; // Participaciones nuevas confirmadas en este run
};
type PlayerRunProgress = {
  playerId: string;
  rank: null | { checkedAt: string; outcome: "verified" };
  recent: PhaseProgress | null;
  history: PhaseProgress | null;
};
type PhaseProgress = {
  status: "queued" | "running" | "complete" | "partial" | "error" | "skipped";
  attempted: boolean;
  reason: string | null; // Enum cerrado: PendingReason o motivo de aborto
  error: null | { code: number | "internal" | "lease_lost"; step: string };
  imported: number;
  coveredThrough: string | null; // Solo recientes completados
  history: null | {
    season: string;
    mode: "season_backfill" | "incremental_repair";
    discovered: number | null;
    processed: number | null;
    unavailable: number | null;
    cursorPending: number;
    scanExhausted: boolean;
    scanThrough: string | null;
  };
};
```

Los string de fase/motivo/error serán enums validados; la notación no autoriza texto
arbitrario. No copiar `error.message`. Renderizar mensajes mediante una allowlist,
aprovechando `safeSyncError` cuando corresponda. `leaseOwner` permanece privado y
solo evita duplicar columnas: está dentro del JSON para vincular el run con su lease.

`revision` aumenta en cada cambio durable, incluso transición de fase. No es número
de partidas ni porcentaje. `lastCheckpointAt` acredita un resultado, selección o
avance guardado; una transición sin avance solo modifica fase/phaseStartedAt/revision.
`finishedAt` acredita la finalización registrada por el propietario; no se rellena
al inferir una interrupción. `interruptionObservedAt` describe la detección de pérdida
de propiedad, no la hora en que murió un proceso.

Recientes y selección histórica son NULL hasta que realmente se conocen. Los
contadores por pasada se derivan de resultados del mismo snapshot, no se suman
a partir de fechas legacy. Mientras hay trabajo, un jugador puede estar running
y todavía no settled. Al finalizar, cada seleccionado tiene resultado o motivo
explícito de no atención. `unvisited` y los estados finales pueden solaparse:
un no atendido tiene resultado partial y attempted=false. No sumar estas columnas
como categorías disjuntas ni convertir complete/eligible en porcentaje de ingesta.

Los contadores de temporada se capturan del cursor persistido al hacer checkpoint;
no son un total definitivo ni un incremento de partidas nuevas de ese run. Para
incrementales después de un backfill completo, no reutilizar contadores antiguos
como progreso incremental: mode incremental_repair, contadores de temporada NULL
y mostrar solo cursor e `imported`. Guardar cooldownReason al liberar, según el
resultado real observado; no deducir «Retry-After de Riot» solo por la duración del
lease. La expiración actual sigue siendo la fuente del instante de disponibilidad.

### Adquisición, correlación y protección del propietario

1. El navegador crea un `requestId` UUID con `crypto.randomUUID()` antes del POST,
   lo guarda en sessionStorage con acción/UUID interno del jugador y lo envía en
   `X-SoloQ-Sync-Request-Id`. No guardar cookies, credenciales ni PUUID.
2. Después de auth, Origin y validaciones, el servidor valida ese header opcional.
   Genera un `runId` y un owner independientes. Clientes anteriores y cron sin header
   siguen funcionando; su requestId es NULL y el run aparece al consultar latest.
3. La adquisición atómica existente guarda owner, expiración e inicialización del
   run en la misma operación/transacción. Ninguna llamada Riot ocurre antes del commit.
   Si no obtiene lease, devuelve 409 y no crea ni sobrescribe un run.
4. La correlación duplicada aún retenida se rechaza sin ejecutar trabajo: el cliente
   consulta su run. No se promete idempotencia permanente del header: con dos snapshots
   no se puede detectar todo requestId expulsado. Cada POST nuevo requiere intención
   explícita; nunca se reenvía automáticamente. El run ID servidor siempre es nuevo.
5. Al reemplazar un run running por vencimiento, conservarlo como previous con
   status interrupted y hora de observación; finishedAt sigue NULL. Una adquisición
   no instrumentada como run (PATCH/DELETE/mantenimiento) también debe invalidar la
   actividad del run anterior si reemplaza a su propietario. Conserva el resultado
   terminal y no crea un falso run de sincronización.

Propagar un contexto privado `{ owner, runId, ... }` desde `withSyncLease` a los
servicios. No usar variables globales de módulo ni recuperar el run «actual» para
escribir: un closure de un run antiguo debe conservar su ID antiguo.

Para cada unidad que modifica datos de sincronización:

- Abrir una transacción corta y bloquear **la misma fila `sync_locks/riot`** antes
  de tocar jugadores/partidas. Verificar owner, run ID si instrumentado, status running
  y expiración vigente usando hora DB. Si falla, abortar con `LeaseLost`, sin reintento
  ni nuevas llamadas Riot. No es un segundo sistema de locks.
- Aplicar las escrituras de negocio y, si corresponde, el checkpoint en esa transacción.
  Antes de completarla, volver a comprobar la expiración. Rollback si ya venció.
- No mantener esta transacción durante fetch, espera Riot o bucles de paginación.
  Orden uniforme: lease, luego datos. Mantener deduplicación y transacción
  participación+cursor. En errores, no escribir una marca fallida de un run obsoleto.
- Los límites de espera SQL cortos/locales deben probarse antes de fijarlos: una
  transacción que se bloquea indefinidamente también bloquea una nueva adquisición.
  No afirmar hard timeout de SQL con los límites Riot actuales.

El row lock impide que otro propietario se instale mientras se confirma esa unidad;
el chequeo final de tiempo evita commits tardíos conocidos. No cancela una llamada
Riot ya despachada ni prueba muerte física del worker. PostgreSQL conserva esos locks
hasta el fin de la transacción; `now()` representa su inicio, mientras que
`clock_timestamp()` refleja el reloj actual. Por eso el chequeo tras una espera debe
usar este último. Fuentes: [locks de PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html)
y [funciones de tiempo](https://www.postgresql.org/docs/current/functions-datetime.html).

Usar hora DB también para las nuevas marcas de progreso y evaluación GET; mantener
330 s y cooldown existentes. La implementación debe unificar el cálculo de expiración
del lease con esa hora, sin cambiar su duración ni renovar durante el trabajo.
Mantener deadlines locales del cliente Riot. Probar diferencias de reloj.

### Checkpoints y coste de escritura

| Punto                               | Información acreditada                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| Adquisición confirmada              | Inicio y planificación del run; aún no hay rango ni cobertura nueva.            |
| Selección de pasada guardada        | UUID internos de elegibles y resultados iniciales queued; no progreso Riot.     |
| Inicio persistido de fase/turno     | Jugador/fase y visited; únicamente intención registrada.                        |
| Transacción ranked confirmada       | Verificación oficial y snapshots que correspondan; incluso rango sin cambios.   |
| Inserciones recientes confirmadas   | Solo número realmente insertado; cobertura todavía pendiente.                   |
| Fin completo de recientes           | `lastSyncedAt` exacto y resultado complete, en la misma unidad durable.         |
| Cursor histórico/página confirmados | Descubrimiento/pending/offset real, sin publicar IDs de partidas.               |
| Participación + cursor confirmados  | Importadas, procesados y huecos 404 reales; nada se cuenta antes del commit.    |
| Fin de turno o aborto               | Resultado y motivos; los no atendidos no reciben intentos ficticios en players. |
| Liberación confirmada               | Resultado final + hora + cooldown en una operación condicionada al propietario. |

Escribir metadatos en inicio, selección, cambios de fase relevantes, fin de turno,
aborto y finalización. Para avances intermedios, máximo un checkpoint adicional cada
15 s, disparado por una transacción real con cambios; sin timer de escritura. Integrar
el UPDATE JSON en esa unidad, no hacer un UPDATE nuevo por cada ID o retry.
Usar el JSON serial actual del contexto y revision esperada; cero filas implica
pérdida de propiedad o conflicto, nunca éxito silencioso. No crear writers paralelos.

Entre checkpoints el dato de negocio puede haber avanzado más. El DTO significa
«confirmado hasta este checkpoint», una cota conservadora, no un contador exhaustivo
en cada instante. Mantener agregados locales a partir de commits y volcarlos al fin
de turno/aborto. Un crash entre checkpoints puede perder telemetría, nunca cursor
o partidas: reanudar la ingesta desde su persistencia, no desde el JSON de progreso.
Un fallo del checkpoint dentro de la unidad atómica revierte esa unidad; se informa
error de persistencia sin borrar lo previamente guardado. Si falla la finalización,
no inventar un resultado durable a partir del HTTP.

## 4. API administrativa propuesta

`GET /api/admin/sync/progress`, sin iniciar trabajo ni adquirir/renovar/liberar lease.
Selectores opcionales: `?requestId=<uuid>` o `?runId=<uuid>`, mutuamente excluyentes;
sin selector devuelve latest. Buscan únicamente latest/previous de una fila por PK.

Auth administrativa en cada lectura; UUID no concede acceso. DEMO_MODE devuelve
503 mediante requireAdmin antes de consultar sesión/DB/progreso. No secretos en URL.
Headers: `Cache-Control: no-store`, respuesta JSON, sin caché de framework/CDN,
sin `unstable_cache`/`use cache`; GET dinámico y fetch no-store. No permitir CORS de
otros orígenes. No ampliar `verifyOrigin` de mutaciones a GETs normales sin Origin;
si se exige una política adicional de navegación, definirla sin romper el fetch
mismo origen ni sustituir auth. Los POST conservan su validación de Origin.

El DTO se construye por allowlist con validación de versión/enums/fechas/contadores;
no serializar la fila ni el JSON interno. Excluir leaseOwner, credenciales, PUUID,
IDs/payloads de partidas, textos de errores libres y URLs Riot. Se pueden mostrar UUID
internos de jugadores solo al administrador y resolver etiquetas desde su roster.
Registros corruptos/versiones desconocidas devuelven seguimiento desconocido,
sin certificar éxito ni exponer payloads. Son metadatos administrativos, nunca públicos.

Ejemplo sintético: una solicitud propia encontrada, rango ya verificado y recientes
en curso. Lista `players` con un único jugador porque es una operación individual:

```json
{
  "version": 1,
  "serverNow": "2026-10-09T12:00:30Z",
  "selection": "found",
  "control": { "state": "lease_held", "until": "2026-10-09T12:05:30Z", "reason": null },
  "run": {
    "runId": "11111111-1111-4111-8111-111111111111",
    "requestId": "22222222-2222-4222-8222-222222222222",
    "source": "admin",
    "action": "player_recent",
    "season": "2026",
    "playerId": "33333333-3333-4333-8333-333333333333",
    "state": "running",
    "activity": "lease_valid",
    "phase": "recent",
    "revision": 3,
    "startedAt": "2026-10-09T12:00:00Z",
    "phaseStartedAt": "2026-10-09T12:00:10Z",
    "lastCheckpointAt": "2026-10-09T12:00:10Z",
    "finishedAt": null,
    "interruptionObservedAt": null,
    "recentOutcome": null,
    "recent": {
      "eligible": 1,
      "visited": 1,
      "settled": 0,
      "complete": 0,
      "partial": 0,
      "errors": 0,
      "skipped": 0,
      "unvisited": 0,
      "imported": 0
    },
    "history": null,
    "players": [
      {
        "playerId": "33333333-3333-4333-8333-333333333333",
        "rank": { "outcome": "verified", "checkedAt": "2026-10-09T12:00:10Z" },
        "recent": {
          "status": "running",
          "attempted": true,
          "reason": null,
          "error": null,
          "imported": 0,
          "coveredThrough": null,
          "history": null
        },
        "history": null
      }
    ]
  }
}
```

Global terminado con 19 recientes completos y 13 historiales pendientes: persistir
run state partial y recentOutcome success; conservar callbacks públicos como success.
Fragmento de los mismos campos del DTO (no respuesta completa):

```json
{
  "control": { "state": "available", "until": null, "reason": null },
  "run": {
    "state": "partial",
    "activity": "not_running",
    "phase": "finalizing",
    "finishedAt": "2026-10-09T12:03:50Z",
    "recentOutcome": "success",
    "recent": {
      "eligible": 19,
      "visited": 19,
      "settled": 19,
      "complete": 19,
      "partial": 0,
      "errors": 0,
      "skipped": 0,
      "unvisited": 0,
      "imported": 8
    },
    "history": {
      "eligible": 13,
      "visited": 2,
      "settled": 13,
      "complete": 0,
      "partial": 13,
      "errors": 0,
      "skipped": 0,
      "unvisited": 11,
      "imported": 3
    }
  }
}
```

Otros ejemplos abreviados:

```json
{ "selection": "found", "control": { "state": "cooldown", "until": "2026-10-09T12:05:00Z", "reason": "riot_retry_after" }, "run": { "state": "failed", "activity": "not_running", "phase": "recent", "finishedAt": "2026-10-09T12:03:50Z" } }
{ "selection": "found", "control": { "state": "available", "until": null, "reason": null }, "run": { "state": "possibly_interrupted", "activity": "lease_expired", "phase": "history", "finishedAt": null, "interruptionObservedAt": null } }
{ "selection": "not_found", "control": { "state": "available", "until": null, "reason": null }, "run": null }
```

`not_found` no permite distinguir petición aún no adquirida, nunca recibida o run
expulsado. Mostrar «sin ejecución correlacionada disponible», no éxito/cancelación.
Puede haber `control:lease_held` por otro run mientras el selector devuelve un
resultado anterior terminal. control siempre describe el lease actual; activity
describe únicamente el run seleccionado.

HTTP: 200 para lectura válida, incluso sin run o durante cooldown; 400 para selector
inválido; 401 sesión ausente/expirada; 503 demo; errores DB con texto genérico y sin
datos internos. No adquirir un lease para leer. No emitir 429 por el cooldown Riot
en este GET: ese cooldown restringe mutaciones, no lecturas.

Los POST conservan códigos y campos existentes y añaden runId/requestId si hubo
adquisición, también en errores traducidos. Un 409 anterior a la adquisición no tiene
run propio. Para backfill/alta, no derivar resultado de que work devolvió un Response:
añadir un resultado interno tipado al contexto antes de la liberación. Preservar los
campos actuales y derivar el feedback nuevo del run confirmado. No corregir contratos
públicos de ladder ni cambiar cron a background.

## 5. Estados, finalización y recuperación

Separar **resultado del run** de **capacidad de iniciar otra acción**.

| Evidencia                                                        | Run/actividad mostrados                                              | Control de nuevas mutaciones                    |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| POST local todavía sin adquisición observada                     | Resultado desconocido; espera local                                  | Guard local de 03.B.5, sin afirmar lease propio |
| Run running, owner coincidente, lease vigente                    | running / lease_valid: inicio registrado, sin prueba de proceso vivo | lease_held                                      |
| Run terminal, liberación y owner aún coinciden, expiresAt futuro | completed/partial/failed, siempre not_running                        | cooldown, motivo pacing o Riot                  |
| Lease vencido, run running sin fin                               | possibly_interrupted / lease_expired, inferencia GET                 | available según fila; reintento solo manual     |
| Propietario reemplazado y run previo sin fin                     | interrupted / ownership_lost                                         | Depende del nuevo lease; no del run anterior    |
| Lease ocupado por acción sin seguimiento                         | Run terminal previo o desconocido; no adjudicarle actividad          | busy_unknown                                    |
| No fila o JSON NULL                                              | Sin seguimiento conocido                                             | available o busy_unknown según expiresAt        |

`possibly_interrupted` es derivado de lectura y no se escribe mediante GET.
`interrupted` acredita pérdida de propiedad, no que se observó la muerte del proceso.
No llenar finishedAt de ninguno de ellos con una hora inventada. Un terminal nunca
vuelve a running. Tras el vencimiento normal, cooldown se deriva como available
sin un job que modifique la fila.

Estados persistidos: running -> completed, partial o failed al finalizar válidamente;
running -> interrupted al sustituir propietario. completed exige completar las fases
requeridas para esa acción. partial son límites internos, no atendidos o histórico
pendiente sin errores nuevos; failed indica un error real de esa ejecución, aunque
otros jugadores/fases se hayan completado. Errores persistidos de runs anteriores
siguen en diagnóstico, pero no se atribuyen a este run. Un error histórico da failed
al run con recentOutcome success si recientes terminó: no invalida la marca global.

La liberación escribe resultado final, finishedAt, últimos contadores y cooldown en
un único UPDATE condicionado por owner/run y lease vigente; no sobrescribe otro run.
Mantener lastSuccessfulSyncAt/lastOutcome solo para trabajos globales y su semántica
actual. No alterar esas marcas al verificación individual, alta o backfill.

| Interrupción / fallo                             | Tratamiento                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| SyncBudget o SyncDeadline recuperable            | Guardar partial y motivo exacto; preservar cursor/cobertura; seguir política actual de siguiente turno/histórico.                                 |
| Request Riot timeout/red/5xx                     | Mantener retries del cliente actual. Solo persistir error al agotarlos; sin nuevas llamadas para observar progreso.                               |
| 429 superado dentro de retries                   | No inventar un fallo terminal; el cliente mantiene backoff. No instrumentar cada sleep con escrituras.                                            |
| 429 propagado en recientes                       | Conservar aborto y cooldown Retry-After; resolver no atendidos con motivo permitido y error sanitizado del jugador afectado.                      |
| 429 en histórico tras recientes completos        | Conservar recientes, error histórico y omisiones siguientes; mismo cooldown existente.                                                            |
| Pérdida de red del navegador / cierre            | No cancelar ni reejecutar la ingesta desde polling. Recuperar por requestId; si no hay finalización, indicar incertidumbre.                       |
| Timeout del hosting / finally ausente            | Último checkpoint y progreso de negocio sobreviven. GET pasa a possibly_interrupted al expirar; siguiente adquisición cerca al propietario viejo. |
| Respuesta HTTP final sin UPDATE final confirmado | No afirmar resultado durable; mostrar incertidumbre/último checkpoint y revisar diagnóstico.                                                      |
| Versiones viejas del código actuando en paralelo | No ofrecen fencing nuevo. Evitar tráfico de esos deployments en el despliegue y rollback; no prometer seguridad mixta.                            |

No añadir inferencia de LP desde MATCH-V5; ni progreso, ni descubrimiento de IDs,
ni una finalización histórica crean observaciones oficiales de rango.

## 6. Frontend y polling

Un controlador cliente enfocado, sin dependencia nueva:

1. Mantener el runner síncrono de 03.B.5. Inicio: guardar correlación local, mostrar
   indicador indeterminado y enviar un único POST. Los nombres de acción siguen claros.
2. GET inicial por requestId tras despachar POST; repetir de manera serial cada 15 s
   mientras sea visible y haya acción esperada/running o incertidumbre recuperable.
   setTimeout al terminar cada lectura, nunca setInterval que solape solicitudes.
3. Con la primera correlación confirmada, seguir por runId y descartar respuesta de
   otro request/run, revision menor o una generación de UI anterior. No descartar
   una actividad derivada nueva con misma revision: la expiración puede cambiar sin
   UPDATE. Usar también serverNow de la respuesta.
4. Pausar al ocultar y abortar GET en curso; al volver visible, una lectura inmediata,
   sin volver a mandar POST. Limpiar timers/lecturas al desmontar o cerrar sesión.
5. Guardar requestId/runId/acción en sessionStorage. En recarga, GET correlacionado;
   el POST original puede seguir o no en el hosting. Un registro local no acredita
   actividad. Si no existe correlación local, SSR/contexto y una lectura latest
   permiten mostrar la ejecución más reciente como observada, sin adjudicársela al
   navegador. No mezclar dos acciones ni copiar una clave de otra sesión de origen.
6. Mantener fallback indeterminado durante error GET; mostrar último checkpoint y
   su fecha, aviso de observación desactualizada y backoff 15/30/60 s. 401 detiene
   polling y pide acceso; 503 demo no inicia nada; 429 de infraestructura respeta
   su Retry-After. Solo GET se reintenta, nunca una mutación.
7. Terminal/interrupted/possibly_interrupted: detener spinner de trabajo y polling
   continuo, conservando el resumen. Si hay cooldown, una lectura cuando venza
   o actualización manual; no refrescar cada segundo contra Neon. Al recuperar red
   o volver visible se permite una nueva observación.
8. Si requestId no aparece, no asumir rechazo: esperar con backoff durante la ventana
   de observación acotada (330 s desde activación local); después detener y mostrar
   resultado desconocido con botón de lectura manual. Ese límite cliente no cancela
   el servidor ni prueba que jamás adquirió un lease; un run confirmado usa hora DB.
9. Al finalizar, refrescar diagnóstico/roster una vez. No hacer router.refresh por
   cada checkpoint; no reordenar el leaderboard público ni tocar su polling existente.

Presentación: «fase iniciada», «rango verificado», «X participaciones nuevas guardadas»,
«Y jugadores con cobertura completa», «IDs procesados entre los descubiertos» y
«pendientes por presupuesto». Ninguno es porcentaje de temporada ni tiempo restante.
Reloj desde startedAt confirmado con offset serverNow/cliente; antes, reloj de espera
local separado. Para finishedAt medir duración registrada; si falta, no inventar duración
final. «Último checkpoint» conserva fecha y no cambia artificialmente cada polling.

Reutilizar status polite, timer aria-live off, movimiento reducido y foco de 03.B.5.
No anunciar cada tick, cada lectura o cada contador; anunciar cambios de fase/resultado.
Dos pestañas pueden observar el mismo run; el lease y el guard local siguen evitando
trabajo concurrente. No introducir un coordinador entre pestañas como segundo lock.
Idle sin run no mantiene polling constante: lectura inicial, al volver visible o manual.
Detectar inmediatamente una acción de otra pestaña estando idle no se garantiza.

### Coste de lectura estimado, sin precios inventados

15 s son aproximadamente cuatro GET/minuto por pestaña visible durante trabajo.
Cada GET autenticado hace normalmente dos SELECT acotados: sesión existente y fila
`riot` por PK; cero escrituras, joins de partidas o llamadas Riot. Una ejecución de
230 s necesita alrededor de 16–17 lecturas incluyendo inicial/final, unas 32–34
consultas. Cuatro pestañas suponen aproximadamente 32 SELECT/minuto mientras trabajan.

El JSON crece O(jugadores seleccionados), dos runs, no O(partidas históricas). Para
19 jugadores es acotado; medir bytes/latencia con datos sintéticos antes de fijar un
presupuesto de payload. No truncar elegibles silenciosamente. Si escala a cientos
de jugadores o exige retención, reconsiderar tabla/paginación. auth ya supone una
lectura; no reutilizar indefinidamente una sesión para ahorrar ese coste.

El impacto monetario/activación de compute de Neon requiere sus métricas y plan real;
no se acredita aquí. Evitar polling idle: a cuatro GET/minuto continuos serían 5760
requests y aproximadamente 11520 SELECT/día/pestaña. El pool actual es max 3 por
instancia; medir concurrencia y latencia sin aumentarlo automáticamente.

## 7. Migración y rollback

Migración futura aditiva de una columna nullable. No alterar el journal 0000–0005,
timestamps anteriores, snapshots, cursores ni marcas globales. Aplicar antes del código
que la selecciona; Drizzle tipado de JSON no sustituye validación runtime del DTO.
Probar filas antiguas/lease ocupado/resultado global previo en base local o efímera.

Rollback de código a la versión anterior conserva la columna y el journal: no DROP,
no borrar migraciones, no restaurar toda la base para revertir solo telemetría.
El rollback elimina la UI/GET nuevos, no revierte partidas guardadas correctamente.
Detener nuevas solicitudes de staging y esperar que terminen/vencen las existentes
antes de mezclar writers viejos sin fencing y nuevos. Datos JSON incompatibles se
tratan como desconocidos al volver a desplegar. Una recuperación de respaldo completo
solo se considera ante daño acreditado y con autorización independiente.

No puede desplegarse código nuevo contra una base sin la columna. No usar un catch
genérico de «columna inexistente» como modo compatible permanente. Tras aplicación,
el código anterior sigue funcionando porque la columna es opcional y no cambia
restricciones existentes. Verificarlo en las pruebas de compatibilidad.

## 8. Riesgos y controles

| Riesgo                                                  | Control / límite explícito                                                                                                                               |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Un run viejo publica tras reemplazo                     | Contexto privado inmutable, owner + runId + revision + expiración y guard transaccional. Cero filas no es éxito.                                         |
| Escrituras viejas de negocio después del vencimiento    | Fencing en todas las unidades del servicio y consumidores del lease; no solo JSON. Revisar begin/finish/error/cursor, PATCH/DELETE/alta y mantenimiento. |
| Deadlock o pérdida de presupuesto por SQL               | Lock del lease primero, transacciones cortas, sin fetch ni sleep bajo lock, límites locales probados; medir latencia/pasos.                              |
| Checkpoint visible antes del commit o contadores dobles | Unidad atómica cuando se publica; contar RETURNING reales; dedup/cursor siguen siendo autoridad. No tratar telemetry como cursor.                        |
| Desfase/ambigüedad temporal                             | Hora DB para lease/progreso; revision ordena; no reutilizar finishedAt global de otra operación.                                                         |
| Running perpetuo después de crash                       | Derivar possibly_interrupted al expirar, interrupted al perder owner; GET no modifica; no heartbeat que finja actividad.                                 |
| Último resultado expulsado                              | Retener dos y mostrar not_found con incertidumbre. Tabla de runs si se requiere auditoría durable.                                                       |
| Error viejo atribuido al run nuevo                      | Solo eventos del contexto actual. Diagnósticos de players siguen separados y explícitos.                                                                 |
| Resumen reciente exitoso con histórico incompleto       | Resultado del run y recentOutcome separados; callbacks globales sin cambio.                                                                              |
| Lectura libre mediante UUID adivinado                   | Auth en cada GET, sin CORS permisivo; UUID no es permiso ni token de acceso.                                                                             |
| Leak por mensajes/raw JSON/logs                         | DTO allowlist y enums; logs limitados a runId, acción/fase/códigos/contadores, nunca owner/request headers/payload Riot.                                 |
| Producción demo toca DB al evaluar progreso             | Guard demo antes de auth DB, imports lazy y GET rechazado; tests con DB/fetch prohibidos.                                                                |
| Observabilidad cambia Fair Scheduling                   | No mutar prioridades ni datos de players para guardar pendientes; conservar budgets, pacing y turnos. Pruebas comparan orden y llamadas antes/después.   |

La principal ampliación de código es el guard transaccional y la correlación del
POST síncrono, no la columna. No presentar este diseño como «solo añadir un GET».
No se propone cambiar el scheduler, los cron ni el comportamiento público de demo.

## 9. Plan de pruebas

Con reloj virtual, fetch simulado y PostgreSQL local/efímero; sin Neon ni Riot reales:

1. Migración: fila preexistente, owner/expiración/global intactos, nueva columna NULL,
   journal histórico intacto, código anterior compatible; ninguna observación inventada.
2. Lease: dos adquisiciones simultáneas, un ganador/un run; 409 no modifica JSON;
   owner antiguo no libera ni publica. Global, individual, historial y PATCH compiten.
3. Fencing: vencimiento antes de unidad y durante SQL simulado, reemplazo entre
   fetch/commit, rollback de participación+cursor+checkpoint, sin nuevas llamadas Riot
   después de detectar LeaseLost. Relojes distintos y mismo orden de locks.
4. Checkpoints: rango sin cambios verificado; fallo reciente posterior conserva rango;
   match deduplicado no aumenta imported; 404/excluidos no son nuevas partidas; cursor
   y progreso parciales siguen; no emitir avance cuando falla transacción.
5. Global: selección/turnos/motivos y no atendidos exactos; históricos elegibles se
   publican cuando se conocen; callbacks públicos idénticos; 19 recientes completos
   con historial parcial/errores no se convierte en pérdida de cobertura reciente.
6. Individual/histórico/alta: fases reales en orden, run propio, 200/201 no ocultan
   parciales; error inicial no anuncia history; no modifica éxito global.
7. Recuperación: cierre/pérdida HTTP, finally ausente, expiración, nueva adquisición,
   previous retenido y expulsado; PATCH/DELETE no dejan un run viejo activo.
8. Riot: 429 abortado/reintentado dentro de presupuesto y Retry-After durable; 5xx/red,
   deadlines y request budgets; mismas llamadas/pacing mínimo de 1300 ms, sin retry POST.
9. GET: auth ausente/expirada, selectors inválidos, no-store en todos los resultados,
   lectura sin mutaciones, legacy NULL/versión corrupta, owner/PUUID/secretos jamás en
   DTO/logs; dos SELECT habituales y ningún N+1.
10. Frontend: respuesta de otro run/revision vieja/generación desmontada, misma revision
    con lease vencido, reload/sessionStorage, polling serial a 15 s, hidden/visible,
    backoff y AbortController; parar en terminal/401, resultado sin correlación honesto.
11. Accesibilidad: fase/resultados anunciados moderadamente, reloj silencioso, teclado,
    reduced-motion, touch targets de 03.B.5; ningún porcentaje o ETA ficticio.
12. DEMO_MODE=true: rutas GET/POST/admin, build y smoke HTTP sin cinco secretos, con
    DB/Riot autenticado prohibidos, fixtures intactos y sin consultas incluso al simular
    sesión/headers válidos.

Al implementar, ejecutar lint, typecheck, test y build; build mediante el validador
aislado existente. Medir queries/escrituras y duración con comunidad sintética de
18/19 jugadores. Pruebas de concurrencia PostgreSQL con conexiones independientes
si PGlite no reproduce locks/conexiones reales; no sustituirlas por mocks de owner.

En Preview autorizado: una ejecución pequeña controlada, reload a mitad, dos pestañas,
latencia GET/checkpoints y resultado durable. No provocar 429 reales para probarlo:
reproducirlos localmente. No acreditar capacidad o timeout remoto con pruebas locales.

## 10. Orden exacto de implementación y despliegue

Todo lo siguiente es futuro y requiere autorización; esta entrega solo crea este documento.

1. **Contratos:** implementar tipos/versionado, reducers de contadores, estados derivados,
   sanitización y correlación. Pruebas puras y de compatibilidad; sin UI/DB remoto.
2. **Persistencia local:** cambiar schema Drizzle, generar una migración aditiva y revisar
   SQL/journal/snapshot. Probarla con filas anteriores en DB local/efímera. No aplicarla
   aún a staging. No crear retención/auditoría adicional por defecto.
3. **Lease/contexto:** adquisición+run atómicas, previous acotado, finalización/cooldown,
   guard transaccional. Adoptar contexto en TODOS los writers que usan el mismo lease.
4. **Servicios:** instrumentar unidades rank/recent/history y resultados de turnos/aborto;
   coalescer avances intermedios. Mantener fair ordering, cursor, dedup y cuotas internas.
5. **HTTP/lecturas:** header requestId, campos aditivos en respuestas; GET autenticado
   sanitizado y contexto inicial SSR. Preservar códigos existentes y callbacks globales.
6. **Frontend:** controlador de polling/recarga, indicador real con fallback 03.B.5,
   pruebas y QA responsive en fixtures existentes sin sincronizaciones reales.
7. **Validación local completa:** cuatro comandos y build/HTTP demo aislado, concurrencia
   local, revisión de secretos/diff/archivos protegidos; commit local solo autorizado
   dentro de la futura tarea. No publicar antes de revisar la entrega.
8. **Ventana de staging:** con autorización específica, evitar nuevas acciones manuales
   y cualquier invocación a deployments viejos. Confirmar que no hay trabajo en curso
   ni migración incompatible. Hoy no existe scheduler externo; no crearlo para esto.
9. **Preflight Neon staging:** verificar proyecto/rama/endpoint efectivo, precedencia de
   DATABASE_URL sin revelar valor, journal aplicado exactamente hasta el anterior,
   respaldo/punto de recuperación y ausencia de migración concurrente. Cualquier
   ambigüedad detiene la operación; no utilizar ni consultar Production.
10. **Aplicación autorizada:** ejecutar el runner `npm run db:migrate` existente una vez,
    solo si el único pendiente es el SQL revisado. Sin ALTER manual, cambios de script,
    reset ni aplicación en Production. No migración automática en build.
11. **Postflight readonly:** confirmar tipo JSONB, nullable, NULL para filas anteriores,
    journal nuevo y conservación de conteos/datos históricos. Registrar resultado sin
    PUUID/credenciales. Si falla, detener despliegue y conservar código anterior.
12. **Publicación autorizada:** verificar SHA, staging y fast-forward; push únicamente
    origin/staging. Aplicación de migración debe preceder este push que dispara Preview.
    No tocar main ni variables Vercel; confirmar deployment remoto/commit antes de usarlo.
13. **Validación real separadamente autorizada:** abrir el Preview actualizado, probar
    una sincronización acotada/recarga, verificar DTO y persistencia; revisar latencia,
    lease y errores. No afirmar éxito remoto antes de comprobarlo. Mantener otros
    deployments sin tráfico de escritura durante la transición.
14. **Decisión posterior:** autorizar uso normal de staging si pasa. Si falla, detener
    nuevas acciones, drenar/vencer runs y rollback de código preservando la migración.
    No avanzar a scheduler externo, promoción de Production ni otras funcionalidades.

Archivos previsibles para la implementación: `src/db/schema.ts`, nueva migración y
metadatos Drizzle; contratos nuevos `src/lib/sync-progress.ts`; helper privado
`src/server/sync/progress.ts`; `lease.ts`, `service.ts`, `player-state.ts`, `recent.ts`,
`history.ts`; rutas sync/individual/backfill/alta y consumidores PATCH/DELETE;
`scripts/backfill-remakes.ts` solo si necesita adoptar el guard de propiedad, sin
ejecutarlo ni cambiar su lógica de clasificación; `server/admin-queries.ts`, nuevo
GET admin/sync/progress, `admin/page.tsx`, `admin-operation.ts`, panel/feedback y un
controlador cliente enfocado; pruebas y documentación relacionadas. No modificar
RiotClient por defecto, fixtures, scheduler, variables ni marcas públicas de ladder.

### Comprobación de esta entrega

Solo documento nuevo; sin código, schema, migraciones, commit, push ni operaciones
remotas. Rama/base verificadas y archivos protegidos comparados por hash. No se
ejecutan lint/typecheck/test/build en esta etapa documental ni se atribuyen resultados
de validación de código nuevo. Antes de implementar, se requiere autorización del diseño.
