# 1.2.B.2.B — Materialización pura de evidencia

Base: `f79e029480c817f2d905dadc1622ff241f111648`, `staging`. Referencia remota comprobada mediante fetch: `726daaf58372324e2b01a41cce9f6a86401c6f29`. Fecha de inspección y consulta documental: **11 de octubre de 2026**.

## Alcance y frontera de confianza

`verification/materialization-contracts.ts` y `materialize.ts` son internos y `server-only`. Solo tests los invocan. No hay adaptador hacia `VerificationContext`, perfiles, API, servicio operacional, SQL, sincronización, cron, recibos o grants. B.1 permanece intacto. Se reutilizan los evaluadores puros sin cambiar criterios/versiones: R1 e I1 `1.1.A-observed-v1`; OTP `1.1-otp-observed-v2`, mínimo 50 partidas y comparación exacta 13/20.

`materializeAchievementEvidence(unknown)` valida entradas explícitas, crea una representación reproducible y recalcula la observación sobre **todas** las fuentes suministradas. No lee reloj, entorno, archivos ni redes. SHA-256 de Node es una operación determinista de CPU; no se generan IDs aleatorios, fechas o revisiones.

La distinción es contractual, además de documental:

| Dimensión       | Garantía de B.2.B                                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estructura      | Zod estricto, sin proyección silenciosa de campos extra. Identidad UUID interna; plataforma, cola, temporada y ventana concordantes; enteros seguros; fechas válidas. |
| Atribución      | `known` con origen declarado, `unknown` o `unproven` con reclamación. `known` significa atributo interno suministrado, **no** proveedor autenticado.                  |
| Captura         | `declared` con datos nullable; `legacy` exige captureId/receivedAt null y endpoint unknown. No acredita una petición real.                                            |
| Autenticación   | Siempre `provenanceAuthentication: "not_performed"`, incluso para source/origin riot.                                                                                 |
| Revisión        | `unknown` o `declared` con valor opaco; siempre `revisionValidation: "not_performed"`. No compare transaccional.                                                      |
| Cobertura       | Siempre `intervalCoverage: "unproven"`; manifiesto es desconocido o **declarado**. Completed no cambia esta garantía.                                                 |
| Concesión       | Siempre `certification: "not_established"`, `grantAuthorized: false`, `writes: "none"`.                                                                               |
| Recibo / cierre | Siempre `{state: "unknown"}`. No se construyen recibos ni se autentica calendario estacional.                                                                         |

Ningún objeto sintético se vuelve oficial por declarar `source: "riot"`, una revisión o un manifiesto coincidente. `server-only` evita importación cliente accidental; no es autenticación. No exponer la función a peticiones públicas ni reutilizar el resultado como contexto confiable B.1.

## Formato de entrada

Formato `1.2.B.2.B-evidence-v1`; canonicalización `1.2.B.2.B-canonical-json-v1`.

- Cabecera: `version`, `identity {playerId, platform, queue, season}`, `scope {view, platform, season {id,startAt,endAt}, asOf}`, atribución, revisión declarada, manifiesto y cobertura observacional existente.
- Discriminante `kind: ranked`, `code: resurrection`: snapshots completos con ID, cola, timestamp, tier/división, LP y contadores V/D.
- Discriminante `kind: matches`, `code: unstoppable | otp-specialist`: partidas completas con ID, queueId, timestamp, resultado, remake y campeón; los tres últimos conservan null.
- Cada fuente incluye su propia identidad y captura. Sus ámbitos deben coincidir con la cabecera. IDs de partida requieren prefijo exacto de plataforma y sufijo numérico; es una validación local de forma, no prueba de existencia.
- Captura legacy: `{state: "legacy", source: "stored", endpoint: "unknown", captureId: null, receivedAt: null}`. Captura declarada admite `LEAGUE-V4`, `MATCH-V5` o unknown, coherente con el tipo de registro cuando está declarado.

