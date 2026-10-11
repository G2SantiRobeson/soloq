# 1.2.B.2.A — Evidencia confiable y revisión transaccional de fuentes

Fecha de auditoría: **11 de octubre de 2026**. Repositorio `G2SantiRobeson/soloq`, rama `staging`. HEAD y referencia local `origin/staging` al iniciar: `726daaf58372324e2b01a41cce9f6a86401c6f29`, cero commits por delante y cero por detrás. Cambios ajenos: `CLAUDE.md` modificado y `.claude/` sin seguimiento; ambos y `.env.local` se preservan. No se consultaron Neon, Riot ni datos operacionales.

**Alcance autorizado: auditoría y diseño documental, con un único commit local de este documento.** Ningún contrato, escritor, evaluador, flag, esquema, migración o permiso se implementa aquí. No habilita certificaciones ni concesiones y no inicia B.2.B.

Leyenda utilizada en todo el documento:

- **HECHO VERIFICADO:** inspección del código en la base indicada; no prueba de comportamiento remoto.
- **PROPUESTA:** implementación futura que requiere autorización independiente.
- **RIESGO:** consecuencia posible o frontera sin resolver, no incidente operacional confirmado.
- **DECISIÓN PENDIENTE:** semántica o condición operacional que no está aprobada o demostrada.

Referencias internas: [políticas D01–D18](CERTIFICATION_AND_GRANTS_DESIGN.md), [contratos B.1](VERIFICATION_CONTRACTS.md), [hardening](HARDENING.md), [sincronización](../STAGING_SYNC.md), [Fair Scheduling](../FAIR_SCHEDULING.md), [continuación individual](../INDIVIDUAL_BACKFILL.md), [checkpoints](../REAL_SYNC_PROGRESS.md) y [estados](../PLAYER_SYNC_STATE.md). Las notas históricas de esos documentos no sustituyen el código actual: por ejemplo, el fencing de `syncWrite` y la persistencia de Retry-After ya existen, aunque la auditoría antigua de Fair Scheduling describiera limitaciones previas.

## 1. Resumen ejecutivo

**HECHO VERIFICADO.** La ingesta real pasa por un cliente Riot de servidor, validación Zod, normalización y transacciones protegidas por el lease PostgreSQL compartido. Las lecturas de logros materializan contexto, snapshots y partidas en `REPEATABLE READ READ ONLY`, y evalúan después de cerrar la transacción. Esto proporciona una fotografía del almacenamiento, no procedencia histórica demostrada, cobertura exhaustiva o autorización de grants.

El dry-run B.1 no está conectado al perfil ni a la ingesta. Su resultado sigue incluyendo `certification: "not_established"`, `grantAuthorized: false`, `writes: "none"` y `provenanceAuthentication: "not_performed"`. Un contexto sintético coherente puede satisfacer la simulación; sus campos declarativos no autentican Riot ni comprueban una revisión transaccional.

**PROPUESTA.** Conservar la arquitectura actual y añadir, en fases separadas:

1. Capturas mínimas de procedencia y manifiestos de páginas/unidades confirmados en las transacciones de ingesta existentes, sin llamadas adicionales para instrumentar las respuestas que ya se obtienen.
2. Un materializador interno que vincule evidencia completa, ámbito, revisiones y recibos; nunca un objeto de navegador o el DTO visual.
3. Una revisión monotónica por jugador que todos los escritores de fuentes y elegibilidad incrementen atómicamente. Una futura concesión comparará y protegerá esa revisión dentro de su propia transacción corta.
4. Recibos de intervalo para Racha imparable y de temporada cerrada para OTP histórico, con desconocidos explícitos, reproducción e integridad. No deducirlos de `completed`, contadores o timestamps.

**RIESGOS críticos:** manifiestos actualmente ausentes; 404 recientes sin registro durable individual; falsos supuestos sobre límites/paginación Riot; fuentes legacy sin constancia de recepción; escritores omitidos —especialmente remakes compartidos—; despliegues antiguos que no incrementen revisión; copia de evidencia que sobreviva al borrado D13. Hasta resolverlos, conservar únicamente observaciones y simulaciones, sin grants.

## 2. Arquitectura actual verificada

### 2.1 Entrada y ejecución

| HECHO VERIFICADO | Archivo / función | Garantía y límite |
| --- | --- | --- |
| Alta autenticada y validada | `src/app/api/admin/players/route.ts:POST` | Origin + sesión admin + Zod. Resuelve Riot ID en servidor, guarda PUUID único y plataforma; no admite partidas/evidencias del cliente. |
| Actualización global | `src/server/sync/service.ts:syncAllPlayers` | Selecciona habilitados, ordena oportunidades recientes y backfills separadamente; un cliente serial dentro de `withSyncLease`. |
| Actualización individual | `src/app/api/admin/players/[id]/sync/route.ts:POST` → `syncPlayer` | Rango y recientes, sin backfill automático de esa ruta. |
| Histórico individual | `src/app/api/admin/players/[id]/backfill/route.ts:POST` | Operación manual compatible; `historyOnly` explícito omite rango/recientes. La continuación es una secuencia del navegador, no un worker persistente. Completed de temporada en ese modo evita abrir una reparación. |
| Cron existente | `src/app/api/cron/sync/route.ts:GET` | Endpoint operacional autenticado; Demo retorna skipped antes de secretos/DB. La existencia del endpoint no demuestra un scheduler activo. |
| Fencing | `src/server/sync/progress.ts:syncWrite` | En la misma transacción toma la fila `sync_locks` con FOR UPDATE, comprueba owner/expiración/run/revisión y revalida antes de confirmar. No es una revisión de fuentes. |
| Diagnóstico de runs | `src/server/sync/lease.ts:withSyncLease`, `progress.ts` | Solo latest/previous en JSON; flush intermedio agrupado a unos 15 s y checkpoints obligatorios. No archivo permanente por intervalo. |

**HECHO VERIFICADO.** Límites internos: 230 s globales; pasada reciente hasta 180 s, turnos de 30 s / 12 despachos; históricos de 20 s / 6 despachos en global; cinco participaciones nuevas recientes y 25 IDs históricos por lote. Histórico individual mantiene presupuesto de ejecución de 230 s y lote de 25. Lease nominal 330 s; puede extenderse para una espera Riot mayor. Timeout de request 10 s, margen de despacho 12 s, hasta tres intentos, pacing mínimo 1300 ms y Retry-After persistido. Son límites de SoloQ, no cuotas oficiales Riot. SQL no tiene un nuevo deadline cancelable específico.

### 2.2 Fuentes almacenadas y lectura

`src/db/schema.ts` contiene `players`, `matches`, `player_matches`, `ranked_snapshots`, `sync_locks`, sesiones y limitación de login. No contiene recibos, procedencia por registro, revisiones de fuentes, grants, eventos o equipamiento.

- `matches.id` es PK; `(player_id, match_id)` es PK de participaciones; PUUID del jugador es único. FK desde participaciones/snapshots al jugador con cascada.
- Partidas y participaciones se insertan con `onConflictDoNothing`, no mediante sobrescritura ni comparación exhaustiva con la fila conflictiva.
- Snapshots solo se insertan si falta una observación, cambia tier/división/LP/V/D o corresponde una nueva temporada. Timestamp mediante `defaultNow()` de BD en la transacción de persistencia, no una fecha histórica del acontecimiento proporcionada por Riot; `rankCheckedAt` se escribe después de LEAGUE-V4 satisfactoria incluso sin snapshot nuevo.
- LEAGUE-V4 sin entrada de una cola produce el estado interno Unranked con LP/counters cero; no es un registro ranked suministrado literalmente por Riot ni evidencia utilizable de LP para R1.
- `consistentAchievementReader` en `src/server/achievements/queries.ts` aplica aislamiento repeatable read y read only. Tres SELECT materializan jugador, snapshots y JOIN de partidas/participaciones, con filtros de ámbito y orden timestamp/ID. La transacción termina antes de CPU/presentación.
- El lector no trae PUUID a sus DTO, no autentica la recepción de cada fila y mantiene `intervalCoverage: "unproven"`, incluso con backfill completed y contadores iguales.
- `src/db/index.ts` usa postgres-js con pool máximo tres, `prepare: false`, connect timeout diez segundos y rechazo de DB en Demo. `.enableRLS()` no demuestra permisos efectivos del rol desplegado; no se inspeccionó ese rol.

