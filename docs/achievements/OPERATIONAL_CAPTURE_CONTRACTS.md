# 1.2.B.2.E.2.1 — Contratos privados de preparación de capturas

Fecha: **12 de octubre de 2026**. Base local `9ecc10a229362ff9aa19e1fb7f96dbda13fa06cf`, rama `staging`. Referencia local `origin/staging`: `726daaf58372324e2b01a41cce9f6a86401c6f29`, siete commits por delante y cero por detrás al iniciar. No se hizo fetch ni se consultó el servidor remoto. Working tree inicial: `CLAUDE.md` modificado y `.claude/` sin seguimiento, ajenos y preservados; `.env.local` ignorado. Esta entrega solo autoriza contratos/funciones puros, fixtures, tests y este documento, con un único commit local después de validar.

## Alcance y versiones

Módulos nuevos internos `server-only` en `src/server/achievements/verification/`:

- `operational-capture-contracts.ts`: formatos estrictos Zod, tipos, vocabulario de confianza y códigos sanitizados.
- `prepare-operational-capture.ts`: `prepareOperationalCapture(unknown)` y `prepareEvidenceScan(unknown)`, funciones deterministas sin IO.

Versiones: **`1.2.B.2.E.2.1-capture-preparation-v1`**, **`1.2.B.2.E.2.1-scan-lifecycle-v1`** y normalización mínima **`minimal-capture-v1`**. La base de remake lleva **`any-early-surrender-true-v1`**, nombre que caracteriza el algoritmo observacional actual; no se modifica ni versiona retrospectivamente el escritor existente. B.1/B/C/D v1, evaluadores y reglas permanecen intactos; no existe conversión automática entre formatos. Los nombres/versiones indican preparación, no un formato ya autorizado de recepción real.

No se conecta RiotClient, syncWrite, repositorio D ni rutas. No se importa un cliente DB, no se define un adaptador InTx ni un productor de recepción. No se genera DDL. Los módulos no tienen consumidores operacionales, flags, jobs, cachés o concesiones. Production Demo no los ejecuta.

## Confianza: validación de estructura no es procedencia

| Nivel | Estado en E.2.1 |
| --- | --- |
| `synthetic` | Entrada explícita de fixture; tiempos/IDs inyectados. |
| `declared` | Declaración explícita de un llamador interno, no autenticada. |
| `received_by_server` | Vocabulario futuro **rechazado como entrada**, sin constructor. |
| `validated` | Futuro nivel operacional **no alcanzable**; parsear Zod no lo concede. |
| `committed` | Futuro nivel transaccional **no alcanzable**; no persistencia. |

`CAPTURE_TRUST_LEVELS` es solo vocabulario congelado. El schema admite exclusivamente los dos primeros valores. No se exporta una factoría authenticated/committed, una capacidad WeakMap ni un mecanismo que eleve un objeto arbitrario a respuesta Riot. Las dos funciones preparatorias aceptan datos no confiables y conservan esa condición. `server-only` impide imports de cliente accidentales, **no autentica Riot**. No exponer estas funciones como endpoint público ni usar su resultado como autorización B.1.

Todos los resultados llevan `certification: "not_established"`, `grantAuthorized: false`, `writes: "none"`, `provenanceAuthentication: "not_performed"`, `revisionValidation: "not_performed"`, `recoverableCoverage: "not_established"` y `seasonClosure: "not_established"`. Capturas: `mode: "capture_preparation"`, `scanComplete: false`; scans: `mode: "scan_preparation"`, `coverage: "unproven"`. No existe resultado positive/verified. Los campos retornados son datos en memoria, no un token; cualquier consumidor futuro debe revalidar y usar su frontera de confianza propia. Mutar un DTO no otorga privilegios.

## Campos comunes, tiempos y fuentes

