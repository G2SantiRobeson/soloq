# 1.2.B.2.C — Recibos estructurales puros

Base local: `60ba3f2296ad927d0c7b884ecc9c6ae856733425`, `staging`. Referencia `origin/staging`: `726daaf58372324e2b01a41cce9f6a86401c6f29`, confirmada por consulta Git de solo lectura al iniciar. Se preservan los commits locales `f79e029` y `60ba3f2`. Fecha: **11 de octubre de 2026**.

## Alcance y fronteras A–G

Este prototipo solo representa y coteja **declaraciones explícitas**, normalmente fixtures. No es el productor operacional propuesto en B.2.A. No invoca Riot, PostgreSQL, servicios, render, B.1, sincronización, backfill, leases ni jobs. No hay nueva persistencia, endpoint, cache, feature flag, autenticación o permiso de grants.

| Nivel                                | Estado real de B.2.C                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| A — Página declarada                 | Conserva parámetros, scanId, intento, captura declarada y respuesta presentada.                                          |
| B — Escaneo coherente                | Comprueba identidad, parámetros, offsets, intentos y contradicciones detectables.                                        |
| C — Completo según lo suministrado   | Exige cadena desde cero y terminal corta/vacía exitosa explícita. No garantiza índice estable ni lista completa de Riot. |
| D — Recibo estructural               | Coteja IDs, disposiciones, detalles pertinentes y materialización B.2.B; genera huella reproducible.                     |
| E — Origen operacional autenticado   | **No comprobado**, incluso con source riot o captura/revisión declaradas.                                                |
| F — Cobertura recuperable autorizada | **No establecida**; no se afirma exhaustividad del proveedor.                                                            |
| G — Concesión                        | **No autorizada**. No existe escritor ni adaptador hacia autorización B.1.                                               |

Todos los resultados mantienen `mode: "pure_structural_receipt"`, `certification: "not_established"`, `grantAuthorized: false`, `writes: "none"`, `provenanceAuthentication: "not_performed"`, `revisionValidation: "not_performed"`, `indexStability: "unproven"`, `recoverableCoverage: "not_established"` y `seasonClosure: "not_established"`. `uncheckedRequirements` enumera origen, estabilidad, cobertura autorizada, revisión transaccional, calendario autenticado y autorización de concesión. No existe estado verified operacional.

## Formato y funciones

Módulos internos `server-only`: `receipt-contracts.ts` y `receipts.ts`, dentro de `src/server/achievements/verification/`.

- Formato: **`1.2.B.2.C-structural-receipt-v1`**.
- Canonicalización: **`1.2.B.2.C-canonical-json-v1`**.
- `fingerprintDeclaredPage(unknown)`: valida la forma estricta y calcula integridad de una página declarada; null si su estructura es inválida. No acredita ámbito, origen o escaneo completo por sí solo.
- `reconcileDeclaredEvidence(unknown)`: valida, rematerializa entradas B.2.B, coteja páginas/disposiciones/contenido y retorna estados estructurales, fuentes completas, observación limitada y contadores.
- Ayudantes privados separan inspección de páginas, captura y disposiciones, normalización temporal y serialización. No hay reloj implícito, entorno, aleatoriedad, IO, firmas ni logs.

La cabecera incluye naturaleza synthetic/declared, identidad UUID interna, plataforma, cola, temporada, scanId, revisión unknown/declared, consulta efectiva y reporte de cambio de índice unproven/reported. El materializador B.2.B se recibe como **entrada**, con sus dos huellas esperadas: se recalcula, no se confía en un DTO ya marcado como validado.

El intervalo objetivo es explícito, UTC ISO a precisión de milisegundos, `precision: "milliseconds"`, `bounds: "half_open"`, `[from,to)`. Los parámetros efectivos `startTime/endTime` se conservan como enteros epoch en **segundos**, sin recalcularlos para hacer coincidir un resultado; deben cubrir numéricamente el intervalo objetivo. `timeSemantics: "unconfirmed"` evita presentar esos filtros como límites Riot acreditados. Cola/type pueden ser null; para un cierre ranked estructural deben ser compatibles con la cola objetivo y tipo null/ranked.

Las páginas conservan su propia identidad, scanId, número explícito de intento creciente por offset, start/count, filtros, captura B.2.B declarada/legacy y respuesta success/partial/failed. Fallos simulados distinguen network/http_429/http_5xx/invalid_response. Nunca contienen una lista vacía ficticia. Count se limita localmente a 1–100 para impedir una prueba terminal trivial con count=0; esto no modifica la ingesta ni redefine la especificación Riot que admite cero.