No se aceptan PUUID, tokens, URLs, payloads completos, atributos de interpolación, porcentajes de cobertura ni autorizaciones. No se rellenan campos ausentes. Una entrada inválida se rechaza sin devolverla ni imprimir valores/errores del parser.

## Canonicalización y huellas

1. Validación antes de serializar. Se rechazan fechas imposibles/sin zona horaria y precisión superior a milisegundos para evitar truncación silenciosa. Los valores negativos ranked y enteros inseguros se rechazan. Unranked se conserva como barrera, con división vacía y valores cero; no es un dato ranked positivo.
2. Ventana **local** semiabierta `[season.startAt, min(asOf, season.endAt))`; season.endAt null conserva fin desconocido. Una fuente fuera de ventana se rechaza, no se filtra para obtener un resultado favorable. No se afirma que esta ventana equivalga a los filtros de Riot.
3. Instantes representados en UTC ISO con milisegundos. Se conservan por ID los timestamps originales y la ventana original en metadatos. LP y contadores no se interpolan ni modifican.
4. Duplicados de ID con idéntico contenido normalizado se colapsan; capturas distintas y representaciones originales del timestamp se conservan como conjuntos. Contenido contradictorio devuelve `contradictory`, sin elegir una fila ni producir una huella válida. IDs repetidos idénticos del manifiesto también se colapsan.
5. Registros en orden ascendente `(timestamp, ID ordinal)`. Empates temporales permanecen ambiguos; el desempate no prueba orden de juego. Manifiesto e IDs de metadatos se ordenan ordinalmente. Campeones se ordenan numéricamente. No se usa localeCompare.
6. JSON sin espacios, claves de objetos ordenadas ordinalmente, arrays en su orden canónico, UTF-8, null/false distintos. Solo formas finitas validadas; no un serializador público de objetos arbitrarios. No se modifica texto/IDs ni se normaliza Unicode silenciosamente.
7. `contentFingerprint`: SHA-256 hexadecimal del contenido completo con ambas versiones, identidad, ventana, código, versión del evaluador, manifiesto, cobertura declarada y todas las fuentes. No incluye capturas, revisión o atribución.
8. `metadataFingerprint`: SHA-256 de metadatos versionados, incluida su referencia a contentFingerprint, capturas, revisión/atribución y formatos temporales originales. Ninguna huella se incluye en el objeto que se hashea a sí mismo. Cambiar revisión/captura puede cambiar metadataFingerprint sin cambiar contentFingerprint.

Las huellas detectan diferencias de contenido, **no** autentican Riot, completitud o vigencia. El resultado es un valor en memoria; quien lo modifique deberá rematerializarlo. No se devuelve un DTO truncado ni se guarda evidencia en esta fase. Un cambio de estas reglas requerirá nueva versión y nuevas pruebas, sin recalcular evidencia histórica silenciosamente.

## Estados, razones y preparación por señal

- `invalid_input`: estructura, fechas, ámbito/identidad/plataforma/cola o endpoint incoherentes; sin contenido/huellas/observación.
- `contradictory`: duplicados de fuente con contenido distinto; sin huella/observación.
- `incomplete`: manifiesto ausente/discrepante, timestamps ambiguos, campos de partidas desconocidos, histórico no completed, detalles indisponibles/desconocidos o muestra limitada de perfil. Preserva todos los datos y puede conservar una observación positiva **limitada a la muestra**.
- `materialized`: el conjunto suministrado coincide con el manifiesto declarado y no tiene las incompletitudes detectadas anteriores. **No** significa evidencia oficial completa ni verificación/grant listo.

Razones son códigos estables, deduplicados y ordenados. Todos los resultados válidos incluyen bloqueos por autenticación ausente, revisión no verificada y cobertura no demostrada. La observación se conserva sin convertirla en permiso. El módulo no ejecuta el dry-run B.1.