`owner`: UUID interno playerId, plataforma del catálogo actual, cola SoloQ/Flex y año de temporada de cuatro cifras. No PUUID, nombres o Riot IDs. La forma del UUID no acredita que exista el jugador; las funciones no consultan su fila.

`capture`: trust, captureId/receptionId UUID nullable, receivedAt/validatedAt nullable, schemaVersion y normalizationVersion literales; createdAt y committedAt obligatoriamente null. Todos los IDs y tiempos se suministran explícitamente. No reloj, aleatoriedad, ambiente o fechas por defecto. Los timestamps de captura usan UTC ISO canónico con milisegundos; fechas imposibles, precisión que JS truncaría y formatos alternativos se rechazan. Un futuro adaptador debe preservar los tiempos reales con una versión explícita, no inventar fechas o sustituir el timestamp original del match/snapshot. validatedAt no puede preceder a receivedAt.

Los timestamps aceptados siguen siendo **declarados/sintéticos**, incluso si ambos están presentes. No se afirma recepción HTTP real ni validación operacional. `receivedAt` futuro será fecha de recepción de respuesta; `validatedAt`, fecha de validación; createdAt, fecha de almacenamiento, y committedAt, confirmación transaccional: son conceptos diferentes. El tipo actual reserva los dos últimos como null. Las ausencias se conservan y generan códigos de incertidumbre, no timestamps retroactivos.

`source`: none, legacy con captureId/receivedAt null obligatorios, o existing_declared con UUID de referencia, owner, versión actual y concordancia matching_declared/conflicting/unknown. Una referencia declarada no se verifica en almacenamiento ni prueba atestación. Otra identidad/ámbito o concordancia contradictoria quedan señaladas. Fuentes D v1 no se reinterpretan como V1 nuevo; requerirán adaptación explícita si se autoriza, manteniendo legacy desconocido.

`attempt`: entero positivo seguro, sin generación automática ni retry. La función prepara **un intento**; conserva su número y contenido. No coteja por sí sola la cadena de intentos o la reutilización de captureId entre invocaciones: ese registro/idempotencia es responsabilidad futura de E.2.2. Distintos intentos pueden declarar distintos IDs/tiempos. No se elige silenciosamente un éxito antiguo.

## Endpoints y contenido mínimo

| Endpoint | Datos y comprobaciones preparatorias |
| --- | --- |
| ACCOUNT-V1 | Vínculo matching_declared/mismatching_declared/unknown; playerId/plataforma nullable. Detecta discordancia respecto del owner, sin copiar PUUID. Captura independiente de identidad propuesta; no escribe identity_capture. |
| LEAGUE-V4 | Entradas ranked mínimas: queue, tier/división, LP/V/D exactos enteros. Conserva entradas repetidas y marca duplicate_queue_type, incluso si iguales; no elige una favorable. entryPresent expresa presencia en el array presentado, null si no hubo array exitoso. Ausencia conserva `[]`, sin Unranked/LP cero fabricados. |
| MATCH-V5-IDS | Scan UUID, intervalo objetivo `[from,to)` en milisegundos, startTime/endTime epoch segundos, start/count, queue/type nullable para filtros ausentes y timeSemantics unconfirmed. IDs en orden original incluidos repetidos. Marca otro prefijo de plataforma, filtros incompatibles y consulta que no cubre numéricamente el objetivo. |
| MATCH-V5-DETAIL | ID solicitado y retornado, timestampMs original entero nullable, queue/map/mode, win/campeón nullable, participante y base de remake. Compara IDs, vínculo, número de participantes coincidentes y ámbito; no recibe un payload Riot completo. |

LP proviene exclusivamente del contenido LEAGUE declarado; no hay LP en MATCH-V5, cálculo de deltas o reconstrucción histórica. LEAGUE permite snapshot none/existing_declared/proposed. Existing conserva UUID y timestamp diferente de recepción; proposed no crea ni inventa UUID. Ninguna variante acredita inserción o altera la política de snapshots. Se pueden describir verificaciones sin un snapshot nuevo.

