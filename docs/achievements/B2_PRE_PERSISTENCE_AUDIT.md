# 1.2.B.2 — Auditoría final de A–C y preparación de D

Fecha: **11 de octubre de 2026**. Repositorio `G2SantiRobeson/soloq`, rama `staging`. Base auditada: `f686e5622d2bd6ea1dbede278a1ae5c65d67dc2f`. Referencia local y remota comprobada por `git ls-remote`: `726daaf58372324e2b01a41cce9f6a86401c6f29`. Tres commits por delante y cero por detrás, en orden: `f79e029` (A), `60ba3f2` (B), `f686e56` (C). Se preservan `CLAUDE.md` modificado, `.claude/` sin seguimiento y `.env.local`; hashes comprobados al iniciar y al terminar, sin leer secretos.

**Alcance:** inspección cruzada, validación local y este único documento. No implementación de D, esquema, generación/aplicación de migraciones, instrumentación de escritores, adaptador operacional, grants, flags, publicación ni operaciones de producto remotas. Los diseños siguientes son **propuestas**, no contratos activos ni autorizaciones.

Referencias leídas: [políticas D01–D18](CERTIFICATION_AND_GRANTS_DESIGN.md), [B.1](VERIFICATION_CONTRACTS.md), [B.2.A](EVIDENCE_AND_SOURCE_REVISION_DESIGN.md), [B.2.B](EVIDENCE_MATERIALIZATION.md), [B.2.C](RECONCILIATION_RECEIPTS.md), contratos y tests completos de esos módulos, escritores actuales y guía instalada Next.js `01-app/02-guides/data-security.md`. Los hallazgos documentales antiguos se contrastaron con el código; no se consultaron Neon, Riot ni datos operacionales.

## 1. Veredicto y alcance de las garantías

**APTO como conjunto de prototipos internos desconectados. NO-GO para verificación operacional, certificación o concesiones.** No se identificó un defecto nuevo de código que requiera corregir B.1/B.2.B/B.2.C. No se cambian contratos, evaluadores, versiones o pruebas existentes. La cobertura ya incluye las deficiencias concretas buscadas; no se agregan tests redundantes.

Se ha comprobado estructura, orden, concordancia y límites declarados. No se ha demostrado origen Riot, exhaustividad recuperable, estabilidad de su índice, revisión transaccional de fuentes ni calendario operacional cerrado. Una declaración sintética coherente puede producir `requirements_satisfied`, `materialized` o `structurally_complete` sin acreditar ninguna de esas dimensiones.

Todas las ramas de resultado conservan `certification: "not_established"`, `grantAuthorized: false` y `writes: "none"`. No existe una ruta de concesión ni un consumidor operacional de estos prototipos. Persistir sus valores en el futuro no aumentará por sí mismo la confianza.

## 2. Hallazgos por severidad

| Severidad y naturaleza | Evidencia actual | Consecuencia / acción propuesta |
| --- | --- | --- |
| Crítico para activación, frontera deliberada | `verification/verify.ts:simulateBadgeVerification`, `materialize.ts:materializeAchievementEvidence`, `receipts.ts:reconcileDeclaredEvidence` reciben contexto/declaraciones suministrados; siempre autenticación no realizada. | No elevar `known`, `declared`, hashes o estados positivos a procedencia autenticada. Factoría operacional privada y autorización futura separadas. No es una vulnerabilidad HTTP actual: estos módulos no tienen endpoint. |
| Crítico para concurrencia futura, ausencia confirmada | `db/schema.ts` no tiene source revision. `sync/progress.ts:syncWrite` protege owner/run/revisión de checkpoint, no la fotografía de todas las fuentes. | Todos los escritores deben participar en un protocolo antes de consumir revisiones como prueba. D por sí sola no cubrirá escritores antiguos. |
| Crítico para D13, pendiente ya identificado | `api/admin/players/[id]/route.ts:DELETE` borra jugador, cascadas y matches huérfanos; no redacta `sync_locks.run_progress`. `lib/sync-progress.ts:persistedRunSchema` conserva IDs de jugador y último match. | Planificar eliminación selectiva de referencias personales en latest/previous y otros soportes. Ocultar el panel no borra los datos. No corregirlo ni borrar checkpoints en esta auditoría. |
| Importante, diferencia contractual confirmada | B.1 tiene un draft con detalles ranked y `query.bounds: half_open`; C conserva páginas all-queues, exclusiones e intención temporal `unconfirmed`. | No son formatos intercambiables. No usar cast, renombrar estados ni proyectar silenciosamente exclusiones. Un adaptador futuro necesita autorización y semántica operacional demostrada. |
| Importante, incertidumbre del proveedor | C detecta solapamientos, contradicciones y cambios reportados, pero no desplazamientos sin síntomas. `detail_outside_query` usa timestamp de inicio local. | Un terminal corto declarado no demuestra índice estable ni que Riot aplique límites semiabiertos a ese timestamp. Mantener bloqueo operacional hasta acordar una política recuperable limitada. |
| Importante, deuda probatoria preexistente | `lib/match-outcome.ts:isRemake` devuelve false si no encuentra marcador true, incluida ausencia del campo. `sync/recent.ts` omite 404; `history.ts` contabiliza 404 sin manifiesto durable completo. | Bool almacenado y completed no acreditan fundamento del remake ni cobertura. Conservar legado desconocido y registrar base/IDs al instrumentar después. No se altera ingesta ni estadísticas aquí. |
| Importante, alcance conservador comprobado | C exige que chosenWinIds pertenezca a la racha seleccionada por el motor tanto en B como en detalles. I1 elige la máxima y la más temprana en empate. | Otra racha válida no seleccionada puede quedar bloqueada; no es un falso positivo. El productor deberá seleccionar el episodio del motor o proponer un contrato nuevo. No cambiar I1 ni convertir cualquier cinco victorias en recibo positivo. |
| Importante para calendario, ausencia confirmada | `lib/season.ts:CURRENT_SEASON.endAt` sigue null; servicio observacional solo admite temporada actual. | OTP histórico real permanece bloqueado. Fechas cerradas de fixtures no autorizan cierre regional o evaluación archivada. D puede almacenar desconocidos sin inventar calendario. |
| Menor, nomenclatura ya registrada en A | `lib/achievements/catalog.ts` usa nombre conceptual «OTP certificado», descripción limitada y availability observation_only; UI proyecta muestra importada. | No tomar nombre del catálogo como estado jurídico/técnico o autorización. Presentación y literales actuales se conservan. |

