# 1.2.B.2.D — Persistencia local de evidencia

Fecha: **11 de octubre de 2026**. Base `16b7d6f9bf15426f1969e468c449e7355b11f01a`, rama `staging`; remoto comprobado en `726daaf58372324e2b01a41cce9f6a86401c6f29`, cuatro commits por delante y cero por detrás.

Esta entrega implementa D-P1–D-P5 exclusivamente con **PostgreSQL efímero PGlite**. No instrumenta escritores reales ni conecta los prototipos B.1/B.2.B/B.2.C a perfiles, endpoints, sincronización, cron o grants. No inicia B.2.E. Las políticas [D01–D18](CERTIFICATION_AND_GRANTS_DESIGN.md) siguen sujetas a sus parámetros operativos pendientes.

## Modelo y migración

Migración generada: `drizzle/0007_local_evidence_persistence.sql`, journal índice 7 y `0007_snapshot.json` enlazado al snapshot 0006. Se generó con Node 24 y opciones explícitas `--dialect=postgresql --schema=./src/db/schema.ts --out=./drizzle --name=local_evidence_persistence`: no se cargó `drizzle.config.ts`, `.env.local` ni credenciales. **No aplicada remotamente.**

El SQL solo crea dos tablas, activa RLS como las tablas existentes, añade una columna a `players` y restricciones. No contiene DML, DROP ni cambios a columnas anteriores. Las migraciones 0000–0006 y sus metadatos anteriores permanecen intactos; los tests fijan las siete huellas SQL, las entradas anteriores del journal y la cadena de snapshots. La prueba aditiva introduce jugadores, partidas, participaciones y snapshots antes de 0007 y compara su contenido después: sin cambios, salvo la nueva revisión cero.

| Entidad | Campos y semántica |
| --- | --- |
| `players.source_revision` | `bigint NOT NULL DEFAULT 0`, CHECK no negativo. Modo Drizzle bigint nativo, rango hasta 9223372036854775807. Toda respuesta del repositorio convierte revisiones a strings decimales canónicos. |
| `achievement_evidence_headers` | UUID, dueño obligatorio, plataforma/cola/temporada, tipo `rank_capture / match_scan / structural_receipt`, estado `collecting / sealed`, fuente `unknown / synthetic`, versión, clave de operación, padre nullable, intervalo nullable, revisiones y huella nullable, JSON mínimo y fecha de almacenamiento. |
| `achievement_evidence_units` | UUID, dueño y cabecera obligatorios, ámbito explícito, tipo `page / disposition / snapshot / reference`, clave y orden únicos por cabecera, offset/intento según tipo, entidad y predecesor nullable, referencia de fuente nullable, revisión bigint, SHA-256 y datos versionados mínimos. |

Los índices implícitos de PK/UNIQUE sirven a recuperación por dueño/clave, lectura por cabecera/orden y comprobación de FKs compuestas; no se añade GIN ni un índice sin consumidor. Las FKs compuestas impiden referencias entre dueños, plataformas, colas o temporadas. El repositorio comprueba además la plataforma actual del dueño, parentesco y predecesor del mismo escaneo. Solo se insertan nuevos hijos con padres existentes; no hay actualización de referencias ni creación de ciclos desde esta API. Los CHECK impiden autorreferencias directas, tipos inválidos, revisiones negativas, campos de página ausentes, sellos sin R/R+1/huella y JSON individual excesivo. Validación semántica del JSON, límite agregado y orden causal se realizan en la frontera privada; no se atribuye al DDL toda la validación de B/C.

`created_at` es la hora de almacenamiento local, **no** recepción Riot, comienzo de cobertura ni captura histórica. El intervalo debe ser explícito, completo y ascendente, o ambos límites NULL. Fuente legacy conserva `captureId: null`, `receivedAt: null`, endpoint desconocido. No hay backfill de evidencia ni calendario inventado. El valor inicial cero no autentica las fuentes previas; tampoco un valor positivo representa hoy una revisión validada de todos los escritores reales.