**HECHO VERIFICADO.** Se revisó el soporte instalado Drizzle 0.45.3 / postgres-js, incluido el establecimiento de configuración transaccional antes de las lecturas. `tests/achievements-postgres.test.ts` dispone de seis casos opt-in de MVCC/read-only con sesiones PostgreSQL independientes; `tests/sync-progress-postgres.test.ts` de cuatro casos opt-in del lease. No se ejecutaron en esta fase documental y ninguno demuestra todavía el protocolo de revisión propuesto.

## 3. Mapa de procedencia de datos

| Recorrido | HECHO VERIFICADO | Evidencia que se conserva / que falta |
| --- | --- | --- |
| Cuenta → identidad | `RiotClient.account/identity/summoner`, `riot/schemas.ts` | HTTPS hacia hosts calculados en servidor, header de autenticación y schema de respuesta. En sync se usa el PUUID almacenado para las rutas; no hay comparación explícita del PUUID devuelto por `identity` con el almacenado ni recibo durable de vinculación. |
| Ranked → snapshot | `RiotClient.leagues` → `syncPlayer` | Valores LEAGUE-V4 normalizados y observados por SoloQ. No payload original, firma Riot, hash, request/capture ID o historial de verificaciones sin cambio. |
| IDs → página | `RiotClient.matchIds` | Respuesta validada solo como array de strings; consulta por PUUID, start/end/start/count=100, sin filtro queue/type. Páginas consumidas no se conservan íntegramente. |
| Detalle → validación | `RiotClient.match`, `matchSchema` | Tipos de campos y entero en varias métricas; no todo entero es no negativo ni todo ID tiene formato regional validado aquí. En recientes/histórico se comprueba `metadata.matchId === solicitado`. |
| Detalle → participante | `normalizeParticipant` | Busca el primer participante con PUUID exacto; si falta, importador rechaza. No exige unicidad de ese PUUID en el array. Normaliza campeón, resultado y estadísticas; descarta payload restante. |
| Remake → clasificación | `src/lib/match-outcome.ts:isRemake` | True si algún participante marca early surrender; si ningún true, devuelve false incluso si todos los marcadores faltan. Schema admite campo opcional; se pierde la distinción ausente/false en almacenamiento. Legacy puede tener null. |
| Detalle → almacenamiento | `importRecent/importHistory` | Solo modos estándar de mapa 11 CLASSIC; insert + participación atómicos. Conflicto no valida concordancia de campos ya almacenados. |
| BD → materialización | `achievementReader`, `evaluateStoredAchievements` | Filtra plataforma por prefijo MATCH-V5 escapado, cola y ventana; normaliza Date→ISO y conserva valores/IDs para el motor. `stored_official` es una etiqueta interna, no autenticación criptográfica. |
| Materialización → motor | `src/lib/achievements/` | Validación, deduplicación, barreras y cálculo determinista sobre entradas. Fixtures también pueden tener esa estructura. |
| Motor → UI | `presentation.ts`, `profile.ts` | Proyección sanitizada; evidencia visual truncada cuando procede. No sirve para reproducir una concesión. |
| Evidencia → verificador | `verification/verify.ts:simulateBadgeVerification` | Puro, sin IO ni constructor confiable. Comprueba estructura/concordancia sobre contexto suministrado, no origen real ni revisión actual. Solo tests lo invocan. |

**RIESGO.** Un token autentica la petición del servidor ante Riot; no firma offline el payload para un tercero. HTTPS y control del escritor sustentan una procedencia de servidor bajo el modelo de confianza de SoloQ, no una certificación emitida por Riot. Un hash de filas tampoco demuestra que los valores llegaron de Riot ni que nunca faltaron partidas.

**PROPUESTA.** Conservar, solo para campos necesarios de evidencia, instante de recepción, tipo de endpoint, plataforma/cola, IDs de fuentes, resultado validado, versión de schema/normalización/clasificación y asociación al commit de ingesta. No guardar headers, URL con PUUID, tokens o payloads completos. Identidad interna por FK al jugador; PUUID permanece solo en su vinculación existente. Un módulo `server-only` con factoría interna puede construir materializaciones confiables; una marca de TypeScript o `source: stored_riot` no es suficiente por sí sola. La confianza incluye permisos de BD, escritores inventariados y control del entorno.

**DECISIÓN PENDIENTE.** Para fuentes anteriores a esa instrumentación: estado de procedencia desconocida. No rellenar capturas ni timestamps antiguos. Revalidar un detalle legacy exige una futura llamada autorizada, contabilizada dentro del presupuesto existente; no se hará desde el render ni automáticamente por este diseño. Los LP históricos no pueden recuperarse consultando MATCH-V5 o el rango actual. Snapshots antiguos permanecen observaciones almacenadas, sin una constancia retroactiva de recepción inventada.

## 4. Garantías existentes y ausentes

| HECHO VERIFICADO existente | Ausencia / RIESGO para una futura verificación |
| --- | --- |
| Lease único y fencing por transacción | No revisión común de todas las fuentes del jugador ni arbitraje con grants, todavía inexistentes. Las llamadas de dominio sin cliente ligado a lease conservan un camino sin fencing para tests; no admitirlas como nuevos entrypoints operacionales. |
| Participación + cursor atómicos | Progreso reanudable, no archivo de todas las respuestas/decisiones anteriores. |
| PK y conflictos sin duplicación de inserts | No impiden que una respuesta nueva contradiga una fila previa; deduplicar no autentica. |
| Ventana histórica congelada entre lotes | No congela el índice de Riot ni la aparición tardía de IDs; offsets pueden desplazarse. |
| Página corta cierra el escaneo | Es una regla del importador, no una garantía demostrada de historial absoluto o snapshot estable del proveedor. |
| Historial contabiliza 404 | Recientes continúa tras 404 sin ledger durable por ID. Histórico retira ID de pending y aumenta unavailable, pero no conserva su identidad como manifiesto permanente. |
| Checks de metadata/participante en importadores | El script de remakes no comprueba explícitamente `metadata.matchId === id` antes de actualizar; schemas no sustituyen esa comparación. |
| Repeatable read para fuentes relacionadas | Puede captar progreso parcial legítimo y no evita cambios después de cerrar la lectura. |
| `backfillStatus`, contadores y marcas de fecha | Procesados incluyen existentes, excluidos y 404; discovered deduplica por página, no globalmente. No representan el denominador ranked ni una reconciliación. |
| `rankCheckedAt` independiente | No historial de todas las consultas exitosas sin cambio; no usarlo para fabricar snapshots intermedios. |
| Registros actuales de temporada | `CURRENT_SEASON.endAt` sigue null y el parser de logros solo admite temporada actual. No existe calendario histórico aprobado para OTP al cierre. |

**HECHO VERIFICADO: diferencia temporal concreta.** `importRecent` rechaza detalles estándar fuera de su ventana `[start,end)`. `importHistory` envía `player.scanStart` y `scanEnd` redondeados a segundos, pero valida el detalle contra inicio/fin de temporada, no contra ambos límites de esa consulta. No se encontró evidencia operacional de un ID fuera de ventana; sí falta esa garantía en el código. No cambiar la ingesta ahora: un futuro recibo debe registrar/descalificar esa discordancia y cualquier corrección funcional requerirá alcance autorizado y regresión.

**HECHO VERIFICADO: remake.** La ausencia de marcadores se trata como false actualmente y tiene prueba explícita en `tests/remakes.test.ts`. No alterar el cálculo o las estadísticas en esta fase. Instrumentar la presencia/ausencia y la base de clasificación permitiría a una futura política de evidencia distinguir esa inferencia de un marcador documentado; decidir si es prueba suficiente requiere documentación Riot y política versionada. Un bool legacy aislado no acredita el fundamento.