Los riesgos de ingesta y borrado anteriores ya constaban en A y no son regresiones introducidas por B/C. Su resolución exige otro alcance. No se afirma incidencia remota ni se implementa una corrección que toque sync, endpoints, esquema, reglas o flags.

## 3. Compatibilidad semántica B.1 / B.2.B / B.2.C

| Dimensión | B.1 | B.2.B | B.2.C / resultado de auditoría |
| --- | --- | --- | --- |
| Identidad | UUID/player, plataforma, cola ranked, temporada; contexto de confianza supuesto. | Identidad en cabecera y cada fuente; scope concordante. | Identidad en cabecera/página/detalle; no cruza jugadores. Detalle desconocido bloquea. Coinciden ámbitos, no una vinculación autenticada implementada. |
| Cola/plataforma | 420/440, scope y prefijo MATCH; fuentes de la cola objetivo. | 420/440 y prefijo exacto/sufijo numérico. | Query queue/type reales nullable; páginas pueden incluir otras colas, clasificadas antes del cotejo ranked. Forma de ID no acredita existencia. |
| Temporada y tiempo | Scope local `[start,min(asOf,end))`; receipt target semiabierto, consulta con instantes a segundos. | UTC a milisegundos; conserva scope/timestamps originales en metadata. | Intervalo objetivo en milisegundos y query epoch segundos enviados separados. No recalcula filtros para favorecer evidencia. Un fin exactamente en quinta victoria la excluye. |
| Precisión | Parser B.1/motor admite ISO con offset; no incorpora el rechazo adicional de submilisegundos de B/C. | Rechaza precisión mayor a 3 decimales para no truncarla con Date. | Igual rechazo que B. No son validadores equivalentes: el futuro productor debe conservar la frontera más estricta, sin rebajar B/C para adaptar B.1. |
| Null/false/remake | Unknown/404 y campos pertinentes desconocidos bloquean el recibo. Remake confirmado se ignora en I1. | Null se conserva; remake true permanece en fuentes y se excluye explícitamente del denominador. | Scope desconocido nunca se descarta como otra cola. True conserva detalle incluso win/champion null; false es dato declarado, no ausencia del marcador autenticada. |
| Manifiesto | Set exacto de contexto/fuentes; receipt IDs únicos y orden temporal. | Conjunto completo declarado, deduplicado con contenido idéntico; contradictorio no produce huella. | IDs originales en páginas, unión de todos los intentos, disposiciones completas y conjunto ranked pertinente. No compara ingenuamente all-queues con ranked. |
| Revisión | `Knowledge<string>`: unknown/known/not_applicable; ninguna consulta/verificación transaccional. | Unknown/declared; hash metadata la conserva. | Debe concordar con B; reused attestation declarada necesita revisión declarada concordante. Unknown concordante no se vuelve conocida ni monotónica validada. |
| Hashes | Compara forma/valores de evidencia, sin huellas de captura. | SHA-256 separado de content y metadata; metadata liga content hash. | Recalcula B; verifica referencias esperadas y hashes de página opcionales; capture ID no puede cambiar contenido silenciosamente. Ningún SHA autentica al proveedor. |
| Estados | Invalid/unavailable/blocked/requirements_satisfied de simulación. | Invalid/contradictory/incomplete/materialized de conjunto suministrado. | Invalid/collecting/blocked/contradictory/structurally_complete. Dimensiones distintas; no hay equivalencia positiva ni promoción automática entre módulos. |