## Repositorio privado y contratos

`verification/local-evidence-repository.ts` y `persistence-contracts.ts` importan `server-only`. La factoría recibe un cliente Drizzle **PGlite inyectado** desde tests locales; no crea conexiones, importa `@/db`, lee variables, utiliza URLs, llama Riot ni imprime datos. El schema compartido es una declaración de tablas, no un cliente operacional. No hay export hacia componentes ni un endpoint nuevo.

| Función | Efecto local |
| --- | --- |
| `revision` | Lee revisión y confirma dueño/plataforma; devuelve decimal string. |
| `insertHeader` | Valida cabecera sintética/desconocida, bloquea dueño, recupera retry o inserta y suma una revisión. |
| `insertUnits` | Hasta 100 unidades por transacción, validación estricta, claves/orden, contenido de retry, causalidad de disposiciones, límites agregados e incremento único del lote nuevo. |
| `recover` | Recupera operación por dueño/clave y verifica ámbito; permite resolver una respuesta perdida sin repetir escritura. |
| `list` | Página de hasta 100 cabeceras por dueño/ámbito, cursor UUID y orden determinista. No DTO público. |
| `effective` | Lee una fotografía de unidades hasta revisión explícita; proyecta páginas e información efectiva después de cerrar la lectura. |
| `prepareSeal` | Lee revisión/cabecera/unidades juntas; fuera de la transacción proyecta, recalcula B/C y valida concordancia exacta con las fuentes almacenadas. Devuelve una capacidad privada de esa instancia. |
| `seal` | Recupera retry o compara revisión bajo lock y confirma recibo, referencias completas y R+1 conjuntamente. |
| `reproduceSeal` | Reconstruye el recibo original desde contexto mínimo, referencias inmutables y revisión R; verifica las huellas después de materializar la lectura. No verifica insignias. |
| `sealState` | Distingue `local_revision_unchanged` y `review_required`, sin afirmar vigencia operacional ni autenticación. |
| `deleteEvidence` | Borra toda evidencia del dueño, incluidas otras colas/temporadas, con compare/lock/incremento y cascadas, sin tombstones. |

Los inputs Zod son estrictos: no admiten PUUID, credenciales, payloads completos, campos extra de grants ni URLs. Los Match IDs mantienen plataforma y sufijo numérico; las claves internas son acotadas. Null, false, desconocidos y fallos de página permanecen distintos. Las capturas declaradas nuevas solo admiten `synthetic / unknown`; no se habilita una factoría de recepción Riot. El sellado de esta etapa exige materialización atribuida a fixture sintético. Las huellas son integridad SHA-256, no firmas ni autenticación.

Los DTO internos y recibos reproducidos conservan contractualmente `certification: "not_established"`, `grantAuthorized: false`, `provenanceAuthentication: "not_performed"`, cobertura y cierre no establecidos. Un resultado `structurally_complete` sigue siendo una comprobación de declaraciones. Ningún sello se adapta a B.1, concede, certifica o equipa.

## Revisión, idempotencia y eventos

Todas las escrituras locales bloquean primero la fila del dueño con `FOR UPDATE`. Comparan revisión esperada y usan aritmética SQL `source_revision + 1`, nunca Number ni read/modify/write JS. Overflow, conflicto o fallo SQL revierten la transacción completa, incluida cualquier unidad anterior del lote. Una cabecera nueva, un lote con unidades nuevas, un sello nuevo o eliminación efectiva suman una vez. Lecturas, retries idénticos y eliminación vacía no suman.

Claves de operación son únicas por dueño, y unidades por cabecera/clave. Igual clave e igual contenido original/versionado recupera el mismo ID incluso después de avanzar R. Igual clave con otro contenido falla; no se usa `onConflictDoNothing` para ocultar diferencias. Cada invocación hace **un intento**, sin bucle de retry automático ni reintento de red. El llamador local puede recuperar o repetir con la misma clave; no existe un job de retry. Tras reiniciar el proceso se llama `recover` primero para reconocer una operación ya confirmada, en vez de rematerializar un sello nuevo con la revisión actual.