Cada ID tiene una disposición declarada. Los detalles son mínimos: matchId, jugador interno/platform nullable, queueId y timestamp nullable, win/isRemake/championId nullable. No hay PUUID, payload original, headers, URLs ni secretos. Datos extra o una autorización inventada se rechazan, sin eco de entrada ni error detallado del parser.

## Páginas, intentos e índice

El recibo **conserva todas las declaraciones originales**, incluidas páginas repetidas, errores y reintentos; los IDs de cada página conservan su orden recibido. Ordenar páginas por offset/intento no equivale a ordenar partidas por ID.

Para comprobar una cadena se usa el intento de mayor número explícito por offset. Un fallo previo puede quedar resuelto por un intento posterior exitoso. Un fallo posterior no se oculta eligiendo un éxito antiguo. Dos éxitos en el mismo offset con listas distintas, o dos declaraciones distintas del mismo offset/intento, producen contradicción. Un captureId declarado asociado a contenido diferente también produce contradicción.

Una página exactamente llena requiere continuación. Solo una página exitosa corta/vacía sirve como terminal del escaneo **declarado**. Una página intermedia ausente, primera página no cero, respuesta partial/failed, falta de terminal o páginas posteriores a una terminal impiden cierre. Repeticiones de IDs dentro/entre páginas efectivas bloquean por ambigüedad; IDs repetidos en reintentos idénticos no inflan la unión. No se borran páginas para mejorar el resultado.

Los IDs descubiertos son la unión de los IDs de todas las respuestas presentadas que los contienen, también las parciales/contradictorias; no se descartan los que un intento posterior dejó de mostrar. Un reporte de IDs tardíos/desplazamiento se conserva y bloquea. El prototipo detecta ciertos síntomas, pero **no detecta todo cambio de índice**: una alteración sin solapamientos puede ser invisible. No genera snapshot token ni afirma una fotografía estable.

## Disposiciones, exclusiones y desconocidos

| Disposición                               | Tratamiento                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| resolved                                  | Comprueba campos declarados y cotejo; no autentica la consulta de detalle.                                         |
| reused_without_attestation                | Siempre bloquea confianza estructural de reutilización; contenido existente no equivale a procedencia.             |
| reused_with_matching_attestation_declared | Coteja identidad, revisión declarada y ambas huellas B.2.B; solo concordancia declarativa, nunca autenticación.    |
| excluded_with_basis                       | Conserva detalle y exige motivo demostrable en los campos presentados: otra cola, fuera de objetivo o remake true. |
| unavailable_404                           | Gap pendiente de resolución; no ausencia permanente ni exclusión inocua.                                           |
| pending / unknown                         | Conserva ID y bloqueo; no se transforma en derrota ni se elimina.                                                  |
| invalid                                   | Conserva motivo schema/identity/scope/conflict y bloquea.                                                          |

Duplicados exactamente iguales se conservan y no duplican conteos. Disposiciones contradictorias se conservan, se marcan irresolubles y **no** se elige una fila favorable para evaluar. Detalle de otro jugador/plataforma o con matchId discordante no entra al conjunto ranked. Cola/timestamp/identidad desconocidos bloquean; este primer formato exige los cuatro para clasificar incluso una exclusión, deliberadamente conservador.

Exclusiones se comprueban en orden: otra cola, fuera de objetivo, remake confirmado. Null en remake jamás es false; resultados desconocidos no se inventan. Un remake true se mantiene en fuentes/recibo y se excluye del denominador con motivo explícito, aunque win/campeón sean desconocidos. Campo desconocido pertinente impide completar. El marcador ya normalizado es una declaración, no prueba de su fundamento Riot.

`detail_outside_query` significa discordancia con la comparación numérica local del prototipo por timestamp de inicio. **No** demuestra incumplimiento de Riot: aún no está confirmado qué timestamp filtra ni la inclusividad de sus límites. Una exclusión fuera del objetivo puede justificarse si está dentro del margen declarado; no valida por sí sola la semántica operacional del filtro.

Contadores: discovered = IDs únicos presentados; disposed = esos IDs con disposición; known = IDs sin irresoluciones detectadas de clasificación/reutilización; unresolved = IDs únicos irresolubles o sin disposición; rankedInTarget = detalles pertinentes materializables, incluidos remakes. Known no significa autenticado. Un dato desconocido en varios campos cuenta una sola vez. Si no hay contenido estructural utilizable, counts es null, no cero inventado.

## Concordancia con B.2.B

Se preservan íntegros sus contratos, formato y función; no se exporta ni cambia su serializador privado. Reutilizamos tipos de captura/revisión, cola/plataforma, orden ordinal, ventana y `materializeAchievementEvidence`.

