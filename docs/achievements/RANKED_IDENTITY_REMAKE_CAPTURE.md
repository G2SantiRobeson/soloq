# 1.2.B.2.E.2.3 — Capturas ranked, identidad y remakes

Fecha: **12 de octubre de 2026**. Rama `staging`. HEAD inicial
`df25996de5c7a2efbbd0f7f90d176d19af8372b4`; referencia local `origin/staging`
`726daaf58372324e2b01a41cce9f6a86401c6f29`: diez commits por delante, cero por
detrás al empezar. Sin fetch ni inspección remota. Working tree inicial:
`CLAUDE.md` modificado y `.claude/` sin seguimiento, ajenos y preservados;
`.env.local` ignorado y preservado. Implementación y pruebas exclusivamente
locales; **no autoriza publicación ni persistencia remota de evidencia**.

## Caminos implementados

| Camino                   | Recepción y unidad confirmada                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alta administrativa POST | Origin + sesión admin + `withSyncLease` originales. UUID del futuro owner asignado por servidor antes de ACCOUNT. ACCOUNT y SUMMONER siguen siendo las mismas peticiones. INSERT de player, captura ACCOUNT proyectada en SoloQ/Flex y revisión en la misma `syncWrite`. Cuenta duplicada: 409, sin otra captura ni revisión del owner existente. |
| `syncPlayer` identidad   | IDENTITY por PUUID ya utilizado. Cotejo privado con PUUID de fila protegida; dos `identity_capture` con concordancia true/false/null. Identidad discordante no permite actualizar nombre, rango o snapshots.                                                                                                                                      |
| `syncPlayer` rango       | Misma LEAGUE-V4, dos proyecciones `rank_capture`. Entradas SoloQ/Flex, ausencia explícita, duplicados íntegros, vínculo a identidad y a snapshot existente/nuevo. Contexto, fuentes, captura y R en una SW.                                                                                                                                       |
| Fallos de preparación    | Error de IDENTITY: intento mínimo sin datos de cuenta. SUMMONER fallido: captura de identidad que sí se obtuvo, sin afirmar consulta LEAGUE. LEAGUE fallida/inválida: identidad y recepciones fallidas, sin snapshot ni `rankCheckedAt` exitoso. El diagnóstico separado conserva el error sanitizado original.                                   |
| MATCH habitual           | Proyección mínima E.2.2 añade versión, base y contradicción de marcadores; siguen los mismos escritores recent/history, disposiciones, cursores y algoritmo observacional.                                                                                                                                                                        |
| `backfill-remakes.ts`    | Misma petición MATCH por fila pendiente. `observeRemakeDetail` y `captureRemakeInTx` comparten SW; match primero, owners después, fundamento personal por owner/cola, bool y R atómicos. El script **no se ejecutó**.                                                                                                                             |

El alta **ya** utilizaba el lease global y SW: no se creó un protocolo de
autorización diferente. Si ACCOUNT/SUMMONER fallan antes del INSERT o la cuenta
ya existe, no hay un nuevo owner confirmado al que asociar evidencia. No se
crea un ledger global ni un jugador ficticio para guardar ese intento; se
conserva el diagnóstico operacional existente. Un fallo posterior al alta
confirmada conserva la cuenta, como antes, pero la captura ACCOUNT debe haber
quedado confirmada con ella.

## Formatos, versiones y confianza

- Nuevo formato privado: **`1.2.B.2.E.2.3-ranked-identity-remake-v1`**;
  normalización **`minimal-ranked-identity-v1`**.
- Categorías ACCOUNT-V1, IDENTITY-V1, LEAGUE-V4; sin URL/path, Riot ID, nombres,
  PUUID, headers, tokens ni payload completo en JSON. PUUID únicamente permanece
  en el binding privado en memoria y en su columna canónica preexistente.
- Reutiliza los intentos E.2.2: UUID de captura, receptionId nullable, receivedAt,
  validatedAt, failedAt, status, outcome y Retry-After sanitizado. No modifica
  HTTP, retries, pacing ni timeout.
- Cada proyección recibe un UUID opaco estable derivado de requestId/owner/cola
  para correlación e idempotencia. **No es un sello ni prueba criptográfica de
  Riot**. Los UUID de las recepciones originales se conservan sin recrearlos.