DETAIL conserva `matchingCount` 0/1/>1 para distinguir ausencia/unicidad/ambigüedad del participante sin guardar sus PUUIDs. Una igualdad declarada no sustituye el cotejo privado futuro de la respuesta con la identidad almacenada. `gameMode: OTHER` agrupa modos no CLASSIC sin texto libre innecesario; null es desconocido, nunca OTHER automático. El futuro normalizador deberá proyectar esta categoría explícitamente con su versión. Solo los campos mínimos necesarios pueden llegar a estos contratos.

Page shape es full/short/empty solo si el intento suministrado es HTTP success **completo**; partial si el llamador declara respuesta parcial, aunque su lista esté vacía. Error sin lista → unknown. Se conserva count 1–100 como límite preparatorio, no redefinición de especificación Riot ni cambio al count=100 actual. El tamaño real de IDs no puede exceder count. Exactamente 100 con count=100 permanece full; no prueba terminal. 0/99/100 se prueban. `indexChange: observed_change` conserva reporte explícito; unproven no acredita estabilidad. No se atribuye semántica Riot inclusiva/exclusiva a la comparación local de intervalos.

## Remakes, exclusiones y desconocidos

Remake: conteos separados truePresent/falsePresent/absent; máximo local 20 marcadores, no afirmación de cuota o garantía Riot. Preserva observationalIsRemake: true si algún true, false si hay participantes y ninguno true, null si no hay base. Por tanto, diez ausencias pueden conservar false **observacional** con base desconocida. No se toca isRemake, sus tests ni estadísticas. EvidentiarySufficiency es siempre unknown, incluso con true; un marcador declarado no es certificación del proveedor.

Las razones other_queue, other_mode_map, outside_target_interval y confirmed_remake_marker necesitan campos explícitos que las respalden. Si faltan queue/map/mode/timestamp, scope_unknown no inventa exclusión. Campos competitivos nullable producen competitive_fields_unknown. Detail inválido por forma lanza invalid_capture; ausencia o error del detalle conserva request_unresolved. Estas razones son **bases observacionales declaradas**, no disposiciones terminales persistidas ni permiso para descartar evidencia. Pueden coexistir varias, sin seleccionar una exclusión favorable que oculte contradicciones.

La ausencia de marcadores nunca acredita false a efectos probatorios. confirmed_remake_marker significa true suministrado, con su base y limitación; no remake certificado ni suficiencia aprobada. Una política probatoria futura sobre presencia/coherencia de estos campos sigue pendiente.

## Peticiones y errores

Variantes estrictas: http_success (200, complete/partial), http_404, http_429 (retryAfterMs nullable), http_5xx, http_other (otros 4xx), invalid_json, invalid_schema, network_failure, timeout, pending, unknown. No mensajes libres, cuerpo de error, URLs, headers o secretos. Retry-After es el valor mínimo sanitizado **declarado**: no se calcula, duerme ni cambia pacing. 404 es irresuelto recuperable, nunca ausencia permanente o una lista vacía exitosa.

HTTP error/JSON/schema inválidos exigen contenido null. Error de red/timeout admite failedAt inyectado y prohíbe receivedAt, validatedAt y receptionId: no hay respuesta HTTP fabricada. Pending/unknown también prohíben esos campos; captureId puede identificar el intento preparado, no una recepción. ReceivedAt ausente en un HTTP declarado queda explícitamente unknown.

Estructuras inválidas arrojan CapturePreparationError con código sanitizado **invalid_capture**, sin eco de Zod/input. Vocabulario futuro de fallos: invalid_capture, storage_capacity, scope_mismatch, identity_mismatch, conflicting_source, retry_ambiguity. Definirlos no ejecuta recuperación o almacenamiento; los otros códigos quedan disponibles para una integración autorizada. Incertidumbres semánticas retornan issues estables, únicos y ordenados, con los datos mínimos conservados; no se convierten en éxito operacional.