Las razones de B no se copian indiscriminadamente a C: para I1 un histórico global running no bloquea por sí solo un intervalo menor; unknown/mismatch de manifiesto sí bloquea. OTP histórico exige el conjunto estacional y no permite incompletitud. En C un recibo completo puede tener condición OTP no observada o evidencia insuficiente (N=49); «completo estructuralmente» no significa criterio cumplido.

B/C conservan versiones de formato/canonicalización independientes de R1/I1/OTP. R1 e I1 siguen `1.1.A-observed-v1`; OTP sigue `1.1-otp-observed-v2`, N>=50 y comparación racional `20*C >= 13*N` mediante el evaluador existente. La política draft B.1 tampoco es una regla nueva ni autorización operacional. LP, Firma, premios, sincronización y perfil no se modifican.

## 4. Seguridad y fronteras de confianza

Inspección de los siete archivos de `src/server/achievements/verification/`: todos importan `server-only`. Solo B.2.C importa B.2.B para recalcular; no llama B.1. B.1 reutiliza evaluadores puros; no hay export de estos servicios desde el motor público. B/B.1/C no tienen SQL, cliente Riot, fs, red, env, reloj implícito, logs, aleatoriedad o concesiones. SHA de Node es CPU determinista.

Búsqueda de referencias/imports en src y scripts: sin uso en perfiles, rutas, sincronización, cron, Server Actions o flags. Tests importan los módulos deliberadamente. No endpoint público nuevo. Zod estricto rechaza campos adicionales de entrada, incluidos marcadores explícitos de autoridad/payload; errores no devuelven secretos del parser. Un dato falso con forma válida aún puede ser simulado: validación no demuestra procedencia.

La guía instalada de Next recomienda DAL privada y DTO mínimo. El paquete instalado `server-only` tiene export react-server vacío y export default que arroja error; Next aplica la frontera servidor/cliente. Vitest lo reemplaza por el stub existente para ejecutar tests: ese stub **no** demuestra por sí solo un build negativo cliente. Se comprobaron marcador, grafo de importaciones y build actual; no se creó un componente cliente infractor. No se afirma una nueva prueba adversarial del compilador.

`ACHIEVEMENTS_EXPERIMENTAL` existente controla UI: true explícito y entorno local/Preview identificado, rechazo de Production/ambiguo. No controla grants, no lo leen B.1/B/C, no acredita rama/base por sí solo. Ningún flag cambió. Production Demo sigue usando fixtures y rechazando PostgreSQL; el build/smoke aislado prueba sus rutas sin credenciales.

## 5. Paginación, disposiciones y límites de cierre

Se inspeccionaron `receipts.ts:inspectPages`, `inspectDispositions` y sus 72 regresiones:

- Cadena desde offset cero. Página llena requiere siguiente página; terminal corta o vacía debe ser **success**. Una página partial/failed jamás se convierte en lista vacía. Gaps, terminal faltante o páginas posteriores impiden completar.
- Orden de intentos explícito por offset. Error previo seguido de éxito puede resolverse; fallo posterior no se oculta escogiendo un éxito antiguo. Éxitos con listas diferentes, mismo intento contradictorio, hashes discordantes y capture ID con contenido distinto producen contradicción.
- Arrays de IDs originales y todas las declaraciones se conservan. Duplicados idénticos no inflan la unión; repeticiones en páginas efectivas bloquean. IDs recibidos antes de un retry siguen en la unión. Reporte de late IDs/offset shift bloquea. Cambios sin síntomas permanecen imposibles de detectar con este formato.
- Disposición ausente/extra, conflictiva, pending, unknown, 404, invalid o reutilización sin atestación impiden completar. No elegir un detalle favorable de dos contradictorios. Unknowns permanecen como IDs aunque no haya fila evaluable; unresolved se cuenta por ID, no por campo.
- Otra cola y margen fuera del objetivo se excluyen solo con base concordante y scope conocido. Remake null no respalda exclusión. Cola/query discordante se detecta. Todos los ranked del objetivo, incluidos remakes, deben concordar campo por campo con B.
- Nueva derrota dentro de cinco victorias contradice la materialización anterior y corta la secuencia al rematerializar. Empates competitivos permanecen ambiguos; desempate ordinal no prueba orden. Un remake confirmado intercalado se conserva e ignora según I1.
- B incompleta no se convierte en denominador OTP certificado. Páginas/detalles todavía pendientes conservan source_concordance_pending; escaneo declarado terminal que omite fuente pertinente conocida es discrepante.

Los niveles permanecen separados: escaneo declarado terminado → concordancia estructural → origen operacional → cobertura recuperable aprobada → certificación → concesión. Las flechas no están implementadas como promoción automática. C puede tener hash en collecting/blocked para reproducir incertidumbre; contradictory y estructura inutilizable no producen hash válido.

## 6. Riesgos Riot y por señal

Esta auditoría no volvió a consultar documentación externa ni endpoints. Se conserva la investigación primaria fechada de B y su separación entre hechos documentados e incógnitas. Count/start/segundos/filtros son parámetros declarados; inclusividad, timestamp filtrado, orden/estabilidad/retención/indexación y fundamento vigente de remakes siguen pendientes. No inventar margen, espera o SLA para resolverlos.