**R1:** recalcula el criterio actual sobre todo el conjunto ordenado. La evidencia observada conserva A/B/C y todos los snapshots intermedios del segmento elegido por el motor; también se mantienen fuentes fuera del segmento en content. Si un ID intermedio del manifiesto falta, se marca incomplete. No se pueden detectar observaciones omitidas tanto del conjunto como del manifiesto; la procedencia/cobertura sigue no demostrada. Unranked, discontinuidades y contadores mantienen las barreras del motor; no hay LP reconstruido desde partidas.

**I1:** ordena todas las partidas, retiene resultados, remakes y desconocidos; reutiliza las reglas de racha. Cinco victorias y backfill completed no crean reconciliación. El conjunto íntegro permite reproducir una racha sin depender de límites de la UI.

**OTP:** `matchSummary` conserva IDs válidos, N exacto, distribución C por campeón, exclusiones por remake declarado true y campos desconocidos por ID. N coincide con la muestra válida del evaluador: remake false, resultado y campeón conocidos. Remake true se conserva en content y se excluye con motivo explícito; null nunca se transforma en false. La evidencia del motor conserva campeón dominante, C/N y comparación racional; no se redondea antes de evaluar. N no se llama total de temporada. Un fin de temporada de fixture o estado completed no establece cierre histórico.

## Investigación pública Riot

Consulta sin login, API keys ni ejecución de endpoints, **2026-10-11**. La referencia dinámica se leyó en el navegador; el extractor textual no mostraba sus operaciones. No se cambió la ingesta.

### Explícitamente documentado