Schemas estrictos rechazan claves adicionales en todos los niveles. IDs UUID, match IDs de forma regional-numérica, temporadas y enums acotados impiden texto libre en el que esconder una URL/token. Eso no detecta criptográficamente un secreto que coincida casualmente con un UUID: la futura proyección confiable del servidor, acceso privado y ausencia de payload completo siguen siendo indispensables. No hay logs ni impresión de datos personales.

## Scans y lifecycle

`prepareEvidenceScan` valida scanId propio, owner/queue/season, phase recent/season_backfill/incremental_repair, intervalo/consulta efectivos, lifecycle active/import_finished/prefix_unknown/blocked y prefix declared_from_zero/unknown. finishedAt solo acompaña import_finished; prefix_unknown exige unknown. completed es rechazado. Las combinaciones preservan incertidumbre: import_finished puede tener prefix unknown y **no** significa cobertura demostrada.

runId/checkpointId nullable son correlaciones declaradas, distintas del scanId; no autorizan un lease. structuralReceiptId y sealId deben ser null: no fabricar recibos ni sellos. No hay porcentaje, ETA, tabla, nuevo cursor operativo, transición automática ni estado almacenado. La cadena desde offset cero y sus intentos no se prueban aquí. Son responsabilidades futuras de ingesta y reconciliación, no de la validación de un solo scan.

## Integración transaccional futura y política A

Inspección de Drizzle **0.45.3** instalado: postgres-js tiene `PostgresJsTransaction`, y su método transaction permite una transacción anidada/savepoint. El alias actual SyncTransaction deriva del callback db().transaction; el repositorio D está tipado como PgliteDatabase y abre sus propias transacciones. **No se define un port ejecutable** que parezca compatible con D por cast: no es necesario para contratos puros, y su adaptación está fuera del permiso actual.

Contrato requerido cuando se autorice un port InTx:

1. Recibir la misma transacción ya abierta por SW y contexto del lease vigente del servidor. No importar DATABASE_URL ni abrir DB/conexiones/tx/savepoints o un segundo lease.
2. Orden: lease → match cuando corresponda → jugadores por UUID estable → headers → units. No llamar wrappers D que bloqueen primero al jugador si se necesita lock de match compartido.
3. Captura/fuente/cursor en la misma SW; marcar al owner mediante markSourceChanged, **sin** incrementar source_revision por cuenta propia. Flush E.1 suma una vez por dueño/tx. La revisión destino usada en units requiere lock y aritmética SQL, no Number/read-modify-write.
4. Mantener fencing inicial/final y rollback de todas las escrituras, incluidos progreso y R. Red/validación de respuesta fuera de locks; hashing/normalización costosa antes, cotejo corto dentro.
5. Idempotencia durable por claves y contenido/versiones bajo locks, capacidades privadas ligadas a una futura recepción real, recuperación tras respuesta perdida y fuente discordante, sin inventar una recepción por reutilizar legacy.

**Recomendación de política A:** si falla captura obligatoria/capacidad/ámbito, rollback de fuente, captura, cursor y revisión juntos. No implementada ni ejecutada en E.2.1. Su impacto en avance y fairness exige medir y aprobar la integración. No alternativa B de pérdida probatoria durable, no cambios a presupuestos ni rate limiting.

## Dependencias y decisiones pendientes