No afirmar públicamente: «Riot certificó», «todas las partidas de la temporada», «nunca perdió», «trayectoria completa recuperada», «OTP histórico concedido» o porcentajes de cobertura anual a partir de estos campos. Preservar R1/I1 `1.1.A-observed-v1` y OTP `1.1-otp-observed-v2`, 50 partidas y 13/20 exacto.

## 5. Contratos conceptuales de reconciliación

### 5.1 Dos formatos relacionados, no el mismo objeto

**PROPUESTA.** Separar:

- **Captura de ingesta:** afirma qué respuesta validada recibió y confirmó el servidor. Puede existir aunque falten páginas o detalles.
- **Recibo de reconciliación:** relaciona páginas, clasificaciones y fuentes del ámbito con una revisión concreta; admite pending/unknown/blocked. Solo puede sellarse cuando satisfaga el protocolo aprobado. No concede ni certifica por sí solo.

El `ReconciliationReceipt` draft B.1 no contiene páginas, historial de intentos, hash ni revisión de sellado. Es un objetivo de concordancia del dry-run, no formato operacional completo. El productor futuro requerirá un formato interno versionado adicional y un adaptador explícito al draft, o una nueva versión de contrato autorizada. No cambiar silenciosamente el significado del literal `half_open` o del origen declarado para aceptar pruebas antiguas.

### 5.2 Información mínima

| Campo conceptual propuesto | Significado / disponibilidad actual |
| --- | --- |
| `receiptId`, `captureId`, `traceId`, `formatVersion` | IDs opacos de servidor; correlación a run opcional, nunca identificador de navegador como autorización. Solo run/checkpoints actuales tienen correlación durable limitada. |
| Identidad / ámbito | FK playerId, plataforma, cola ranked y temporada; vínculo de cuenta comprobado por el materializador, sin duplicar PUUID. Plataforma/PUUID existen; no hay prueba durable de vinculación por recibo. |
| Intervalo objetivo | UTC en milisegundos `[from,to)` y criterio de selección; distinto de consulta y de fecha de lectura. B.1 ya declara intervalo, no lo produce. |
| Consulta efectiva | Tipo endpoint, host regional como categoría, `startTime/endTime` exactos en segundos, `start`, `count=100`, filtros realmente enviados (hoy queue/type ausentes), versión de semántica de límites. No URL secreta. |
| Páginas | Número/offset, instante de recepción, IDs en orden recibido incluidos duplicados, longitud y criterio/resultado de cierre. Guardar terminal corta/vacía. No deducirlas de scanOffset. |
| Manifiesto descubierto | Unión deduplicada de IDs por escaneo, con referencia a páginas. No reemplazar por discovered ni descartar repeticiones de la respuesta original. |
| Manifiesto procesado | Una disposición por ID: resolved, reused-attested, excluded-with-basis, unavailable-404, pending, invalid o unknown; estado/versiones y captura que lo respalda. |
| Detalle suficiente | Timestamp original de comienzo, queue/map/mode, resultado, championId y base de remake; campos mínimos normalizados para I1/OTP. No detalles ajenos ni PUUID de participantes. |
| Orden | Orden recibido de páginas separado del canónico `(timestamp, matchId)` ascendente. IDs no son una secuencia de juego. Empate de timestamps competitivos queda ambiguo, aunque el desempate sea determinista. |
| Desconocidos | Resultado/campeón/remake ausente, timestamp inválido, inconsistencia de fuentes o detalle inaccesible. Un estado desconocido nunca se elimina para mejorar un resultado. |
| Captura / corte / revisión | Inicio/fin de capturas, fecha de lectura, dataCutoff, revisión materializada, revisión de sellado y hash del conjunto. Son conceptos separados. |
| Integridad | Algoritmo y versión de canonicalización, hash de evidencia completa y hash de manifiesto/recibo. El hash detecta discrepancias, no autentica al proveedor. |
| Limitaciones | Recuperabilidad, captura en varios momentos, indexación tardía, granularidad temporal, fuentes legacy, exclusiones y desconocidos. Sin promesa de totalidad absoluta Riot. |
| Estado de reconciliación | collecting, paused/blocked, scan_complete, reconciled o invalidated, con códigos internos sanitizados. No equivalentes a backfillStatus ni a grant. |

**PROPUESTA de integridad.** Canonicalizar valores originales normalizados, UTC, enteros seguros, null explícito, IDs únicos y orden canónico; incluir ámbito, versiones y parámetros. Separar hash de contenido de fuentes del hash de captura con sus fechas para no confundir un mismo conjunto con una nueva recepción. Guardar el contenido mínimo reproducible, no solo hash o veinte IDs del DTO. Rechazar duplicados contradictorios y verificar hash al materializar. No añadir claves de firma/HMAC o secretos: sin necesidad de transportar pruebas fuera de la frontera confiable, permisos y protocolo de escritores son la primera defensa. Un actor con acceso completo a BD puede alterar contenido y hash; ese límite debe declararse.

### 5.3 Recibo A: intervalo de Racha imparable

**PROPUESTA.** El motor sigue eligiendo una racha con I1. El recibo cubre todos los IDs recuperables del intervalo que contiene la primera y última victoria elegidas, incluyendo remakes y barreras conocidas, no solo las cinco victorias. Su extremo superior debe ser estrictamente posterior al comienzo de la última partida: B.1 bloquea `end <= required.to`.

Retener todas las páginas consultadas y la clasificación de cada ID. El conjunto ranked resuelto dentro del intervalo debe concordar exactamente con la evidencia materializada a R. Un ID sin detalle, sin cola conocida, con 404 o remake/resultado ambiguo no puede desaparecer mediante un filtro. Una derrota tardía dentro del intervalo cambia R e invalida la vigencia del recibo previo hasta revisión. No incorporar la regla distinta del premio comunitario Imparable ni modificar ese premio.

No hace falta acreditar ausencia de derrotas fuera del episodio para afirmar la racha registrada y reconciliada del intervalo. Tampoco se acreditan derrotas que Riot nunca haya permitido recuperar. El margen puede incluir partidas exteriores conocidas; el adaptador debe conservar su clasificación y limitar el conjunto objetivo, sin omitir barreras del intervalo.

### 5.4 Recibo B: temporada/cola de OTP histórico

**PROPUESTA.** Manifiesto y denominador de la temporada regional cerrada `[seasonStart,seasonEnd)` para una sola plataforma y cola. Incluir todos los registros válidos, remakes confirmados excluidos del denominador con base conservada, y detalles desconocidos/404 que bloqueen el cierre probatorio. Conservar N, campeón dominante, C y la comparación `20*C >= 13*N`, sin redondear, más el conjunto que permite recalcularlo.

No usar wins+losses de LEAGUE, total de todas las colas, pool visible, límite de cuarenta ni backfillProcessed como denominador. El cierre debe venir de calendario regional aprobado/versionado y una confirmación operacional, no de reloj de render, completed o fecha sintética. En la base auditada `endAt: null`: no se puede producir un recibo OTP histórico positivo real. D06 deja fechas/plazos/reservas sin definir. El OTP dinámico de muestra importada sigue funcionando independientemente, sin convertirse en grant.

### 5.5 Precisión y límites: lo comprobado y lo pendiente

**HECHO VERIFICADO del código, no semántica garantizada por Riot:**

1. Recientes redondea ambos límites hacia abajo a segundos, resta dos minutos al corte actual y aplica overlap de 24 h al inicio, limitado a temporada. Compara `gameStartTimestamp >= start && < end`.
2. Histórico congela un `scanEnd` que puede contener milisegundos. Envía `floor(scanStart/1000)` y `floor(scanEnd/1000)`. Al terminar mueve scanStart a `max(seasonStart, end - 24 h)` y borra end/offset/pending; los contadores no conservan la ventana completa anterior. La validación del detalle usa temporada (§4).
3. Ninguna de esas consultas envía cola. Offset aumenta por longitud original de página; deduplicación de IDs solo dentro de cada página. Exactamente cien exige otra página; menos de cien marca exhausted.
4. Los lectores de logros usan límites SQL semiabiertos en milisegundos por timestamp de inicio. Los límites draft del recibo son semiabiertos y sus consultas deben estar en segundos.