En [MATCH-V5 / IDs](https://developer.riotgames.com/apis#match-v5/GET_getMatchIdsByPUUID): startTime/endTime usan epoch en segundos; start es índice, predeterminado 0; count predeterminado 20, rango 0–100. queue y type se aplican conjuntamente. type enumera ranked/normal/tourney/tutorial. startTime excluye partidas anteriores al comienzo de almacenamiento de timestamps, 2021-06-16. En [detalle](https://developer.riotgames.com/apis#match-v5/GET_getMatch) se distinguen creación, inicio y fin de partida; gameDuration tiene semántica dependiente del parche. gameEndedInEarlySurrender es booleano; su descripción visible corresponde aparentemente a otro campo de challenges, no aclara remakes.

El [portal / response codes](https://developer.riotgames.com/docs/portal#response-codes) documenta errores por estado HTTP: solo 200 garantiza cuerpo JSON; otros cuerpos pueden faltar/cambiar. 404 no establece permanencia. 429 exige esperar Retry-After en segundos. 500/503 son errores del servidor. La referencia MATCH-V5 también enumera 400/401/403/404/405/415/429 y 500/502/503/504. No interpretar un error como una lista vacía certificada.

En el [issue oficial #818](https://github.com/RiotGames/developer-relations/issues/818), el comentario de `tisbells` (contributor, 2024-04-29) relaciona gameEndedInEarlySurrender con remakes y reconoce el nombre confuso. Es una aclaración histórica del repositorio oficial, no prueba de la presencia/coherencia actual del marcador en cada detalle. Los ejemplos y duraciones publicados por otros usuarios no se convierten en garantías.

### No confirmado / validación futura

La referencia de IDs consultada no especifica inequívocamente inclusividad/exclusividad de ambos límites, cuál de creación/inicio/fin usa el filtro, orden garantizado, estabilidad de offsets entre páginas, retención exhaustiva ni plazo de indexación tardía. **Conclusión de esta inspección**, no afirmación de que Riot no lo defina en ninguna otra fuente. El materializador no hace suposiciones sobre esos aspectos.

Pendiente: contrastar aclaración vigente del proveedor y, con autorización separada, usar fixtures y pruebas operacionales acotadas de fronteras/índice/remakes. No adoptar un umbral de duración ni interpretar ausencia del marcador como false en esta capa. La clasificación existente de ingesta no se modifica; un bool almacenado es entrada atribuida, no procedencia del marcador demostrada.

## Pruebas, privacidad y límites

Regresiones de determinismo, ámbito/huella, orden/offsets, duplicados, desconocidos, estructura estricta, fechas/fronteras, legacy, reclamos Riot/revisión, segmento R1 incompleto, OTP parcial, cinco victorias sin recibo, equivalencia con motores y conjuntos mayores que límites visuales. Pruebas de aislamiento verifican ausencia de imports del módulo en caminos operacionales. Son tests puros, **no** pruebas de autenticación real, MVCC ni compare transaccional; suites PostgreSQL opt-in omitidas no cuentan como aprobadas.

No hay nuevo almacenamiento ni duplicación de PUUID. Los IDs internos y manifiestos siguen siendo evidencia personal: no publicarlos ni incluirlos en logs. D13 se mantiene pendiente para persistencia futura: la eliminación del jugador debe eliminar su evidencia personal; no se define una retención adicional.

El costo es lineal para validación/agrupación más ordenamiento O(n log n), memoria proporcional al conjunto íntegro y serialización para huellas. La evaluación R1 conserva su complejidad existente, sin nueva optimización. No hay truncación que mejore el resultado; límites operacionales de tamaño/abuso deben definirse antes de conectar fuentes. Esto no estima latencia de Neon.

## Requisitos antes de B.2.C

1. Autorizar separadamente integración operacional y precisar semántica temporal/remakes pendiente; no comenzar por activar grants.
2. Constructor de servidor basado en fuentes recibidas/controladas e identidad autenticada, con capturas reales y tratamiento legacy sin relleno retroactivo.
3. Revisión monotónica de todos los escritores relevantes y comparación transaccional, con pruebas PostgreSQL de dos conexiones reales; una revisión declarada o SHA no reemplaza ese protocolo.
4. Recibos versionados de reconciliación por intervalo/cola, IDs y detalles completos, desconocidos/errores conservados; no deducirlos de completed ni de este manifiesto.
5. Calendario regional y cierre reconciliado OTP, autorización versionada, D13/D18, permisos y retención definidos antes de persistir/conceder.
6. Adaptación explícita y revisada a B.1 o contrato operacional nuevo. No elevar este resultado automáticamente a `provenance.known` ni `sourceRevision.known`.

Esta fase termina con código puro y commit local. No requiere schema, migraciones, llamadas Riot, Neon, flags ni deployment. **B.2.C no se inició.**

## Validación local de esta implementación

Node **24.19.0**, disponible en el runtime local; se seleccionó únicamente para estos procesos, sin modificar PATH global ni archivos de entorno. `npm run lint` y `npm run typecheck`: correctos. Suite completa `npm run test -- --maxWorkers=2 --hookTimeout=60000 --reporter=verbose`: **962 aprobadas, 10 omitidas**, 51 archivos aprobados y dos suites omitidas. **56 casos nuevos** del materializador. Las omisiones son seis pruebas opt-in de sesiones PostgreSQL de logros y cuatro del lease; no constituyen pruebas de concurrencia superadas. PGlite y las regresiones anteriores se ejecutaron sin modificar sus tests.

`npm run build`: correcto mediante el harness existente `node scripts/validate-production-demo.mjs`, que construye una copia local aislada sin `.env*` ni secretos, con guardia de conexiones PostgreSQL/Riot autenticado. Smoke HTTP de Demo: `PRODUCTION_DEMO_PASS`. No se construyó usando credenciales del checkout ni se modificó su configuración. Aparecen avisos de React sobre claves de listas en el render opcional de perfil de QA existente; esos componentes/tests no se modificaron y no se ocultaron los avisos.

Revisión final: solo cuatro archivos nuevos de materialización, tests y esta documentación; no cambios en contratos B.1, motores, esquema, migraciones o consumidores operacionales. Archivos protegidos comprobados por SHA-256 sin cambios durante la tarea. La única interacción remota de Git fue fetch; consultas públicas de documentación Riot sin claves. Cero operaciones de producto/remotas de escritura, cero conexiones Neon o peticiones Riot operacionales, cero grants.