- MATCH conserva su versión y normalización v1; extensión aditiva del JSON mínimo
  de remake con `classifierVersion`, `basis`, `contradictoryMarkers`. No reescribe
  capturas antiguas ni interpreta la ausencia de esos campos como evidencia.
- Clasificador: **`any-early-surrender-true-v1`**, caracterización del `some(true)`
  existente. No cambia `isRemake`, resultados, stats, R1/I1/OTP, LP, Firma o Salones.

El cliente mantiene handles en WeakMaps privadas, con cliente, owner y plataforma.
Un objeto copiado, UUID arbitrario, handle de otro cliente o scope distinto no
recupera una recepción. El enlace ranked revalida el handle IDENTITY original y
la cabecera de esa misma recepción/owner/cola/temporada dentro de SW; no confía
solo en un booleano o ID de padre suministrado.

`server_riot_received` queda limitado al transporte predeterminado no sustituido,
con recepción HTTP observada y persistencia bajo lease. Transportes/dependencias
inyectados y entorno de test son **synthetic**; métodos sustituidos sin una
recepción HTTP quedan **unknown**, con fechas/receptionId desconocidos. El fetch
global de los tests también es synthetic. Las pruebas
con fetch mockeado no se presentan como recepción autenticada.

Esta clasificación es una frontera interna de código, **no attestation externa**:
no puede certificar un runtime previamente manipulado, una sustitución antes de
cargar el módulo o un proveedor. Una sustitución posterior fuera de test y sin
dependencias simuladas (por ejemplo, instrumentación del framework) conserva
procedencia **unknown**, sin inventar que la respuesta es ficticia. La versión
instalada de Next parchea fetch en AppRoute; se mantiene ese transporte y sus
recepciones sin aceptar propiedades públicas del wrapper como autenticación. Validar
esa frontera en el runtime autorizado de staging antes del consumo probatorio;
no cambiarla para aceptar un mock como Riot. Un error de red sin respuesta no
inventa recepción; errores HTTP conservan recepción, sin éxito de validación.

Los caminos de fixture sin HTTP pueden persistir unknown mediante el contrato
de dominio unleased preexistente; no son productores operacionales. Capturas
ranked/remake synthetic y reales, y los intentos observados unknown, requieren
cliente ligado al lease. Todos los
entry points operacionales reales continúan utilizando `withSyncLease` y su
fencing; no se permite que la presencia de un UUID sustituya ese protocolo.

## Identidad, league y snapshots

La recepción de identidad se coteja otra vez bajo lock del owner; mismatch false
y ausencia/error null son distinguibles. No guarda copia del PUUID o Riot ID.
La identidad de cuenta común se proyecta **en ambos ámbitos ranked explícitos**,
con el mismo requestId, nunca se declara prueba global en una cola elegida al azar.

Cada proyección LEAGUE conserva las entradas completas de su cola, tier, división,
LP, V/D y el timestamp de recepción original. Entradas no ranked se cuentan sin
copiar su payload. Array acotado a 32 entradas; números enteros seguros no negativos
y cadenas normalizadas acotadas. Si no puede proyectarse, la respuesta queda como
invalid_normalization; no avanzan fuentes ni rango a partir de ella.

- Cola ausente: `entryPresent=false`, `entries=[]`; el snapshot derivado por la
  política existente usa `origin=existing_absence_policy`. **No afirma un
  UNRANKED/0 LP literal enviado por Riot**.
- Dos entradas: `queueAmbiguous=true`, conserva ambas en orden. La vista operacional
  sigue usando la primera, como antes; el vínculo lo declara como
  `observational_first_entry`, sin resolver la ambigüedad probatoria.
- Snapshot nuevo: unit snapshot, ID y timestamp leídos del INSERT real.
- Sin cambio: unit disposition, `inserted=false`, mismo ID y timestamp original.
  La verificación puede actualizar `rankCheckedAt` sin insertar otro snapshot.
- Los enlaces se cotejan con la fila y los valores proyectados bajo SW; no se
  aceptan snapshots arbitrarios ni se cambian timestamps para empatar la recepción.