Una disposición inicial y su transición son unidades distintas e inmutables. El nuevo evento debe referenciar el último evento del mismo ID/escaneo con ordinal mayor. Pending, unknown, 404, invalid o reuse sin atestación pueden continuar; detalles terminales resueltos/excluidos/atestación declarada no se sobrescriben. Su reparación necesitará un protocolo revisado, fuera de D. La proyección ordena `(revision, ordinal)` y conserva solo la disposición efectiva por ID **hasta la revisión solicitada**; mantiene todas las páginas/intentos y los eventos originales en almacenamiento. No envía el event log a C como disposiciones contradictorias. La cadena y las huellas se verifican al leer, y un dato corrupto bloquea.

## Sellado R → R+1

1. Transacción breve `REPEATABLE READ, READ ONLY`: revisión R, cabecera y todas las unidades de su ámbito hasta R. Se materializan filas; hashing, proyección y evaluadores van **fuera** de esa transacción. Sin solicitudes externas, locks explícitos de fuentes ni cambios globales a PostgreSQL.
2. B/C reciben páginas almacenadas y disposiciones proyectadas. Materialización suministrada debe concordar exactamente con detalle, identidad y captura almacenados. Intervalo debe coincidir con el padre; revisiones de B/C deben ser R. Falta de página terminal, desconocidos, gaps o discrepancias bloquean el sello.
3. Transacción de escritura: lock del dueño, recuperación por clave y compare current==R. Confirmación de cabecera del recibo con `inputRevision=R`, `sealedAtRevision=R+1`, huella C original y referencias de todas las unidades. Una capacidad fabricada por otro contexto no es válida. El JSON contiene contexto de reconstrucción, versiones y IDs, sin duplicar todos los detalles/material records.
4. El contenido C conserva R; R+1 está en la columna del sello, no dentro de su huella. Estado local inmediatamente después: revisión sin cambios. Una fuente posterior R+2 requiere revisión; el recibo original sigue reproducible a R. No autorreferencia circular ni regrant.
5. Retry mismo token/clave/contenido recupera el sello sin otra suma ni referencias duplicadas. Un fallo después del insert del recibo, incluso en referencias, hace rollback completo. Si cambió la fuente, se rechaza esa preparación, no se simula éxito.

El sellado local usa el prototipo C para recibos de partidas. Las capturas ranked se pueden almacenar, pero **no se añade un sellador R1 ni un verificador operacional nuevo**. R1/I1 mantienen `1.1.A-observed-v1`; OTP mantiene 65 %, N>=50 y `1.1-otp-observed-v2`.

## Límites y coste

Límites de seguridad **locales**, no cuotas de Riot ni presupuestos de ingesta aprobados:

| Límite | Valor / comprobación |
| --- | --- |
| JSON por cabecera | 64 KiB, CHECK PostgreSQL `octet_length(data::text)`, validación antes de escribir. |
| JSON por unidad | 16 KiB, mismo CHECK y validación; página con hasta 100 IDs. |
| Lote de unidades | 1–100; referencias de sello insertadas en grupos de 100. |
| Unidades por cabecera | 100.000, agregación bajo lock del dueño. |
| JSON de cabecera y unidades | 32 MiB por cabecera; no se sella si sus referencias/contexto exceden el límite. |
| Cabeceras por dueño | 1.000, comprobación agregada bajo lock. |
| JSON total por dueño | 64 MiB, sumas en BD bajo lock. |

Para nuevos JSON, el repositorio reserva conservadoramente el doble del tamaño UTF-8 compacto para cubrir espacios de representación JSONB; existentes se cuentan con bytes reales de PostgreSQL. Puede rechazar antes del máximo; nunca trunca para hacer válida una prueba. Conteos de filas y bytes JSON no representan tamaño total de índices, filas, WAL, MVCC o respaldos.