Se comprueban: identidad/temporada/cola, ventana, código correspondiente, huellas de contenido/metadatos recalculadas y revisión **declarada**. Primero se clasifican todos los IDs, después se comparan los detalles ranked pertinentes con los registros B.2.B del intervalo, campo por campo, incluidos remakes. Otras colas/márgenes se conservan con exclusión; no se exige igualdad ingenua entre el listado de todas las colas y el ranked.

Filas conocidas discordantes, una derrota recuperada ausente del conjunto o un ID nuevo pertinente no materializado producen contradicción. Falta de detalle/página todavía recuperable produce concordancia pendiente, no una falsa contradicción definitiva. Un escaneo declarado cerrado que omite un ID almacenado pertinente tampoco concuerda. El análisis de la muestra conocida sigue siendo **observacional** y no puede reemplazar status/reasons del recibo. Unknowns e IDs sin detalle permanecen en sus disposiciones aunque no exista una fila evaluable.

Legacy sigue sin receivedAt/captureId retroactivos: bloquea en página, detalle o fuente pertinente B.2.B. Capture IDs se cotejan también entre las fuentes B.2.B y el recibo: un detalle idéntico con la misma captura puede reutilizarse declarativamente; el mismo captureId con metadatos/contenido distintos produce contradicción. La captura se liga a identidad mínima, registro y metadatos, sin confundir cambios posteriores de disposición/reutilización con cambios del detalle. Una atestación coincidente declarada no eleva la revisión a transaccional verificada. No existe conversión automática hacia `VerificationContext`, `ReconciliationReceipt` B.1 ni `simulateBadgeVerification`.

## Reglas por señal y estados

**I1 / Racha imparable:** el caller elige cinco IDs de victoria de la racha. Deben ser consecutivos en la evidencia elegida por el evaluador vigente tanto en B.2.B como en los detalles cotejados, con win true/remake false y todos dentro del objetivo. El extremo superior debe incluir la quinta observación, por ejemplo timestamp+1 ms declarado explícitamente; finalizar exactamente en su timestamp la excluye. Remakes intercalados se conservan sin romper la racha; una derrota sí la rompe. Una temporada todavía en importación no impide por sí sola cotejar un intervalo más pequeño completo. Cinco victorias sin terminal/disposiciones suficientes no completan el recibo.

**OTP histórico propuesto:** una sola cola, desde el inicio de temporada hasta su endAt explícito, con el calendario **declarado** coincidente en plataforma/temporada/límites. EndAt null bloquea como season_open; calendario ausente/discrepante bloquea. No se calcula fin a partir de reloj, fechas de fixture, completed o booleano. Incluso límites sintéticos concordantes mantienen `seasonClosure: "not_established"`. C/N y exclusiones proceden de B.2.B/evaluador actual: N>=50 y 20*C>=13*N exactos. Un recibo estructuralmente completo con N=49 o C=32/N=50 puede representar condición insuficiente/no observada; estado del recibo y cumplimiento del logro son dimensiones distintas. Nunca concede OTP histórico.

Estados: `invalid_input` (forma rechazable), `collecting` (páginas/terminal/disposiciones pendientes), `blocked` (unknowns relevantes, 404, reutilización/legacy, ámbito o calendario insuficientes, racha no sustentada), `contradictory` (declaraciones/identidad/detalles/revisión/huellas incompatibles) y `structurally_complete` (concordancia de A–D exclusivamente). Contradictory tiene prioridad; un bloqueo no pendiente prevalece sobre collecting. Razones son códigos estables, únicos y ordenados. Nunca se usa verified ni reconciled sin cualificación estructural.

## Canonicalización e integridad

UTC ISO en milisegundos, rechazo de precisión temporal que JS Date truncaría, enteros seguros, null explícito. JSON UTF-8 sin espacios, claves ordinales y arrays con orden definido: páginas por offset/intento/contenido, disposiciones por ID/contenido, unión de IDs ordinal; el orden original de IDs dentro de páginas se conserva. Duplicados originales siguen en arrays y, por tanto, en la huella. Empates temporales competitivos permanecen ambiguos aunque el orden sea determinista.

Una huella de página SHA-256 incluye ambas versiones y toda su declaración, sin expectedFingerprint. El recibo incluye páginas con sus hashes, disposiciones/capturas, ámbitos, parámetros, metadatos/contenido B.2.B y análisis/razones. Su SHA-256 no está dentro del contenido que se hashea. Se validan huellas esperadas de páginas cuando se suministran y las dos huellas B.2.B; null en expectedFingerprint significa que no había referencia, no captura autenticada. El hash del recibo es null en contradicciones o estructura no utilizable; un recibo bloqueado/collecting puede tener hash reproducible de las declaraciones pendientes.