**R1:** solo snapshots oficiales almacenados atribuidos, sin interpolación ni LP desde MATCH. Se conserva todo el segmento elegido y las barreras del motor. Un manifiesto concordante no detecta snapshots omitidos tanto de fuentes como de manifiesto. `rankCheckedAt` no reconstruye observaciones previas sin cambios.

**I1:** cinco victorias producen observación; reconciliación requiere todos los IDs pertinentes y clasificaciones. Fuente exterior al intervalo no necesita estar reconciliada para ese episodio, pero ninguna barrera interior puede omitirse. C verifica el episodio elegido por el motor, no todos los episodios posibles.

**OTP:** abierto no genera reconocimiento histórico. N/C son partidas válidas, nunca processed/discovered de todas las colas. Remakes/desconocidos son explícitos; 65% se evalúa sin redondeo. Calendario declarado cerrado permite solo un fixture estructural, mantiene `seasonClosure: not_established`. D06 continúa pendiente, sin plazos inventados.

## 7. Modelo conceptual mínimo propuesto para B.2.D

**No existe en Drizzle ni SQL. Nombres candidatos.** Recomiendo una columna de revisión en players y **dos tablas de evidencia**, cabecera + unidades. Una única tabla por recibo con un JSON creciente obliga a reescribir O(n) por checkpoint y dificulta idempotencia/reanudación; una tabla separada para páginas, detalles, snapshots y cada estado fragmentaría innecesariamente. Dos tablas admiten tipos discriminados y composición de capturas/recibos sin copiar payload Riot completo.

### A. Revisión monotónica por jugador

| Aspecto | Propuesta |
| --- | --- |
| Propósito / campos | `players.source_revision`: bigint no negativo, suma de BD. Inicialización 0 solo como frontera local desde instalación; ninguna fila legacy se convierte en autenticada. Revisión serializada como string decimal, nunca Number. |
| Identidad / unicidad / relaciones | PK players.id existente, una revisión conservadora entre colas/temporadas. No revisión por run ni tabla extra de locks. FK de evidencia al mismo jugador. |
| Índices | PK existente basta para lock/comparación. No índice global de revisiones sin caso de lectura demostrado. |
| Integridad / concurrencia | Lock de filas afectadas en orden UUID, suma R+1 una vez por transacción relevante; fuentes/cobertura/capturas/cursor/R atómicos. No incremento por render, diagnóstico, evaluación o grant. |
| Tamaño / D13 | 8 bytes del valor por fila antes de overhead; desaparece al borrar al jugador, sin tombstone vinculable. |

### B. Cabecera de captura o recibo (`achievement_evidence_headers`)

Campos conceptuales: id UUID opaco PK; playerId UUID FK players CASCADE; kind `rank_capture | match_scan | structural_receipt`; platform/queue/season text de dominio; formatVersion/canonicalizationVersion text; estado operacional separado del resultado puro; targetFrom/targetTo/readAt/dataCutoff timestamptz nullable según tipo; query normalizada JSONB mínima con segundos/offset/count/filtros/versión de semántica; identityBindingVersion/normalizationVersion text nullable si desconocidas; scanId/operationKey text internos; parentHeaderId nullable para receipt de un scan; source origin declarado/operacional/legacy **sin inventar autenticación**; inputRevision/sealedAtRevision bigint nullable; contentFingerprint/metadataFingerprint/receiptFingerprint text SHA nullable; createdAt/finishedAt timestamptz; byteCount bigint y conteos como control, no sustitutos de unidades.

Identidad: dueño y scope completos en cada cabecera; no PUUID, URLs con PUUID, headers, nombres personales duplicados ni payloads de terceros. Captura ranked separada por cola aunque proceda de una respuesta LEAGUE compartida; no permitir referencias personales cruzadas.

Unicidad propuesta: PK id; UNIQUE(playerId,id) para FKs compuestas; UNIQUE(playerId,operationKey) para recuperar operación tras respuesta perdida. Clave incluye tipo/ámbito e identidad de operación asignada por servidor, **no solo hash de contenido**: otra recepción real con igual contenido sigue siendo otra captura. parentHeader debe ser del mismo dueño y ámbito, comprobado transaccionalmente; scope en FK compuesta si se duplica o validación bloqueante en repositorio, nunca confiar en JSON cliente.

Índices candidatos: (playerId,queue,season,createdAt), (playerId,state) solo si hay lector de pendientes, parentHeaderId para referencias. No GIN sobre todo el JSON sin consulta justificada. Checks: inicio<fin cuando presentes; revisiones no negativas; hashes con formato; estado sellado exige campos/versiones/huellas; campos específicos por kind se validan también con runtime estricto. Estado desconocido no usa fechas default que simulen recepción previa.

Coste: cabecera de orden 1–3 KB bajo supuesto de metadatos mínimos; JSON sellado reproducible adicional puede ser O(n) si se elige guardar una copia inmutable una sola vez. Debe medirse. No reescribir ese conjunto a cada ID. FK CASCADE cubre cabecera/sellos/fingerprints, incluidas referencias inversas; no cabeceras sin dueño. Carrera de sellado usa fila players protegida, no un nuevo lease.