No se genera LP histórico desde MATCH. Los datos legacy y sus unknown siguen
unknown. `rankCheckedAt` continúa indicando verificación exitosa operacional,
sin convertir esa fecha en rango histórico, reconciliación o certificación.

## Remakes compartidos y D13 local

Conserva truePresent, falsePresent y absent, clasificación observacional y versión.
Base `true_marker_present`, `all_markers_false` solo cuando hay marcadores y ninguno
ausente, o `unknown`. Marcadores mixtos true/false se señalan como contradictorios.
La suficiencia probatoria sigue **unknown**, incluso con un true.

Sin marcadores, `false` sigue siendo la clasificación observacional existente;
su fundamento queda unknown, nunca false probado. Cero participantes también
produce base unknown. Requested/received Match ID y su concordancia se registran
separadamente. Respuesta discordante o HTTP fallido: intento personal mínimo,
clasificación irresuelta, sin modificar el bool de la partida solicitada; después
el script termina con error sanitizado. Source queue/map/timestamp discordantes:
conflicto, rollback, sin overwrite.

La fila match se protege antes de descubrir asociaciones; se bloquean todos los
owners por UUID, incluidos los pausados que ya tienen una participación afectada.
Cada uno recibe copias mínimas independientes por ámbito, con `belongsToTargetQueue`
explícito. Una partida SoloQ proyectada para el scope Flex **no** acredita un evento
Flex. No existen referencias probatorias entre dueños. Borrar un player elimina
sus headers/units por CASCADE y conserva al otro owner y la partida compartida.
Partidas sin owners no crean evidencia personal; su clasificación sigue el camino
observacional, sin afirmar cobertura de un jugador inexistente.

## Atomicidad, idempotencia y capacidad

Primitivas InTx sin otra conexión, tx, savepoint, lease o incremento independiente.
Orden: lease → match cuando procede → jugadores UUID ordenados → headers → units.
`markSourceChanged` registra cada dueño una vez; `flushSourceRevisions` SQL suma
R+1 una vez por dueño/SW. La revisión destino para units se obtiene mediante
`(source_revision + 1)::text` bajo row lock y se interpreta como bigint, sin Number.
Diagnósticos separados no declaran cobertura exitosa.

Clave inmutable por owner/requestId/cola, concordante con UNIQUE(owner, operationKey).
Retry del mismo handle comprueba JSON, versión, source, parent, tipo de unit y hash;
no inserta ni suma. Nueva recepción idéntica conserva otro evento y una nueva R.
El retry compartido conserva la clasificación anterior original, exige fanout
íntegro de owners actuales y verifica que el source no cambió desde entonces;
no vuelve a clasificar sobrescribiendo una operación posterior.

Política A: error en evidencia obligatoria, fuente, límite, overflow de R o fencing
revierte toda la unidad: snapshot/bool/player/capturas/R/checkpoint. No se reintenta
guardando evidencia por separado de una fuente cuyo commit falló.

Conserva límites D: JSON 64 KiB/header y 16 KiB/unit, 100.000 units y 32 MiB/header,
1.000 headers y 64 MiB JSON/player. Reserva conservadora 2× JSON antes del INSERT;
agregados de capacidad bajo owner lock. Un evento lleva una unit, sin superar
100 inputs por INSERT. No amplía límites ni añade borrado/retención automática.
Conserva 230 s global, 180 s recent, 20 s history, turnos/cuotas, 1300 ms mínimo,
Retry-After, fairness y fencing. **Cero peticiones Riot adicionales**.

## Validación local

Node **24.19.0**, PGlite efímero, cuentas ficticias y transportes simulados.
Los tests nuevos cubren alta autorizada y rechazada, rollback del INSERT, transporte
global mockeado, identidad mismatch/unknown, handles privados y padres falsos,
una/dos/ninguna cola, duplicados, una cola modificada, timestamps originales,
retry y nueva recepción, revisión SQL por encima de Number.MAX_SAFE_INTEGER,
segunda cola/capacidad/overflow/fencing, errores HTTP/normalización/red/timeout/429,
Demo, marcadores true/false/ausentes/mixtos, IDs discordantes, fanout y rollback,
cascadas personales, fuente contradictoria y ausencia de grants/sellos.