Inserción consulta claves de retry e historiales de las entidades afectadas, sin cargar todos los payloads de la temporada por lote ni consultar una fila por ID. Los conteos/sumas siguen recorriendo evidencia del dueño; son coste real y requieren medición antes de instrumentar ingesta. Preparación/reproducción cargan un conjunto acotado y usan mapas por Match ID, sin búsquedas cuadráticas nuevas. La memoria puede llegar a decenas de MiB, y C/materializador conservan su coste; no se realizó benchmark Neon ni se afirma latencia de producción. Las huellas/versiones/contexto permiten reproducción sin duplicar los detalles del recibo.

## D13, acceso y rollback

FK mandatory owner + CASCADE alcanza cabeceras, unidades, transiciones, referencias y huellas al eliminar al jugador en la base local. FKs compuestas evitan que el borrado personal afecte a evidencia de otro dueño. La eliminación privada es owner-wide, no solo la cola solicitada, y no guarda IDs/hashes/tombstones. Tests prueban ambos caminos y preservación de otro jugador. No se crean grants, eventos de concesión ni retención adicional.

Esto **no resuelve** referencias personales preexistentes en `sync_locks.run_progress`, logs, sessionStorage o respaldos. No se toca DELETE operacional ni se borran checkpoints; inventario, redacción selectiva y política de retención siguen pendientes conforme [auditoría A–C](B2_PRE_PERSISTENCE_AUDIT.md). Tampoco RLS sin policies demuestra autorización privada: los tests PGlite usan rol local; acceso operacional requiere diseño y autenticación posteriores.

No desplegar el schema dependiente antes de aplicar 0007 con autorización separada: los SELECT/INSERT existentes de `players` pueden incluir la columna nueva aunque no invoquen el repositorio. La inspección comprobó DTOs públicos explícitos, sin serializar el bigint nuevo; tests existentes cubren lectores. Production Demo sigue aislada y no necesita PostgreSQL. Esta tarea no toca consumidores operacionales.

Rollback recomendado: retirar código nuevo y mantener DDL aditivo y migración registrada. No ejecutar DROP ni borrar journal/migraciones. Descartar solo instancias efímeras de tests. Cualquier aplicación/restauración/remoción remota necesita preflight, respaldo y autorización específicos; esta entrega no los realiza.

## Pruebas y garantías pendientes

`tests/achievements-persistence.test.ts`: **63 regresiones PGlite**. Prueban migración sobre filas legacy, hashes/journal, revisiones canónicas, bigint por encima de Number.MAX_SAFE_INTEGER, overflow, constraints/FKs/propietarios, idempotencia y recuperación, límites de unidad/lote/cabeceras, pending→resolved, fotografía a revisión, corrupción, falta de terminal, procedencia sintética, R/R+1, reproducción tras reinicio, fuente posterior, rollback de prefijo y sello, D13 owner-wide/cascadas y cero tablas de grants o cambios en fuentes operacionales.

PGlite demuestra estas sentencias, transacciones y rollback en su motor local. **No** demuestra carreras MVCC entre conexiones PostgreSQL independientes, todas las esperas de locks ni coordinación con remakes compartidos. No hubo conexión Neon. Las suites opt-in de PostgreSQL real permanecen omitidas cuando no hay instancia local desechable identificada; no cuentan como aprobadas. La configuración de aislamiento se usa con la API instalada, pero su concurrencia real queda pendiente de F.

Validación requerida en Node **24.19.0**, secuencial: lint → typecheck → suite completa con dos workers/hookTimeout 60 s → `scripts/validate-production-demo.mjs` (ejecuta `npm run build` y smoke HTTP en copia aislada sin secretos/conexiones). Resultado final se informa en el chat; no se asumen aprobadas pruebas no ejecutadas.

### Primera validación: detenido, sin commit (registro histórico)