### C. Unidades (`achievement_evidence_units`)

Campos conceptuales: id UUID PK; headerId/playerId UUID FK compuesta a header CASCADE; kind `page | disposition | ranked_snapshot | source_reference`; unitKey text; ordinal bigint; offset/attempt integer nullable para página; matchId/snapshotId text/UUID nullable; captureId text nullable legacy; receivedAt timestamptz nullable; recordedAt timestamptz de persistencia, distinto de recepción; responseState/disposition/basis text discriminados; minimalData JSONB versionado; contentFingerprint/metadataFingerprint nullable; sourceUnitId UUID nullable para referencia a unidad inmutable del mismo dueño; changedAtRevision bigint de la transacción. Null no es false y la presencia original del marcador remake necesita representación propia cuando se autorice instrumentación.

Página: IDs originales ordenados, filtros y resultado/error sanitizado, captura; incluye terminal vacía. Disposición: ID, campos mínimos y razón/exclusión/incertidumbre, no estadísticas ajenas a evaluación. Ranked: campos originales/ID/capture mínimos, sin trayectoria interpolada. Referencia: liga fuente previa concordante sin afirmar recepción nueva. Evidencia reproducible requiere las unidades/content reales, no solo sus huellas.

Unicidad propuesta: (headerId,unitKey), clave de página por offset+intento; disposición por ID+evento de transición; snapshot por captura+ID; source_reference por receipt+source unit. Insert idempotente idéntico no añade otra unidad; clave idéntica con contenido distinto bloquea, no `onConflictDoNothing` sin cotejo. UNIQUE(playerId,id) para referencias entre unidades. Índices (headerId,kind,ordinal), (playerId,matchId) para dependencias/borrado, sourceUnitId para búsquedas inversas; añadir solo los requeridos por planes medidos.

Conservar intentos y transiciones **inmutables**. Un pending→resolved es una transición registrada, no una contradicción escondida: el lector futuro debe construir el estado efectivo a una revisión y preservar el historial. C actual recibe disposiciones efectivas, y rechaza dos disposiciones diferentes del mismo ID; no pasarle directamente un event log ni elegir a mano la fila más favorable. La adaptación versionada de eventos aún necesita especificación/autorización. Detalles realmente discordantes siguen bloqueados.

Integridad: reference del mismo dueño, sin ciclos y ámbito compatible; payload exacto por kind y límites de tamaño; fuentes borradas no dejan copia personal en JSON/refs. No depender exclusivamente de FKs a matches/snapshots que puedan desaparecer. D13 CASCADE desde dueño alcanza toda unidad y referencias. Cambios de fuentes compartidas invalidan dependencias por revisión, no modifican capturas inmutables antiguas.

Supuestos de tamaño: 100 IDs de 40–80 bytes serializados, 4–8 KB por página más metadatos; disposición/detalle 250–600 bytes por ID; 5.000 IDs ≈1,25–3 MB más páginas y copias/versiones. Son estimaciones de JSON, excluyen filas/índices/WAL/MVCC/respaldos. Retries y duplicados originales incrementan tamaño. No son mediciones Neon ni permiso de retención indefinida. Límites operacionales desconocidos bloquean el sellado en vez de truncar prueba.

### Sellado sin autorreferencia y consistencia

1. Leer R y todas las fuentes/unidades en repeatable read/read only. Materializar, comparar y hashear **fuera** de la transacción. Sin Riot ni CPU extensa bajo locks.
2. Transacción corta: lock players, confirmar dueño/elegibilidad/ámbito/protocolo vigente y current R==inputRevision. Si difiere, rollback/rematerialización acotada. Una lectura antigua sin lock final no cierra la carrera.
3. Persistir recibo nuevo como evidencia a R+1, guardando **inputRevision=R y sealedAtRevision=R+1**. El contenido puro C conserva su revisión declarada R y su hash original; sello/R+1 son metadata de la operación aparte. No reescribir el hash para incluirlo dentro de sí mismo ni exigir R==R+1 en la siguiente lectura.
4. Retry de operación ya confirmada recupera el mismo sello por operationKey, sin otra suma. Fuente posterior R+2 deja ese sello potencialmente desactualizado; comprobar contenido/alcance y revisión nueva antes de volver a usarlo. Concordancia no es vigencia automática.
5. Sin grants. Un futuro grant tendría su propia autorización D17 y compare protegido; no se crea escritor ni capability por sellar. Rollback afecta conjuntamente fuentes/captura/revisión/cursor donde corresponda.

## 8. Inventario actual de escritores y revisiones futuras

Inventario contrastado mediante búsqueda Drizzle y SQL explícito en src/scripts; no incluye consolas, roles o servicios externos no inspeccionados. **Hoy ninguno incrementa sourceRevision, pues no existe.**