Dos regresiones anteriores se actualizan por el efecto autorizado: una captura
fallida de identidad posterior al alta tiene su propia SW/R; leer/renderizar
perfil conserva exactamente la evidencia escrita previamente por sync. La prueba
con fetch global deja de atribuir fuente Riot a un mock y comprueba synthetic y
fencing con lease vencido. No se reducen skips, timeouts o garantías numéricas.

Resultados finales con Node **24.19.0**, comandos ejecutados secuencialmente:

| Verificación                                                                                                                                   | Resultado                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Focalizadas: ranked/identity/remake, MATCH E.2.2, source-revision, database, persistencia D y RiotClient, `--maxWorkers=2 --hookTimeout=60000` | **339 aprobadas**, seis archivos                                                                                                                                                     |
| `npm run lint`                                                                                                                                 | Correcto                                                                                                                                                                             |
| `npm run typecheck`                                                                                                                            | Correcto                                                                                                                                                                             |
| `npm run test -- --maxWorkers=2 --hookTimeout=60000`                                                                                           | **1.352 aprobadas, 10 omitidas**; 58 archivos aprobados, dos omitidos                                                                                                                |
| `node scripts/validate-production-demo.mjs`                                                                                                    | Correcto; ejecutó **npm run build** y **40 comprobaciones HTTP** en copia aislada sin archivos de entorno ni cinco credenciales, con guard activo contra PostgreSQL/Riot autenticado |

**44 regresiones nuevas**: 43 en el archivo ranked/identity/remake y una en MATCH.
Las diez omitidas preexistentes son seis de PostgreSQL independiente para lecturas
consistentes de logros y cuatro del lease; no se configuró una base real como
sustituto. No se añadieron omisiones ni se amplió la configuración de timeouts.
Pruebas nuevas exclusivamente PGlite efímero y transporte controlado. Se añadieron
regresiones para un wrapper no atribuido y para JSON malformado: el script reutiliza
`playerSyncError` y no imprime mensajes crudos de payload/SQL.
El build aislado compiló y terminó correctamente; smoke sin conexiones prohibidas.

## Costos y bloqueadores E.3/F

Por verificación completa: dos headers + units de identidad y dos de ranked;
alta añade dos de ACCOUNT. Remake añade dos headers + units por owner asociado.
Lecturas de capacidades y scope son acotadas pero recorren JSON acumulado; costos
SQL, locks, índices, WAL, conexiones y latencia reales de Neon **no medidos**.
Cada verificación nueva consume headers incluso sin snapshot nuevo: cupo 1.000
puede agotarse, provocar rollback y frenar avance bajo política A. Se mantiene el
límite; acordar retención/cupos y medir antes de activación real, sin borrado tácito.

- PGlite prueba constraints/SQL/rollback locales; **no demuestra concurrencia
  PostgreSQL de conexiones independientes**, deadlocks, recepción Riot auténtica
  ni costos Neon.
- E.3: D13 externo (logs/run_progress/sessionStorage/backups), retención/finalidad
  aprobadas y acceso privado D18. CASCADE local no acredita eliminación externa.
- F y consumo futuro: autorizar reconciliación, validar precedencias, versiones,
  origen, ambigüedades, calendarios y permisos antes de materializar/sellar/grants.
  `source_revision` no equivale a recepción autenticada o temporada completa.
- Las migraciones 0007/0008 previas deben aplicarse con autorización independiente
  antes de cualquier código que dependa de ellas; no se inspeccionó Neon ni se
  asumió su estado. No hay nueva migración. No adaptar D v1 para consumir este
  formato como un recibo validado.
- Writers anteriores/SQL externo pueden dejar fuente sin captura. Retroceder
  código conserva tablas/evidencia, pero nuevas escrituras antiguas no adquieren
  procedencia retrospectivamente. Revisar exclusión de writers antes de grants.

Demo bloquea observadores antes del transporte y continúa sin DB. Sin feature
flags nuevos/cambiados, rutas públicas, consumidores en perfiles, grants,
equipamiento o sellos operacionales. `certification="not_established"` y
`grantAuthorized=false` permanecen restricciones de todos los JSON nuevos.
Sin push, deployment, Neon, Riot operacional, migración remota o ejecución del
script real de remakes; main y Production intactos.