- Node **24.19.0**; `npm run lint` y `npm run typecheck`: correctos.
- Suite focalizada nueva: **63 aprobadas** sobre PGlite.
- `npm run test -- --maxWorkers=2 --hookTimeout=60000`: **1095 aprobadas, 2 fallidas y 10 omitidas**; 51 archivos aprobados, 2 fallidos y 2 omitidos. Duración 96,58 s. Las omisiones corresponden a PostgreSQL local opt-in; no prueban concurrencia.
- Fallo `tests/database.test.ts:1633`: inventario RLS fijado en siete tablas; ahora hay nueve por las dos tablas autorizadas. Se detiene antes de las siguientes aserciones de RLS/acceso de ese caso; no se declara validado ese caso.
- Fallo `tests/sync-progress-migration.test.ts:55`: fija el journal en siete entradas; 0007 lo amplía correctamente a ocho. La comparación del prefijo histórico previa a esa aserción pasa; el test nuevo también comprueba las siete huellas y el journal anterior.
- Conforme a la instrucción de detenerse ante validación crítica fallida, **no se modifican esas pruebas, no se ejecuta el build/smoke posterior y no se crea commit**. La implementación, el SQL y esta documentación quedan pendientes en el working tree.
- Antes de completar D, ajustar esas expectativas de inventario a un esquema extensible conservando las comprobaciones de RLS, acceso y prefijo histórico; después repetir la secuencia completa y el build/smoke aislado. No hay aprobación integral ni RC listo para aplicación remota.

### Reanudación autorizada: inventarios corregidos; validación detenida por timeout

La instrucción posterior «Corregir inventarios y completar validación» autorizó exclusivamente corregir esos dos tests y actualizar este estado. Se conserva el esquema, SQL, snapshot, journal y las primitivas preparados, sin regenerar migraciones ni instrumentar escritores.

- `database.test.ts` comprueba los nueve nombres de tablas esperados, RLS en todas y ausencia de policies en public. Introduce cabecera/unidad sintéticas en PGlite, verifica que existen antes de cambiar de rol y prueba que el rol ordinario no lee ninguna de las nueve tablas. No se suaviza la seguridad ni se usa un resultado vacío por ausencia de fixtures de evidencia.
- `sync-progress-migration.test.ts` mantiene SQL exacto, entrada índice 6, snapshot y cadena de 0006; conserva el cotejo histórico con `f9c0fd0` y compara además las siete entradas completas con HEAD base `16b7d6f`. Admite ocho entradas y exige 0007 en índice 7, sin reescribir el prefijo. La validación de SQL/snapshot 0007 sigue en los 63 tests de persistencia.
- Node **24.19.0**. Validación focalizada de los dos casos antes fallidos: **2 aprobados**; 114 casos excluidos por filtro, no omisiones por PostgreSQL opt-in.
- `npm run lint` y `npm run typecheck`: correctos después de las correcciones.
- `npm run test -- --maxWorkers=2 --hookTimeout=60000`: **1096 aprobadas, 1 fallida y 10 omitidas**; 52 archivos aprobados, 1 fallido y 2 omitidos; duración **154,39 s**. Pasan ambos casos corregidos y los **63 tests nuevos PGlite**. Las diez omisiones siguen siendo opt-in de PostgreSQL local; no acreditan concurrencia.
- Fallo nuevo: `tests/production-demo.test.tsx:94`, caso `serves leaderboard, profiles, graphs and awards for 5v5 exclusively from fixtures`, excede el límite vigente de **30000 ms**. La salida es `Test timed out in 30000ms`; no hay en esa salida evidencia suficiente para atribuir la causa a recursos del entorno o a una regresión funcional.
- Conforme a la instrucción de detenerse ante validación crítica fallida, **no se altera ese test ni su timeout, no se reintenta la suite, no se ejecuta build/smoke y no se crea commit**. Se preservan los diez archivos de esta entrega en el working tree y los cambios protegidos ajenos.
- Revisión adicional de solo lectura: snapshot 0007 difiere del 0006 únicamente por las dos tablas y columna/CHECK de revisión; ambas tablas tienen RLS sin policies. Journal conserva exactamente el prefijo de siete entradas. SQL/metadatos preparados y huellas de archivos protegidos permanecen iguales a las del preflight; no aparecen consumidores operacionales nuevos.
- Siguiente paso antes de cerrar D: diagnosticar el timeout de Demo 5v5 con autorización, sin suavizar expectativas, y repetir las validaciones completas incluyendo build/smoke aislado. D no se declara validado integralmente ni listo para commit o aplicación remota.