| Escritor / función | Qué modifica hoy | Tratamiento futuro propuesto |
| --- | --- | --- |
| `api/admin/players/route.ts:POST` | players identidad/plataforma/PUUID/icono/cursor inicial; después delega sync/history. | Inicializar frontera de revisión y captura de vínculo. Alta, vínculo y revisión atómicos, no autenticar legado. No duplicar incremento por wrapper. |
| `sync/service.ts:syncPlayer`, bloque ranked | Nombre/icono/rankCheckedAt; inserts de snapshots por cola si estado cambia/nueva temporada. | R por fuentes y contexto consumido. Sin snapshot nuevo, rankCheckedAt cambia: incrementar si se conserva en materialización operacional. Nombre/icono solo si están dentro de lo probado; definir proyección exacta. |
| `sync/recent.ts:importRecent`, detalle | matches + player_matches idempotentes en syncWrite. | Captura/disposición y R de asociaciones realmente afectadas atómicos. Conflicto con fila ya existente requiere concordancia, no recepción retroactiva. Insert de nueva participación afecta a su jugador; nueva partida sin otros asociados no fanout artificial. |
| Recientes, primera página y cierre | lastAttemptAt; lastSyncedAt y resultado al terminar. 404/exclusiones hoy sin ledger individual durable. | Página/terminal/error/exclusión y cobertura futuras en transacción correspondiente. lastAttemptAt/attempt diagnóstico solo no incrementan R; cobertura probatoria sí. No cambiar presupuesto ni añadir requests. |
| `sync/history.ts:importHistory`, reset/abrir ventana | Temporada/status/counters/scanStart/scanEnd. | R por contexto relevante; identidad durable de scan distinta de run. Prefijo legacy sin páginas queda desconocido; no reiniciar temporada para fabricar evidencia. |
| Histórico, descubrimiento de página | pending/offset/exhausted/discovered. | Página/cursor/R juntos cuando pasan a formar parte de evidencia. Guardar terminal y orden original antes de descartar array. |
| Histórico, consumo de ID | matches/player_matches si procede; pending/processed/unavailable aun existing/excluded/404. | Disposición durable en **todos** los caminos y R atómicos; rollback conserva progreso. Sin incremento de fuente por insert idéntico, pero nueva evidencia/cobertura sí puede cambiar R. |
| Histórico, finalización / catches de `syncBackfillPlayer` | Status/cobertura, marcas de fechas, cursor siguiente; failed/running en error. | Contexto histórico que consume materializador incrementa R. No sellar por completed ni borrar manifiesto al abrir repair. Error diagnóstico aislado no prueba cobertura. |
| `sync/player-state.ts:beginPlayerSyncPhase/finishPlayerSyncPhase`, catches/finales service | lastSyncAttempt y errores por fase. | No R por telemetría sola. Separar del backfillStatus/cobertura que sí modifica contexto. |
| `api/admin/players/[id]/route.ts:PATCH` | enabled y updatedAt. | R si cambia elegibilidad; PATCH mismo valor no suma solo por updatedAt. Pausa no revoca eventos históricos automáticamente. |
| Misma ruta DELETE | Jugador; cascadas de participaciones/snapshots; partidas huérfanas. | Lock/borrado D13 completo con nuevas evidencias y diagnóstico selectivo. No incrementar fila borrada ni dejar tombstone personal. Otras asociaciones compartidas permanecen. |
| `scripts/backfill-remakes.ts` | UPDATE matches.isRemake compartido bajo lease, hasta 100 null. | Incrementar R de **cada jugador con player_matches del match**, en la misma tx de fuente/captura. Verificar ID solicitado/devuelto antes de usar captura como prueba. La comprobación operacional no se añade aquí. |
| `sync/lease.ts`, `sync/progress.ts:syncWrite/checkpoint` | Fencing y sync_locks.run_progress latest/previous. | No reutilizar su revision ni sumar source R por checkpoint. Protocolo de fuentes debe ejecutarse dentro de unidad real, no duplicarse por flush. |
| Global/admin/cron/individual/backfill/alta | Delegan a los escritores enumerados. | Instrumentar en escritor real; comprobar todas las entradas, sin doble suma por ruta. |
| Futuras correcciones de identidad, snapshots, queue/time/remake/participación y recibos | No hay rutas genéricas actuales; inserción conflictiva no sobrescribe. | Cualquier corrección, nueva asociación y sellado deben estar inventariados. SQL manual o deployment antiguo no queda cubierto por un helper nuevo. |
| Migraciones/maintenance futuros | Runner actual no usa lease Riot. | Cambios de datos/formatos deberán invalidar frontera o actualizar revisiones bajo protocolo autorizado. No ejecutar nada ahora. |

Auth escribe sesiones/limitación de login, no fuentes del jugador. Scripts de assets no modifican fuentes probatorias. Tests/harness usan fixtures locales, no productores Riot. Queries, render, premios, Firma/LP/season son lectores, sin revisión por visitar página.

**Compartidos:** bajo writers actuales, syncWrite obtiene la fila de lease antes del trabajo. En futura reclasificación, obtener conjunto de afectados dentro de esa unidad protegida y bloquear players por UUID antes de modificar matches. Toda asociación/corrección debe usar protocolo común; SELECT del conjunto sin coordinación no impide un phantom. Probar asociación concurrente vs remake, DELETE vs asociación y rollback parcial con dos conexiones reales. No añadir otro lease. Un escritor viejo/directo que no incremente R hace inseguro el sistema; drenar versiones y controlar permisos antes de activar consumo probatorio. Triggers son alternativa a estudiar si no puede garantizarse el inventario, no solución implementada.