- Migración **posterior a 0007** autorizada: source CHECK hoy solo unknown/synthetic; identity_capture no existe en kind. Este formato no debe persistirse como fuente operacional ocultándola en unknown/synthetic ni ampliar 0007. SQL/metadatos se conservan intactos.
- E.2.2: receptor privado en cliente real, tiempos/IDs por recepción real, validación/vínculo, páginas/disposiciones y lifecycle atómicos, port InTx, capacidad/idempotencia/fencing y una revisión por tx. No sumar llamadas Riot ni cambiar fairness, cursores o Retry-After.
- E.2.3: alta/identity/LEAGUE, verificaciones sin snapshot, múltiples colas, reclasificación de remake y fanout por dueños. Verificar igualdad de PUUID en memoria/unicidad de participante/ID solicitado con permisos específicos, sin duplicar PUUID en evidencia.
- E.3/F: D13 externo, acceso privado D18, retención/finalidad aprobadas, concurrencia PostgreSQL real con dos conexiones, coste/cupos/SQL y reconciliación autorizada. Fixtures no acreditan procedencia, revisión ni estabilidad del índice Riot.
- No adaptar B/C/D ni habilitar un consumidor probatorio/grants antes de resolver estas fronteras y recibir autorización. El año del contrato preparatorio no autentica calendario o cierre regional; fechas/esperas/cobertura siguen pendientes.

## Validación y seguridad de esta entrega

Tests nuevos: `tests/achievements-operational-capture.test.ts`, fixtures ficticias sin cuentas reales. Cubren estructura/versiones, rechazo de confianza falsificada y secretos/claves extra, fechas ausentes/no canónicas, 0/99/100, orden/duplicados/reintentos/cambio declarado de índice, parcial/error, HTTP 404/429/5xx y fallos sin respuesta, legacy/referencia discordante, queue/map/intervalo, remake true/false/ausente, participante ausente/ambiguo/discordante, league ausente/duplicada/sin snapshot, lifecycle, determinismo, no IO/reloj/aleatoriedad y ausencia de consumidores operacionales/imports con escritura. No prueban concurrencia, autenticación real ni desempeño Neon.

Secuencia efectivamente ejecutada con Node **24.19.0**, PATH solo del proceso, sin suite/build simultáneos:

| Verificación | Resultado |
| --- | --- |
| `npm run lint` | PASS, código 0. |
| `npm run typecheck` | PASS, código 0. |
| `npm run test -- --maxWorkers=2 --hookTimeout=60000` | **1.227 aprobadas, 10 omitidas, 0 fallidas**, 1.237 total; 55 archivos aprobados y dos omitidos; **95,74 s**. Incluye **84 casos nuevos**, sin modificar pruebas anteriores B.1/B/C/D/E.1 ni timeouts. |
| `node scripts/validate-production-demo.mjs` | **PRODUCTION_DEMO_PASS**, código 0. Ejecuta el verdadero `npm run build` en copia aislada: compilación 60 s, TypeScript 7,4 s, siete páginas estáticas; servidor local READY en 203 ms. Smoke de ranking/perfiles/métricas SoloQ/Flex/5v5, períodos, privacidad/términos y bloqueos admin/cron/status correcto. |

El primer arranque de Vitest dentro del sandbox no ejecutó ningún test: Vite recibió `spawn EPERM`. Se repitió el mismo comando con permiso para subprocesos locales, sin cambios de configuración ni expectativas. No hubo fallos funcionales de pruebas. npm mostró un aviso informativo de versión disponible; no se instaló ni actualizó nada. Logs locales ignorados `artifacts/operational-capture-tests.log` y `artifacts/operational-capture-demo.log`, fuera del commit.

Los diez tests PostgreSQL opt-in omitidos no acreditan concurrencia real. Los casos anteriores con PGlite sí se ejecutaron; los 84 nuevos son unitarios puros y no abren DB. No se aumenta ningún timeout ni se modifica una prueba anterior para aprobar. No es QA de Preview/Production remotos, latencia Neon o recepción Riot real.

Protegidos comprobados por SHA-256, archivos restringidos sin diff, revisión de scope/secretos y commit solo de los cuatro archivos nuevos. Sin push, deployment, Neon, Riot operacional, migraciones, grants, flags, main/Production ni inicio E.2.2/E.2.3/E.3/F. Build/smoke local admite assets públicos Data Dragon y localhost; eso no es una operación Riot autenticada ni acceso a Production remota.