### Diagnóstico autorizado de Demo 5v5

La siguiente instrucción «Diagnóstico Demo 5v5 y cierre» autorizó investigar sin aumentar límites, modificar consumidores operacionales ni rehacer D. Preflight: misma rama, HEAD/base y cuatro commits por delante; SQL, snapshot, journal, primitivas y archivos protegidos conservan sus huellas. Runtime **Node 24.19.0**, sin build simultáneo.

Se inspeccionaron el test, `getLeaderboard`, `getProfile`, `getSeasonOverview`, `computeAwards`, `getSignatureBaseline`, fixtures y configuración. `testTimeout` sigue **30000 ms** y no se confunde con `hookTimeout`. Los cinco secretos quedan ausentes mediante mocks; PostgreSQL arroja al intentar conectarse y `fetch` solo admite respuestas Data Dragon simuladas. El test limpia env/globals/mocks por caso; el mock de cache ejecuta la función directamente. No se identificó una fuga de estado demostrada. El camino Demo evita DB y el repositorio nuevo no tiene consumidores en esos módulos.

Trabajo repetido preexistente confirmado en código: un caso consulta el leaderboard, recorre 12 perfiles, vuelve a consultar el primero, genera el overview y obtiene el baseline. `getProfile` Demo regenera el roster completo para encontrar un jugador; los fixtures vuelven a calcular límites temporales dentro de sus bucles. Es una oportunidad acotada de rendimiento futura, **no una causa del timeout demostrada**. Esos módulos y el test Demo no fueron cambiados por D; no se optimizan ahora, no se omiten aserciones ni se mockean sus cálculos para hacer pasar la prueba.

Reproducciones en procesos independientes, `--maxWorkers=1`, sin retries ni cambios del límite:

| Ejecución | Resultado | Duración del caso 5v5 | Duración total reportada |
| --- | --- | --- | --- |
| A, primer caso aislado | PASS | 17,955 s | 22,41 s (resumen Vitest) |
| B1, repetición separada | PASS | 17,029 s | 20,605 s (startTime hasta fin del archivo, JSON) |
| B2, repetición separada | PASS | 17,159 s | 20,689 s (mismo criterio JSON) |
| B3, repetición separada | PASS | 16,803 s | 20,301 s (mismo criterio JSON) |
| D, archivo completo aislado | 24 PASS, 0 FAIL | 18,181 s | 64,265 s de ejecución del archivo; 67,835 s desde startTime JSON |

En el archivo aislado SoloQ tardó 12,008 s y Flex 12,030 s. Casos excluidos por el filtro individual no son omisiones de PostgreSQL. El fallo previo de 30 s se conserva como histórico: estas reproducciones no demuestran contención, contaminación de mocks, dependencia de orden ni la causa exacta. Se aplicó el **caso B** autorizado (no reproducido en estas ejecuciones): sin corrección adicional, instrumentación temporal, cambios de timeout o tests Demo. Los informes de diagnóstico se guardan en `artifacts/` ignorado y no forman parte del commit.

### Validación final de cierre

Secuencia efectivamente ejecutada, **Node 24.19.0**, sin build y tests simultáneos:

1. `npm run lint`: PASS.
2. `npm run typecheck`: PASS.
3. `npm run test -- --maxWorkers=2 --hookTimeout=60000`: **1097 aprobadas, 10 omitidas, 0 fallidas**; **53 archivos aprobados y 2 omitidos**, duración **101,08 s**. Pasan los 63 casos PGlite nuevos, ambos inventarios corregidos, los 24 casos Demo y las regresiones de motores existentes. Comparación con aislamiento: la suite con dos workers no reprodujo el timeout de 5v5, sin modificar límites ni añadir retries. El resumen estándar no proporciona duración individual del caso concurrente; no se inventa esa cifra. Diez tests opt-in PostgreSQL siguen sin ejecutar y no prueban MVCC/concurrencia real.
4. `node scripts/validate-production-demo.mjs`: **PRODUCTION_DEMO_PASS**. Ejecutó `npm run build` en copia efímera explícitamente sin `.env*`, `.git`, `CLAUDE.md` o `.claude/`; cinco secretos ausentes, guard de red activo. Compilación 21,7 s, TypeScript 9,0 s, siete páginas estáticas generadas y servidor local READY. Smoke HTTP aprobó ranking, perfiles y métricas en SoloQ/Flex/5v5, páginas de privacidad/términos, errores/rutas dev y bloqueos administrativos/cron/status esperados. Sin PostgreSQL ni API Riot autenticada; el guard solo permite localhost y assets públicos Data Dragon. No es una validación de Preview ni Production remotos.

No fue necesaria ninguna corrección adicional al código preparado ni al test Demo. No se afirma que el timeout histórico esté causalmente resuelto: su origen permanece desconocido; cuatro procesos aislados, el archivo completo y la suite final no lo reprodujeron. Si reaparece, registrar operaciones/recursos con instrumentación temporal y mantener cerrado el commit de cualquier nueva corrección hasta validarla, sin subir el timeout.

Revisión final: SQL 0007, snapshot y journal mantienen sus huellas del preflight; 0000–0006 y sus metadatos no se modifican. Se revisaron RLS de nueve tablas, constraints/FKs/cascadas, bigint/string, idempotencia, rollback, legado desconocido y R/R+1 con las pruebas anteriores. Solo import interno entre los nuevos módulos, sin consumidores operacionales, nuevas rutas o grants. Archivos protegidos conservan sus hashes; `main` y `origin/main` permanecen en `635f1ae04f33d8aef894c3aaff4c723bc2e64799`.

La entrega permite un único commit **local** con el mensaje `feat(achievements): add local evidence persistence schema`, limitado a diez archivos: schema, SQL/snapshot/journal 0007, dos módulos privados, tests nuevos, dos tests de inventario y este documento. No se incorporan logs/JSON de diagnóstico ni archivos protegidos. Los cuatro commits anteriores se preservan; SHA final se informa en el chat. No autoriza push, aplicación remota, activación ni B.2.E/F.

**B.2.E/F aún bloquean consumo probatorio operacional:**

- Autorizar e instrumentar todos los escritores y rutas relevantes, con captura/progreso/revisión atómicos, legacy desconocido y reintentos dentro de los presupuestos vigentes. Esta columna no cubre hoy esos escritores.
- Probar con conexiones locales independientes read/sellado, rollback, DELETE/creación, asociaciones y reclasificación de remakes compartidos; definir orden de locks y controlar deployments antiguos/SQL externos.
- Resolver procedencia operacional, estabilidad/semántica Riot, calendario/plazos D06, D13 externo y D18, almacenamiento/coste real y política versionada D17. Hashes y sello no sustituyen ninguna de esas dimensiones.
- Revisar migration RC, autorización separada para respaldo/aplicación staging y después publicación. No avanzar a E, habilitar flags, equipamiento ni conceder por terminar D.

Sin push, deployment, modificación main/Production, migración remota, acceso Neon, llamadas Riot, sincronizaciones reales o grants. `CLAUDE.md`, `.claude/` y `.env.local` preservados.