## 9. D13: eliminación y referencias personales externas

Propuesta obligatoria de aceptación de persistencia: DELETE debe alcanzar headers, páginas, disposiciones, snapshots copiados, manifiestos, recibos, capturas, huellas, claves vinculables y todas las referencias inversas del dueño. Futuras concesiones/eventos/equipamiento también, en su fase autorizada. FK a jugador y FK compuesta a cabecera no bastan si se duplica contenido en JSON global o logs.

Actual: cascadas solo cubren player_matches/ranked_snapshots; limpieza conserva matches de otros jugadores. `sync_locks.run_progress` no tiene FK al dueño personal y conserva en latest y previous playerId, currentPlayerId, players[].playerId y lastConfirmedMatchId. El borrado futuro debe redactar/borrar esas referencias selectivamente bajo fencing vigente, preservando owner, lease, cooldown y checkpoints de **otros** jugadores. No borrar todo el progreso como arreglo visual. Decidir qué hacer con runId/requestId y referencias indirectamente vinculables; no retenerlas por llamarlas opacas.

Fuera de tablas: logs actuales service contienen playerId; sessionStorage administrativo contiene correlación requestId; respaldos/retención de plataforma y posibles artefactos operacionales necesitan inventario autorizado. `.claude/` y `.env.local` no se inspeccionan como fuentes de evidencia ni se modifican. Los fixtures de tests no son registros personales reales. No se inspeccionaron logs o respaldos remotos, no se conoce su política efectiva y no se inventa plazo de conservación ni excepción legal. D13 requiere finalidad/plazo definido antes de retener evidencia personal adicional; D18 acceso privado autenticado para motivos sensibles.

Tests futuros: DELETE activo/finalizado con latest/previous mezclando jugadores; búsqueda inversa por IDs/hash sin restos; CASCADE de referencia/fuente sin tocar datos ajenos; rollback completo; borrado vs sellado y recreación sin reasignación/regrant. Nunca usar una base real para esa prueba.

## 10. Pruebas y validación de esta auditoría

Cobertura inspeccionada: **53 casos B.1, 56 B.2.B, 72 B.2.C (181)**, sin modificaciones. Comprueba identidad/cola/temporada, versionado, estructura, UTC/fronteras, legacy/desconocidos, remakes, contradicciones/manifiestos, retries/páginas/disposiciones, racional OTP, equivalencia de motor, determinismo y ausencia de IO/grants/imports operacionales. Estos tres conjuntos son unitarios puros.

Los tests PGlite existentes de integración/BD ejecutan SQL/migraciones existentes exclusivamente en bases efímeras y prueban filtrado, unicidad, transacción/read-only, errores y aislamiento Demo. La simulación controlada de lecturas cambiantes en `achievements-consistency.test.ts` se distingue expresamente de MVCC con conexiones independientes. Nada de ello prueba un protocolo sourceRevision inexistente.

PostgreSQL real opt-in: seis tests de lecturas/aislamiento en `achievements-postgres.test.ts` y cuatro de lease en `sync-progress-postgres.test.ts`. No hay configuración local activada para este QA. Suites omitidas no son PASS. Pruebas nuevas de concurrencia de R/compartidos/sellado/D13 **todavía no existen**; requieren B.2.D y escritores, luego PostgreSQL local con dos conexiones.

Validación con Node **24.19.0**, runtime ya instalado, PATH solo del proceso; no cambio global ni variables/archivos protegidos. Comandos ejecutados secuencialmente, sin build y suite simultáneos:

| Comprobación ejecutada | Resultado de esta tarea |
| --- | --- |
| `npm run lint` | PASS, código 0. |
| `npm run typecheck` | PASS, código 0. |
| `npm run test -- --maxWorkers=2 --hookTimeout=60000` | PASS, código 0: **1.034 aprobadas, 10 omitidas, 0 fallidas**; 52 archivos aprobados y dos suites omitidas; 123,20 s. Sin timeout, sin modificar configuración/tests. Incluye unitarias y suites PGlite existentes; los 181 casos B.1/B.2.B/B.2.C permanecen. **0 tests nuevos**, por no encontrar deficiencia concreta que requiera otra regresión. |
| `node scripts/validate-production-demo.mjs` → `npm run build` | PASS, código 0, runtime v24.19.0; compilación 30,3 s y TypeScript 11,6 s. Smoke HTTP SoloQ/Flex/5v5, métricas, perfiles, admin/dev, errores y guardias API: **PRODUCTION_DEMO_PASS**. |
| Whitespace de los tres commits base y documento nuevo | Sin errores. `git diff --check` del working tree señala solo whitespace preexistente en **CLAUDE.md:2**, preservado fuera del commit. Avisos Git LF→CRLF por la configuración local no son un cambio funcional ni justifican tocar protegidos. |
| Alcance e integridad | Solo este documento nuevo; no cambios en src, tests, esquema, migraciones, flags o sincronización. Protegidos con SHA-256 idéntico, staged limitado al documento y commit revisado. Main y origin/main permanecen en `635f1ae04f33d8aef894c3aaff4c723bc2e64799`. |