Los hashes solo detectan diferencias de contenido. No son firma Riot, autenticación de captureId, revisión vigente, cobertura ni permiso. Un cambio del formato/canonicalización requiere versión nueva antes de persistencia futura. El resultado en memoria puede modificarse por un caller: debe rematerializarlo/recalcularlo, nunca confiar en su etiqueta antigua.

## Seguridad, costo y D13

Todo permanece desconectado de rutas/clientes/consumidores operacionales. No hay acceso a fuentes externas, logs de IDs ni cache persistente. La naturaleza synthetic/declared no puede autenticar al proveedor y server-only tampoco acredita origen. No tratar este constructor como validador confiable de peticiones del navegador.

Capturas, recibos, manifiestos, metadata y hashes vinculables al jugador son evidencia personal. La futura implementación D13 deberá eliminarlos junto al jugador, incluidos copias/referencias y hashes identificables. No se define retención mínima sin finalidad y plazo aprobados. Esta fase no guarda nada.

Costo: agrupación/cotejo mediante mapas, ordenamiento proporcional al volumen, hashes/serialización de todos los datos y dos materializaciones puras (fuente presentada y muestra cotejada). No hay SQL, N+1 ni red. No se truncan listas para mejorar el resultado. Deben definirse límites de tamaño/abuso y presupuestos de reconciliación antes de una entrada operacional; estas fixtures no miden Neon ni índice Riot.

## Pruebas y pendientes B.2.D

Regresiones: páginas consecutivas/vacías/llenas, huecos, reintentos y offsets duplicados, éxitos/capturas contradictorios, repetición/cambio de índice detectable, 404/pending/unknown/legacy/reuse, ámbito y fechas, otras colas/márgenes/exclusiones, remakes true/false/null, derrota recuperada, empates, concordancia B.2.B, calendario abierto/declarado, N=49/50 y C=32/33/65/64, huellas/revisión falsas, determinismo y aislamiento. No prueban estabilidad del índice Riot ni concurrencia real.

Antes de B.2.D, con autorización separada: precisar semántica Riot temporal/errores/remakes todavía desconocida según `EVIDENCE_MATERIALIZATION.md`; productor operacional y control real de identidad/origen/capturas; política de cobertura recuperable e indexación tardía/reescaneo; revisión transaccional común y pruebas PostgreSQL con conexiones independientes; calendario regional/cierre autorizado; contratos operacionales/adaptación B.1 explícita; permisos, D13/D18 y límites de tamaño/costo. No basta con renombrar structurally_complete como verified.

No se inició B.2.D. No hay autorización de grants, migraciones, push, deployment o habilitación. Los criterios R1/I1 y OTP, sus versiones, la UI y los contratos anteriores permanecen intactos.

## Validación de esta entrega

Node **24.19.0**, seleccionado solo en los procesos de validación, sin cambiar PATH global ni archivos de entorno. `npm run lint` y `npm run typecheck`: correctos, sin warnings en la ejecución definitiva. Suite completa `npm run test -- --maxWorkers=2 --hookTimeout=60000`: **1034 aprobadas, 10 omitidas**, 52 archivos aprobados y dos suites omitidas. **72 casos nuevos** de recibos; B.1 y B.2.B se conservan íntegros. Las diez omisiones corresponden a seis pruebas opt-in PostgreSQL de logros y cuatro del lease; no acreditan concurrencia aprobada.

La primera ejecución de la suite junto al build tuvo un timeout de 30000 ms en el caso existente de Demo 5v5. Se completó la revisión final de capturas y se repitió la suite sin build simultáneo: pasó en 97,61 s, sin modificar el test, sus expectativas ni su timeout. El fallo inicial se conserva en el log local de QA y no se presenta como ejecución aprobada.

`npm run build` definitivo: correcto mediante `node scripts/validate-production-demo.mjs`, en una copia local aislada sin `.env*` ni secretos, con guardia de PostgreSQL/Riot autenticado. Smoke HTTP: **PRODUCTION_DEMO_PASS**. Los logs y artefactos locales temporales están fuera del commit. No se modificó el harness.

Revisión: cuatro archivos nuevos exclusivamente; sin secretos, nuevos endpoints, cambios de contratos previos, evaluadores, fuentes operacionales, schema, migraciones o flags. Diff staged sin errores de whitespace. Contenidos de CLAUDE.md, `.claude/` y `.env.local` comprobados por SHA-256, preservados y fuera del commit. La única lectura remota fue `git ls-remote` para confirmar la base; cero operaciones remotas de producto, Riot, Neon, grants o persistencia operacional.