**PROPUESTA.** Mantener tres intervalos distintos: objetivo en milisegundos, parámetros efectivos enviados y predicado local. Para cubrir un último evento en t, elegir `to > t`; el query superior conceptual se redondea hacia arriba cuando haga falta para envolver el objetivo, y luego se filtra localmente al intervalo exacto. Es una propuesta del futuro productor, no modificación al importador ni afirmación de que Riot interprete endTime como exclusivo. Registrar cada redondeo y margen. Un detalle fuera de la consulta o ámbito se diagnostica y bloquea el sellado; no se fuerza a encajar.

**DECISIÓN PENDIENTE — consulta documental, sin clave ni petición operacional:** comprobar la especificación primaria MATCH-V5 de [Riot Developer Portal](https://developer.riotgames.com/apis#match-v5): inclusividad de startTime/endTime, timestamp al que se aplican, límites/count/start, orden y estabilidad, filtros queue/type, retención recuperable, comportamiento de 404 e indexación tardía. Consultar también [guía oficial LoL](https://developer.riotgames.com/docs/lol) para el significado y disponibilidad de marcadores de remake. Registrar fecha/versión de esa verificación antes de fijar el productor; no se consultaron esas fuentes externas en esta tarea.

**RIESGO.** Una ventana temporal fija no ofrece un token de fotografía Riot: IDs tardíos pueden mover offsets entre páginas o lotes. Terminar un recorrido y comprobar concordancia con BD demuestra solo ese recorrido. Una repetición estable puede aumentar confianza, pero tampoco demuestra exhaustividad absoluta. La política de antigüedad, estabilidad/márgenes y si hace falta una segunda pasada queda pendiente; no inventar días ni aumentar llamadas. Hasta aprobarla, distinguir `scan_complete` de `reconciled` y bloquear uso probatorio operacional.

## 6. Inventario completo de escritores relevantes

**HECHO VERIFICADO.** Inventario obtenido buscando operaciones Drizzle insert/update/delete/transaction y SQL explícito en `src/` y `scripts/`. Completo respecto de esa base versionada; no incluye SQL de consola, otros repositorios o actores externos que no se inspeccionaron. Las rutas delegadas se enumeran para no confundir entrypoints con escritores adicionales.

En la tabla, **SW** es `syncWrite` dentro del lease existente: transacción con fencing. **R futura** significa actualización aritmética atómica de sourceRevision una vez por transacción con cambios relevantes, bajo el protocolo de §7. Ninguna existe hoy.

| Escritor / ruta o función | Tablas y transacción actual | Riesgo de omitir R / cambio futuro propuesto | Prueba futura necesaria |
| --- | --- | --- | --- |
| Alta: `api/admin/players/route.ts:POST` | `players` en SW; account/summoner fuera de tx; después delega sync y backfill | Crear identidad/revisión de inicio, capturar vinculación sin duplicar PUUID; no marcar fuentes anteriores como autenticadas | Alta + captura atómicas, PUUID duplicado sin evidencia huérfana, fallo posterior conserva alta sin éxito inventado |
| Ranked: `sync/service.ts:syncPlayer` bloque snapshots | `players` identidad/icono/rankCheckedAt/resultado y `ranked_snapshots` en una SW | R por cambio de fuente/contexto; captura ranked con timestamp original y versión. Verificación sin cambio sigue modificando rankCheckedAt materializado | Ambos queues, sin cambios, ausencia de entrada, rollback snapshot/rankCheckedAt/captura/R |
| Recientes: `sync/recent.ts:importRecent` detalle | `matches` + `player_matches` en SW; existing lookup fuera | R para jugador y cualquier asociación realmente afectada; captura mínima y comparación de conflictos, disposition por ID | Dos inserts atómicos, duplicado idéntico sin inflar R de fuente, conflicto discrepante bloqueado, participante ausente/duplicado |
| Recientes: primera página y cierre | `players.lastAttemptAt` en SW; cierre lastSyncedAt/updatedAt/fin de fase en otra SW | lastAttemptAt es oportunidad, no prueba. Capturar página/404 antes de descartar; R cuando cambia cobertura probatoria, no solo diagnóstico | Página vacía/cien/404, cierre no sella recibo por sí solo, crash entre captura y cobertura |
| Histórico: reset estacional de `importHistory` | `players` season/status/counters/scan en SW | R por cambio de contexto; nuevo capture/scan ID, no reutilizar recibo de otra temporada | Reset conserva datos previos, nuevas fuentes no heredan autoridad, autorización para calendario separado |
| Histórico: abrir ventana | `players.scanEnd/status/startedAt` en SW | R si forma parte del contexto/recibo; conservar consulta congelada durable, distinguir scan de run | Nuevo lote mismo scan, reload no cambia ventana, reloj/redondeo correcto |
| Histórico: descubrir página | `players.pending/offset/exhausted/discovered` en SW | Guardar página y terminal junto a cursor; R al cambiar cobertura/captura que usa verificador | Rollback de página y cursor, ID repetido entre páginas, offsets recuperados |
| Histórico: consumir ID | `matches`, `player_matches` cuando procede y `players.pending/processed/unavailable` en una SW | Disposición durable aun si existing/excluded/404; R + captura + cursor atómicos | Crash antes/después de commit, 404 pendiente→unavailable, exclusiones justificadas, retry sin doble conteo |
| Histórico: finalizar escaneo | `players` cursor siguiente/status/lastBackfillAt/fin fase en SW | Archivar ventana/manifiesto antes de reset; R por cambio de cobertura; no crear recibo automáticamente por completed | Ventana anterior reproducible, completed con unknown/404 queda bloqueado, siguiente incremental no pisa prueba |
| Fases: `sync/player-state.ts:beginPlayerSyncPhase`, `service.ts` catches/finales | `players` lastSyncAttempt y errores en SW | Diagnóstico de intento/error por sí solo no cambia evidencia ni R. Status histórico/cobertura usado por materializador sí debe hacerlo. No limpiar recibo por éxito de otra fase | Error no concede ni pierde pending, cambio coverage revisa, simple log/attempt no genera tormenta de R |
| Pausa/reactivación: `api/admin/players/[id]/route.ts:PATCH` | `players.enabled/updatedAt` en SW | R obligatoria en cambio de elegibilidad; pausa impide nueva concesión, no revoca automáticamente un evento | Carrera pausa vs futura confirmación, PATCH mismo valor idempotente |
| Borrado: misma ruta `DELETE` | `players` + cascadas `player_matches/ranked_snapshots`, SQL limpieza de `matches` sin asociaciones en SW | Lock de jugador y borrado D13 de toda evidencia/grants/eventos personales futuros. No incrementar una fila ya eliminada ni retener un tombstone personal implícito | DELETE vs materialización/grant, cascada completa/rollback, otro jugador del mismo match intacto, recreación no reata recibos |
| Reclasificación: `scripts/backfill-remakes.ts` | UPDATE `matches.isRemake` por ID en SW; hasta 100 null, lease compartido, detalle afuera | Cambia fuente compartida: R de **todos** los jugadores asociados; captura base de clasificación y comparación de matchId antes de actualizar | Dos jugadores en mismo match, asociación concurrente, marker ausente, ID discordante, rollback sin revisiones parciales |
| Delegados global/admin/cron | `syncAllPlayers`, `api/admin/sync`, `api/cron/sync` llaman anteriores bajo lease | No duplicar R por wrapper ni por respuesta HTTP; asegurar instrumentación en escritor real | Fair Scheduling/partiales/presupuestos/429 invariantes y sin doble incremento |
| Delegados individuales/alta | `api/admin/players/[id]/sync`, `.../backfill`, alta llaman anteriores | Sin nueva vía que omita capturas/R; historyOnly completed no fabrica un recibo | Manual vs automático, solo histórico, retry y cooldown sin prueba sintética |
| Lease/telemetría: `sync/lease.ts`, `sync/progress.ts:checkpoint` | `sync_locks` en transacciones de adquisición/flush/finalización | No usar run.revision como R. Solo telemetría no incrementa R; copiar prueba en latest/previous perdería evidencia | Evicción de run no pierde manifiesto, owner viejo no escribe captura/R |
| Correcciones de partidas/participaciones/snapshots/identidad | No se encontró ruta genérica actual; ingesta no actualiza en conflicto. Plataforma/PUUID no tienen PATCH público actual | Toda futura corrección exige protocolo, evidencia de cambio y R para afectados; no autorizar SQL fuera de él | Corrección compartida, modificación de cola/fecha/campeón/resultado, cambio plataforma/vínculo, mismo valor sin duplicado |
| Cobertura/recibos/capturas futuros | No existen escritores hoy | Persistencia/sellado/invalidez deberán modificar R si cambia la evidencia consumida; no ocultar ese escritor al cerrar el manifiesto | Sellado a revisión exacta, comparación de fuente completa, no bucle de autoinvalidación (§7.4) |
| `scripts/migrate.ts` / migraciones SQL | Runner Drizzle con su conexión; no usa lease Riot | DDL puede invalidar formatos/semántica. Futuras migraciones de datos deben inventariar afectados y R o prohibir concesiones durante transición | Filas legacy desconocidas, journal íntegro, rollback aditivo, versión de escritor antigua bloqueada |

**HECHO VERIFICADO — exclusiones justificadas del protocolo de fuentes:** `src/server/auth.ts` escribe `admin_sessions/login_attempts`; no cambia fuentes ranked ni elegibilidad del jugador. Scripts de iconos/rangos solo descargan assets. Validadores Demo y suites locales escriben fixtures/DDL en entornos desechables y no son productores confiables de evidencia Riot. Consultas de perfil, premios, estadísticas y weekly-lp son lecturas. No se encontró otro escritor de fuentes en `src/`/`scripts/`; no se inspeccionó ni ejecutó SQL externo.

## 7. Protocolo de revisión transaccional propuesto

### 7.1 Modelo mínimo y semántica

**PROPUESTA.** Revisión `source_revision` por jugador, entera monotónica de 64 bits, representada como string decimal en contratos JSON para evitar pérdida de precisión JavaScript. Cero puede ser la línea de partida tras una migración futura, **no** prueba de verificación anterior, fecha ni autenticidad. No reutilizar updatedAt, lastSyncedAt, rankCheckedAt, counters o run.revision.

Una revisión cubre identidad/ámbito/elegibilidad, fuentes de partidos/snapshots, clasificación compartida y contexto/recibos de cobertura consumidos. Inicialmente es conservadora entre colas/temporadas. Los cambios puramente diagnósticos y de lease no alteran R. Una verificación ranked sin nuevo snapshot sí cambia rankCheckedAt: si sigue formando parte de la materialización futura, debe incrementar R. Nunca incrementar solo por leer, evaluar, renderizar, conceder o reevaluar sin cambios de fuente.

**PROPUESTA de persistencia mínima, aún sin DDL:** una columna de revisión y dos entidades de evidencia: cabecera de captura/reconciliación ligada al jugador, y unidades/páginas ligadas a esa cabecera. La cabecera conserva ámbito, formato, consulta, estado y sello; las unidades conservan IDs/disposiciones/campos mínimos por página o commit de ranked. Capturas de rank y escaneos de matches pueden compartir esas entidades con formatos discriminados. Evitar una tabla por campo y el JSON monolítico reescrito por cada ID. La materialización de decisión podrá conservar evidencia sellada reproducible de D11 cuando se autoricen grants/eventos; estos no se crean en B.2.A.

La implementación deberá revisar si dos tablas son realmente el mínimo útil con muestras de tamaño/reanudación/borrado antes de generar schema. No duplicar todos los stats ni introducir una cola o storage externo. FK a `players` para cabeceras y cascada de unidades; contenido personal nunca queda solo en un blob global sin dueño.

### 7.2 Escritor de fuente

1. Si es ingesta/mantenimiento actual, adquirir y conservar el **lease Riot existente**; hacer requests y normalización fuera de la transacción, como hoy.
2. Dentro de la SW, identificar todos los jugadores afectados y bloquear sus filas de revisión en orden estable de UUID antes de modificar fuentes. En una clasificación compartida obtener miembros después de adquirir el lease; todos los escritores de asociaciones deben seguir pasando por ese mismo lease.
3. Confirmar modificación de fuente, captura mínima/disposición y avance de cursor en esa transacción. Un retry idéntico no genera otra recepción inventada ni nuevo insert de fuente; una nueva recepción real puede tener capture ID nuevo con un mismo hash de contenido.
4. Incrementar por expresión de BD `R = R + 1`, una vez por jugador afectado y transacción relevante. Nunca read-modify-write en memoria. Fuente, R y evidencia confirman juntas o hacen rollback juntas.
5. Solo después del commit publicar el avance en memoria/respuesta; una observación recibida pero no persistida no cuenta como fuente confirmada.

**RIESGO de compartidos.** Bloquear únicamente al jugador que solicitó la partida no cubre los demás `player_matches` ligados a `matches`. Bajo los escritores actuales, el lease común serializa descubrimiento de afectados y nuevas asociaciones. Un futuro escritor que no use ese lease podría introducir miembros después de la lista y omitir R: quedará prohibido hasta diseñar/probar coordinación de asociaciones (locks de registros y relectura o una alternativa transaccional adecuada). No afirmar que una SELECT sola protege contra phantoms. No añadir un segundo lease.

### 7.3 Lectura, evaluación y futura confirmación

1. El materializador, no el cliente, abre `REPEATABLE READ READ ONLY`; lee jugador + R, ámbito/identidad, fuentes completas y recibos/capturas compatibles dentro de la misma fotografía. Si se agregan SELECT de evidencia, permanecen en esa misma tx. No llamadas Riot.
2. Valida procedencia interna, manifiesto y hash, materializa datos y cierra tx. Evalúa/verifica después: R, hash, versiones, alcance y limitaciones viajan juntos. Un formato antiguo/incompleto o recibo cuyo conjunto no coincide produce bloqueo, no certificación.
3. **Solo en una fase de grants autorizada:** transacción corta READ COMMITTED, SELECT del jugador/R con FOR UPDATE, comprobar existencia, enabled, identidad y `current R == evaluated R`. Un writer anterior hace que se lea su R confirmada; un writer posterior espera esa fila y marca la decisión como pendiente al confirmar después. No usar una lectura antigua sin lock como compare final.
4. Comprobar en esa tx la autorización D17 de la versión exacta desde un registro/control transaccional confiable; protegerlo frente a retirada concurrente. Un boolean o manifest en un deployment antiguo no basta. Orden futuro común: filas de jugadores por UUID, autorización/política, grant/evento. Ningún proceso de grants adquirirá el lease Riot después de esos locks; los writers de ingesta toman lease primero y no dependen de grants.
5. Insertar/actualizar grant y evento idempotentes con unicidad D07/D08 y revisión de la propia decisión, sin incrementar R por conceder. Si falla comparación o autorización, no escribir grant/evento parcial; rollback y rematerialización acotada, sin Riot. La aritmética/evaluador completo no se ejecuta bajo el lock.
6. Nueva fuente después de la decisión: `current source_revision > lastReviewedSourceRevision` deja una revisión durable pendiente. Lectura pública/equipamiento futuros no presentan esa insignia como recién verificada hasta revisar impacto; una diferencia de R no revoca automáticamente, puede ser un cambio irrelevante de otra cola. El reconciliador confirmará la revisión ya comprobada con compare protegido, incluso si conserva el grant y evidencia original.

**DECISIÓN PENDIENTE.** Identidad operacional de staging/base y registro de autorización D17, roles efectivos, límite de intentos/tiempo y presentación neutra durante revisión. La aprobación D01–D18 en Markdown no sustituye ese control. No modificar `certification` o `grantAuthorized` de las observaciones/dry-run actuales para conectar un futuro escritor.

### 7.4 Sellado y recuperación sin circularidad

**PROPUESTA.** Capturas pueden avanzar entre lotes R0→R1→R2; no declarar que sus respuestas pertenecen todas a un mismo instante Riot. Al sellar, materializar el conjunto final a R, contrastarlo con manifiesto completo, cerrar lectura y comparar R bajo lock. Si persiste un recibo nuevo que modifica la evidencia disponible, esa transacción sube la revisión a R+1 y guarda explícitamente `inputRevision: R`, `sealedAtRevision: R+1` y hash del contenido probado. La siguiente materialización usa R+1 y comprueba que el recibo sigue correspondiendo al conjunto de fuentes; no exige ciegamente que inputRevision sea la revisión posterior al propio sellado. No usar un hash autorreferente ni autoinvalidar perpetuamente cada recibo al guardarlo.

El sellado consume solamente trabajo de BD/CPU acotado, fuera de locks para el cálculo. Una revisión diferente exige recomprobar; después de nuevos datos el recibo previo no recupera vigencia por reutilizar capture ID. Guardar páginas/unidades y estado collecting/pending permite continuar tras reinicio sin depender del navegador o latest/previous. No modificar scanPending para fabricar una reconciliación ni reiniciar el backfill.

Grants pendientes se derivan de R actual vs revisión comprobada, en almacenamiento persistente; no requieren una cola externa. Reintentos de decisiones usan clave de operación + revisión de fuentes + versión de política + hash canónico, con constraint de unicidad y transacción. La versión no añade otra insignia a la clave D07. Ante pérdida de respuesta tras commit, consultar por clave idempotente antes de repetir; no interpretar timeout como rollback.

## 8. Riesgos de concurrencia y pruebas requeridas

| Escenario | PROPUESTA de resolución | Prueba futura |
| --- | --- | --- |
| Dos escritores al mismo jugador | Lock compartido de fila y suma atómica; ninguna actualización asigna R calculada afuera | Dos conexiones: R aumenta dos veces con fuentes confirmadas, sin lost update |
| Fuente cambia entre lectura y grant | Comparación protegida rechaza R obsoleta; rematerializar | Barrera tras SELECT de lector, writer confirma, confirmación no escribe grant |
| Grant toma fila antes del writer | Decide a R; writer posterior espera y aumenta R; revisión pendiente durable | Bloqueo real y detección tras commit, sin afirmar que el grant vio datos futuros |
| Cambio compartido/remake | Revisar todos los asociados; orden estable y mismo lease para asociación | Dos jugadores y dos sesiones, insert de asociación vs corrección; ningún grant sigue marcado al día erróneamente |
| Dos decisiones iguales | Unicidad grant + decisionKey; referencia de evento confirmada atómicamente | Dos conexiones, un solo evento/estado, respuesta perdida recuperable |
| Corrección, DELETE o pausa concurrente | Fila protegida, elegibilidad/identidad actuales; DELETE gana o elimina lo confirmado conforme D13 | DELETE/PATCH vs confirmación, ninguna evidencia/grant huérfano |
| Rollback o lease perdido | Fuente/cursor/captura/R vuelven juntas; writer viejo no confirma | Error después de actualizar R o captura; expiración/takeover conservados |
| Deadlock o conflicto transaccional | Orden de locks; rollback/reintento limitado de toda unidad | Locks cruzados en dos jugadores, fallo real no convertido en success |
| Cambio de política concurrente | Control D17 protegido en commit, fallo cerrado | Retirada simultánea impide confirmar autorización obsoleta |
| Writer antiguo / SQL manual | No habilitar verificación operacional hasta drenar writers y asegurar protocolo | Prueba de writer deliberadamente omitido debe demostrar el fallo; gate sigue cerrado |

**HECHO VERIFICADO.** La prueba MVCC actual demuestra la fotografía de varias SELECT, no el cierre de la carrera posterior ni sourceRevision. El lease actual coordina Riot, no certifica el contenido de todos sus checkpoints. Nunca extrapolar esas pruebas a un protocolo nuevo.

**PROPUESTA de niveles de prueba:** unitarias para canonicalización, reglas de invalidación, matrices de ámbito y fallo cerrado; PGlite para DDL aditivo, filtros, manifiestos, FK/D13, rollback e idempotencia funcional; PostgreSQL local desechable con **dos conexiones independientes** para esperas reales, MVCC, compare/locks, deadlocks y carreras fuente/grant/política/DELETE. Usar barreras controladas, no solo sleeps. Fetch Riot siempre simulado y fixtures ficticios. No usar DATABASE_URL del checkout ni Neon. Una suite opt-in omitida no acredita concurrencia aprobada.

Preservar regresiones existentes de LP, Firma, premios, estadística, Demo, perfiles y sincronización. No cambiar expectativas para aceptar pérdida de evidencia ni aumentar cuotas. Ensayar más de cien IDs, página terminal vacía, duplicados entre páginas, índice cambiante, 404, marca remake ausente/false/true/null, detalle fuera de ventana, empate temporal, conflicto de almacenamiento, fuente legacy y temporada abierta.

## 9. Seguridad, privacidad y eliminación D13

**PROPUESTA.** Toda cabecera, unidad, recibo, copia de prueba, evento personal y grant futuros deben tener propiedad trazable hasta playerId. Cascada de FK o eliminación explícita dentro de la transacción de DELETE deberá cubrirlos; ninguna referencia exclusiva al match compartido deja una prueba personal sin dueño. Un recibo con datos de un jugador no se reutiliza como prueba personal de otro sin su propia vinculación y revisión. Los datos compartidos de la partida conservan las asociaciones de otros jugadores; el borrado no los elimina indiscriminadamente.

Si hay caches futuras, claves por identidad/ámbito/revisión y purga de todo contenido personal al borrar. Este diseño no añade caches. Hashes de evidencia, IDs y trace IDs vinculables también son información asociada: no dejar un tombstone personal o hash permanente por considerar que no contiene nombre. Los tests incluirán cascadas, eventos, unidades, grants y búsquedas inversas tras el borrado. Rollback debe conservar íntegra la operación previa.

**RIESGO actual relevante:** `sync_locks.run_progress` conserva UUID/último Match ID hasta rotación de latest/previous, aunque el DELETE del jugador no lo borra. La corrección visual anterior ocultó paneles sin borrar checkpoints legítimos. No alterar eso en esta fase. Al implementar D13 deberá decidirse y probarse una redacción/borrado selectivo de referencias personales de diagnóstico, sin reiniciar el lease ni eliminar checkpoints de otros jugadores. No prometer que la cascada de players ya cubre ese JSON, logs o respaldos.

**DECISIÓN PENDIENTE.** Finalidad y plazo de conservación, tratamiento de logs/respaldos, continuidad tras recreación y cualquier excepción mínima. No hay retención indefinida ni plazos legales inventados. No se propone guardar evidencia personal adicional hasta definir su ciclo de vida. Ante borrado/recreación, nuevo playerId y nuevo contexto; recibos antiguos no se transfieren ni se regrant automáticamente. Resolver deduplicación entre cuentas recreadas sin retener información contra D13 requiere decisión explícita.

D17: política/versiones/autorización verificables desde servidor con control operacional, no el flag experimental. D18: motivos sensibles y detalle de manifiestos en acceso privado autenticado; público solo proyección mínima y limitaciones aprobadas. Sin nuevas rutas públicas, sin PUUID/credenciales/payloads en logs, sin aceptar grants desde cookies/query/header. Un cliente puede solicitar una acción administrativa autorizada, nunca suministrar evidencia probatoria ni su autorización.

**HECHO VERIFICADO.** Production Demo rechaza DB/Riot; perfiles Demo usan fixtures, y verificación B.1 no está integrada. **PROPUESTA:** cualquier productor/verificador operacional futuro debe rechazar Demo/Production antes de abrir DB o procesar escrituras. `ACHIEVEMENTS_EXPERIMENTAL` controla presentación, no grants, y Preview no implica automáticamente rama staging o base correcta. Esta tarea no modifica ni activa ningún flag.

## 10. Impacto en sincronización

**PROPUESTA preferida:** instrumentar en los puntos de persistencia de §6, manteniendo requests fuera de transacciones y el cliente serial. Página/cursor/captura se confirman juntos; detalle/captura/participación/progreso se confirman juntos. No una transacción adicional por contador o animación; no un verificador completo dentro de cada SW. Capturas de recepción solo después de validación, sin reinterpretar una respuesta de red como insert confirmado.

Reutilizar las respuestas ya obtenidas no añade llamadas Riot. Para existing, enlazar únicamente una fuente previamente atestada y cuyo hash/versiones sigan concordando; un simple exists no certifica procedencia. Reutilizar conserva la fecha original de recepción: no afirma que Riot haya vuelto a entregar ese detalle ni que no lo haya cambiado después. La suficiencia de esa antigüedad para reconciliar sigue sujeta a la política pendiente. Un ID excluido requiere base registrada; un 404 conocido siempre queda como gap. Para consultas actuales sin queue, conservar el manifiesto bruto y disposiciones de otras colas/modos: al proyectar un recibo ranked no ocultar IDs cuya cola no se conoce. Opcionalmente un productor futuro con filtro queue podría simplificarlo, pero exige revisión del contrato/API y autorización; no añadir automáticamente un segundo recorrido.

Recent no tiene cursor de páginas durable: mantener su estrategia y deduplicar capturas por intento/scan/página/disposición, sin añadir un cursor funcional por accidente. History retoma su cursor; asignar identidad durable de escaneo de evidencia entre runs, separada del run ID. Cuando no existe manifestación del prefijo ya procesado de un cursor legacy, registrar ese segmento como desconocido; no dar por recopilado el pasado ni reiniciar la temporada para conseguir una prueba.

**RIESGO.** Persistir 404/exclusiones/páginas vacías exige cubrir caminos que hoy retornan/continúan sin escritura de detalle. Son nuevas escrituras de evidencia futuras y deben estar inventariadas, ser acotadas y probadas; no fingir coste cero. Si la captura falla, decidir/probar una política explícita: recomendación inicial, rollback de la unidad de progreso que afirmaría haber conservado evidencia y reanudación desde checkpoint, sin fabricar un recibo. No capturar errores para conceder ni hacer reintento Riot extra inmediato. La elección debe medirse para evitar que una falla de instrumentación perjudique indefinidamente la ingesta; puede mantenerse observación sin elegibilidad probatoria, con fallo durable, si se diseña una alternativa atómica autorizada.

No aumentar 230 s, los turnos/lotes, tres intentos o frecuencia; no bajar 1300 ms; preservar Retry-After y fencing. Fair Scheduling no se convierte en planificador de grants. Reconciliar localmente capturas es trabajo independiente con su propio presupuesto CPU/SQL futuro, sin llamadas de render y sin monopolizar el lease. Datos legacy que requieran nueva consulta necesitarán un trabajo explícito autorizado dentro de capacidad existente; no redescargar temporadas para cada visita.

## 11. Costes y rendimiento

**HECHO VERIFICADO.** Las lecturas actuales cargan toda la muestra relevante almacenada, no solo el historial visible; el pool tiene tres conexiones y Resurrección conserva peor caso cuadrático. `HARDENING.md` contiene benchmarks sintéticos y evidencia de pruebas locales; no son mediciones de Neon. Esta fase no ejecuta benchmarks ni conoce volúmenes actuales de BD.

**PROPUESTA — estimaciones por supuestos, no cuotas ni costes facturados:**

| Elemento | Supuesto explícito | Orden de tamaño / trabajo |
| --- | --- | --- |
| Manifiesto de IDs | 100 IDs por página, 40–80 bytes serializados por ID con estructura | 4–8 KB por página, más header/disposiciones; IDs actuales reales pueden diferir |
| Registro mínimo para I1/OTP | 250–450 bytes serializados por ID con campos/versiones/disposición, sin payload Riot | 1.000 IDs: 0,25–0,45 MB; 5.000: 1,25–2,25 MB por captura completa |
| Comunidad hipotética | 20 jugadores × 1.000 IDs, una única captura retenida por cada uno | 5–9 MB de detalle más manifiestos; a 5.000 por jugador serían 25–45 MB, antes de overhead de BD |
| Ranked mínimo | 150–300 bytes por observación y metadatos comunes separados | 300 snapshots: 45–90 KB; 3.000: 0,45–0,9 MB por jugador |
| Lectura/materialización | IDs + detalles ordenados, hash lineal, sort si falta orden | O(n) hash y memoria, O(n log n) si hay sort; cargar por ámbito, no N consultas por ID |

Los supuestos no son medición de registros actuales y no autorizan retener indefinidamente esas capturas. Duplicar cada overlap/reevaluación multiplicaría el almacenamiento por K; un evento de decisión debe referenciar una versión sellada reproducible o conservar su conjunto mínimo una vez, con referencias sujetas a D13. Deduplicar por contenido solo dentro del dueño/ámbito, nunca mezclar datos personales de distintos jugadores. No truncar manifiestos para reducir tamaño y luego conceder.

Header por escaneo, unidades por página y disposición durable dentro de escrituras existentes evitan reescribir un blob O(n) con cada ID. Nuevos rows/bytes e índices/WAL/MVCC siguen teniendo coste; overhead, duplicación por backups e índices se medirán localmente y después en staging autorizado. No extrapolar precios sin datos actuales de proveedor.

Medir futuros datasets de 50/500/5.000/50.000 partidas y 30/300/3.000 snapshots: bytes, tiempo tx, esperas de lock, queries por lote, CPU fuera de tx, memoria y filas revisadas. El objetivo es número de consultas acotado por página/lote y no N+1, locks cortos y overhead que no agote turnos vigentes. No fijar umbral CI por máquina ni asumir que tres SELECT + nuevos recibos siempre son baratos. Un límite de tamaño provoca pending/blocked explícito, nunca éxito con evidencia truncada.

## 12. Alternativas comparadas

| Alternativa | Ventaja | RIESGO / decisión recomendada |
| --- | --- | --- |
| Derivar recibo de completed/counters/lastSyncedAt | Sin persistencia nueva | Descarta identidad de IDs, ventanas y gaps. **Descartada** como evidencia probatoria. |
| Guardar prueba en run_progress | Reusa JSON existente | Solo dos runs, telemetría agrupada y sin dueño FK del conjunto; no almacenamiento D11/D13. **Descartada**. |
| Instrumentación mínima normalizada en ingesta | Reusa respuestas/tx y cursores; puede demostrar recepción desde su activación | Debe cubrir todos los caminos y desconocidos legacy. **Recomendada**, con permisos y pruebas. |
| Reconsulta completa para cada candidatura o perfil | Nueva recepción explícita | Cuota, latencia, indexación cambiante; LP pasado irrecuperable. **Descartada** en render; reconciliación acotada solo con autorización. |
| Captura de payload Riot completo | Mucho contexto para revisar | Duplica PUUID de terceros, datos innecesarios y costes. **Descartada**; conservar campos mínimos reproducibles. |
| Revisión por jugador desde aplicación | Una fila, integración sencilla y cambios conservadores | Depende de todos los escritores y de drenar versiones antiguas. **Recomendada inicialmente** con grants cerrados hasta validación. |
| Revisión por cola/temporada | Menos reevaluaciones irrelevantes | Más filas/locks, cambios compartidos/calendario complejos. Posponer hasta medir. |
| Triggers de revisión en BD | Cubren SQL/old writers sobre tablas instrumentadas | Fanout en matches, borrado, lock order, bulk operations y RLS requieren diseño/pruebas nuevos. Alternativa si no puede controlarse el conjunto de escritores; no afirmar garantía de aplicación ante SQL externo. |
| Hash al final sin revisión protegida | Detecta diferencias en dos lecturas | Carrera entre último hash y commit. **Descartada** como arbitraje. |
| Todo dentro de transacción larga / otro lease global | Parece simplificar fotografía | CPU/locks largos, compite con sincronización y no autentica Riot. **Descartada**; evaluación afuera y arbitraje breve por fila. |
| Serializable sin protocolo de escritores | Detecta algunos conflictos transaccionales | No acredita procedencia, recibos o cobertura ni elimina necesidad de reintentos/estado pendiente. No reemplaza D12. |
| Cola/storage externos | Más infraestructura para tareas grandes | Innecesarios a la escala asumida; no resuelven confianza ni borrado por sí solos. **No propuestos**. |

## 13. Plan incremental y autorizaciones

**PROPUESTA.** Subetapas pequeñas, sin grants. Cada entrega preserva motor y gates actuales y requiere aprobación específica. Los nombres de módulos/tests nuevos siguientes son candidatos, no archivos creados.

| Etapa futura | Archivos posiblemente afectados | Dependencias / riesgos | Pruebas y aceptación | Rollback / autorización |
| --- | --- | --- | --- | --- |
| B.2.B — especificación y materializador puro | `server/achievements/verification/`, nuevo `materialize.ts`/canonicalización, tests/ docs | Acordar semántica Riot/documentación, confianza/unknown/legacy y representación de revisión | Fixtures + snapshots consistentes; sin entrada cliente, IO oculto ni grants; hash/versiones reproducibles, no cambio a R1/I1/OTP | Retirar integración futura; código puro aislado. Autorizar implementación, aún sin schema ni datos |
| B.2.C — prototipo de recibos | Nuevos contratos/productor/adaptador internos y tests de recibos | Semántica temporal, páginas all-queues, estabilidad/404, cierre D06 pendiente | Manifiesto exacto, gaps bloquean, scan_complete distinto de reconciled, límites/duplicados/indexación simulados | Módulo desconectado; autorización de código sin llamadas Riot ni persistencia remota |
| B.2.D — protocolo monotónico y persistencia local | `db/schema.ts`, util de revisión/capturas, Drizzle metadata/SQL futuro, tests de migración | Revisión por jugador, dos entidades mínimas sujetas a coste y D13; aprobación de formato | Migración aditiva sobre filas previas en PGlite, cero evidencia retroactiva; counters/revisiones exactas, cascadas y journal íntegro | Conservar columnas/tablas aditivas al revertir código; nunca DROP automático. Autorizar **schema y generación de migración local** separadamente |
| B.2.E — integración completa de escritores | `sync/{recent,history,service,player-state,progress}.ts`, admin players routes, `scripts/backfill-remakes.ts` y lector/materializador | D/Evidence local listas, rutas alternativas inventariadas; peligros de shared matches, captura fallida y old writers | SW/cursor/captura/R atómicos; todos los caminos de §6 incluidos; sin calls/presupuesto nuevos, LP/Firma/premios invariantes | No habilitar consumo probatorio; rollback a writers antiguos solo con gates operacionales cerrados, invalidar su frontera de confianza al reactivar después |
| B.2.F — concurrencia real y fallos | Nuevos tests PostgreSQL locales + infraestructura opt-in existente | Escritores completos y orden de locks; no inferir concurrencia de PGlite | Dos conexiones prueban matriz §8, rollback, DELETE, pérdida de respuesta y cambios compartidos; suite omitida no PASS | Entorno efímero eliminado, sin remoto. Autorizar QA local; pruebas futuras de grants usan repositorio simulado, no conceden reales |
| B.2.G — rendimiento y RC de migración | Benchmarks opcionales y documentación, ajustes pequeños de queries/escritores si medidos | Datos sintéticos/plan local; sin cifras Neon inventadas | Comparación de turnos antes/después, tamaño y consultas acotadas, full lint/typecheck/test/build con Node compatible, rollback probado | Revisar carga antes de publicación; autorización de optimizaciones mínima y revisión SQL, no aplicación remota |
| B.2.H — preflight/aplicación Neon staging | Sin crear scripts paralelos; runner `npm run db:migrate` existente | RC aprobado, respaldo Ready, endpoint inequívoco, historial de migraciones y cero writers activos/old deployments con acceso | Inspección readonly **autorizada después**, recuentos/columnas/FK y borrado sintético seguro; únicamente migration aprobada tras permiso de escritura | Revertir código manteniendo DDL aditivo; recuperación de respaldo solo ante daño y autorización separada. Autorizar **aplicación staging** explícitamente |
| B.2.I — publicación/validación de capturas | Commit/release/docs, Preview exacto | Migración aplicada antes del código dependiente, entorno protegido, roles y old writers controlados | Deployment READY; primero smoke sin sync. Capturas reales solo tras autorización de una operación acotada y misma cuota; verificador sigue sin grants | Revertir por flujo Git autorizado sin borrar fuentes/receipts; permiso separado de push y de sincronización real |

El orden técnico de ejecución será: contrato puro → prototipo de recibos → esquema/migración **local** → escritores completos en entorno efímero → concurrencia/rendimiento → preflight staging → aplicación explícita de migración → publicación autorizada → validación operacional acotada. No desplegar un lector que seleccione columnas nuevas antes de aplicarlas. No aplicar SQL por separado, borrar migraciones anteriores ni cambiar el runner o `.env.local`.

Después de B.2 y antes de cualquier grant: autorización operacional versionada D17, almacenamiento grants/eventos D11, unicidad, privacidad/eliminación D13/D18 y revisión supervisada D16 requieren tareas/autorizaciones propias. Equipamiento y titularidad D14 permanecen fuera. Aprobar B.2 no concede permiso implícito de B.3 o escritura de grants.

## 14. Decisiones técnicas pendientes

1. Semántica oficial de MATCH-V5 y remake, versión de comprobación y precisión/cutoff: §5.5. Ninguna documentación externa o request operacional se verificó ahora.
2. Política de reconciliación recuperable: antigüedad de intervalo, margen, estabilidad y necesidad de segunda pasada; coste debe caber en límites existentes. No prometer exhaustividad absoluta.
3. Calendario regional cerrado, fechas/plazos/reservas D06 y soporte explícito de temporadas archivadas; no derivarlo de temporada actual ni fixture de tests.
4. Atestación aceptable de fuentes legacy; no confundir nuevo hash con recepción histórica. Revalidación Riot limitada y autorizada o mantener desconocido.
5. Presencia de marcadores de remake y tratamiento probatorio de ausencia: conservar comportamiento observacional, acordar prueba admitida por política futura.
6. Modelo final de cabecera/unidades, canonicalización/versionado, límites de tamaño y tratamiento de captura fallida sin degradar ingesta. Dos entidades propuestas requieren revisión local.
7. Cobertura completa de todos los escritores, versiones antiguas, SQL manual/roles/RLS; decidir si control de aplicación basta o si triggers son necesarios. No activar con escritores sin protocolo.
8. Control transaccional D17 y entorno/base de staging autenticados por servidor; el flag existente y una aprobación documental no bastan.
9. Borrado de evidencias/eventos/JSON de diagnóstico/logs/respaldos, finalidad y plazos si procede, sin retención indefinida. Continuidad tras recreación no resuelta.
10. Frecuencia/presupuesto de revisión local pendiente, reintentos limitados y estado público neutro mientras R cambia; ninguna cola externa propuesta.

## 15. Recomendación final y validación de esta entrega

**PROPUESTA.** Autorizar como siguiente paso únicamente el materializador puro y la especificación versionada del recibo con fixtures (B.2.B/C), manteniendo desconocida la procedencia legacy y cerrado cualquier permiso de concesión. Resolver semántica temporal y clasificación antes de definir DDL; después implementar revisión **junto a todos sus escritores**, probar concurrencia real local y D13, y separar la migración staging de la publicación. No aceptar un grant basado solo en una fotografía consistente o un run completado.

**HECHO VERIFICADO de alcance.** La única modificación de esta fase es este Markdown. Se inspeccionaron fuentes, scripts de mantenimiento/migración, contratos y tests sin ejecutarlos. No se ejecutaron build/tests/lint/typecheck: no son necesarios para el cambio exclusivamente documental autorizado. Validación aplicable: lectura/revisión del documento, inventario de escritores y permisos, whitespace del archivo, diff staged limitado a esta ruta y comprobación de archivos protegidos. Los resultados de suites anteriores permanecen históricos, no se reportan como ejecuciones de B.2.A.

Sin implementación, migraciones, consultas/escrituras Neon, llamadas Riot, sincronizaciones, flags, grants, push, deployment ni cambios en main/Production. Un único commit local documental, después de revisar alcance y whitespace. La rama queda un commit por delante de la referencia remota si no cambia su estado durante la entrega. El SHA final se informa en el chat; no se incrusta en su propio contenido.