La suite no imprimió warnings ni fallos y no hubo errores de build. Logs locales de QA ignorados por Git: `artifacts/b2-pre-persistence-tests.log` y `artifacts/b2-pre-persistence-build.log`, fuera del commit. PostgreSQL real: **10 OMITIDAS**, sin prueba nueva de sourceRevision/concurrencia. PGlite es SQL efímero, no Neon ni dos conexiones independientes. Ninguna migración nueva generada o aplicada; solo los tests existentes preparan sus fixtures con SQL local efímero.

No se aumentan timeouts ni se modifican expectativas para esconder fallos. El build se realiza con el harness Demo existente en copia aislada sin .env*, con guardia PostgreSQL/Riot autenticado. No es una validación de Neon ni Preview protegido.

## 11. Bloqueadores y alcance recomendado de D

**D local propuesto, sujeto a autorización:** columna R + dos tablas/contratos de repositorio privados, migración aditiva revisable y pruebas efímeras de legacy vacío, constraints/cascadas, idempotencia, serialización bigint y sello R→R+1. Ningún lector de perfil, integración sync, productor Riot, endpoint, flag, grant o writer remoto. Evidencia antigua inicia desconocida; no inventar capturas, recepción o revisiones previas. Los helpers locales desconectados no permiten afirmar que todos los writers estén cubiertos.

Secuencia y permisos independientes:

1. Aprobar modelo, ciclo de vida D13, límites de tamaño, semántica de revisión/sello y transición de eventos a disposiciones efectivas.
2. Autorizar **implementación local de D y generación de migración**, con revisión SQL/journal, conservando historial aplicado. Hoy no se genera.
3. Probar migración/constraints/rollback en **BD efímera local**, sin Neon. Es una operación distinta de generar SQL; tampoco se realiza ahora para el esquema propuesto.
4. Autorizar E para integrar **todos** los escritores/capturas/cursor y borrado; mantener consumo probatorio/grants cerrados. Decidir captura fallida (rollback de unidad o pérdida probatoria explícita), no ocultar fallo con éxito.
5. Pruebas F de dos conexiones reales: revision lost update, fuente tras lectura, sellados concurrentes/idempotentes, shared remake/association, DELETE, pausa, lease perdido, rollback, respuesta perdida y escritor omitido. Medir costo/sizes fuera y dentro de tx.
6. Resolver productor confiable, semántica Riot/calendario y política recuperable; un almacenamiento correcto puede existir todavía sin cobertura autorizada. Adaptación B.1/versiones se revisa aparte, nunca por cast.
7. Preflight y **aplicación en Neon staging** bajo autorización independiente: endpoint inequívoco, respaldo Ready, migraciones previas, recuentos, cero escritores incompatibles. Migration antes de desplegar código dependiente. No aplicar SQL manual por separado.
8. Publicación/QA Preview y capturas reales acotadas requieren autorizaciones nuevas. Rollback de código conserva DDL aditivo; no DROP automático ni destrucción de evidencia. D17/grants permanecen para otra fase.

Bloqueadores de uso operacional: revisión sin todos los writers; permisos/old deployments; origen y vinculación sin instrumentación; legado/cursor sin manifiesto; semántica temporal/índice/remake; D13/D18/retención; calendario/plazos D06 para OTP; límite/presupuesto de SQL/CPU/tamaño; autorización versionada D17. Nada se resuelve renombrando los estados de C.

## 12. Decisiones que requieren aprobación

- Aceptar dos tablas + columna, campos discriminados, idempotencia y borrado; no aprobar DDL a partir de este texto implícitamente.
- Precisar qué contexto entra en R, captura fallida y cobertura de escritores/roles/deployments antiguos; tratamiento de compartidos obligatorio.
- Aprobar semántica de sello/inputRevision y nuevo formato operacional **distinto** de contratos puros inalterados; recuperación de transición de disposiciones sin ocultar contradicciones.
- Definir propósito/retención/borrado en JSON/logs/respaldos y acceso D18, sin fechas inventadas; condición previa a guardar nuevas pruebas personales.
- Política recuperable/márgenes/indexación/legacy/remakes y calendario regional D06 antes de uso probatorio, sin cuotas oficiales ni nuevas llamadas implícitas.
- Autorizar separadamente generación local, pruebas efímeras, integración escritores, aplicación staging, publicación y operaciones reales. Ninguna autoriza grants ni equipamiento.

**Recomendación concreta:** siguiente encargo limitado a D local de esquema/repositorio y pruebas, después de resolver las decisiones de persistencia anteriores; conservar los prototipos y todos los consumidores operacionales desconectados. No comenzar E o grants junto con la migración por comodidad. Esta auditoría concluye con un único commit documental local; D no se inició.
