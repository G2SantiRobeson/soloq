# 1.2.B.2.G.1 — Capacidad de evidencia

Fecha: 12 de octubre de 2026. Rama `staging`; base local
`14ffd920cb04a99225260ceb0827b5d779d170ac`. Referencia local, sin fetch:
`origin/staging=726daaf58372324e2b01a41cce9f6a86401c6f29`, 13 commits por
delante y cero por detrás al iniciar. Solo `CLAUDE.md` y `.claude/` eran cambios
ajenos; se preservan junto con `.env.local` ignorado. No hay autorización de
publicación, captura remota, consumo probatorio, reconciliación ni grants.

## Diagnóstico comprobado

Inspeccionados D/E/F, schema y SQL 0007/0008, cliente privado, escritores InTx,
revisión, readers, sellado, DELETE y pruebas. Conteos por owner, con dos ámbitos
ranked incluso cuando LEAGUE solo devuelve una cola:

| Operación | Antes: headers / units | Después: headers / units nuevos |
| --- | --- | --- |
| Alta confirmada ACCOUNT | 2 / 2; SUMMONER no añade evidencia propia | Hasta 2 / 2, contenedores ACCOUNT separados de IDENTITY |
| Verificación IDENTITY | 2 / 2 por petición | 0 tras abrir 2 compatibles / 2 por petición |
| Verificación LEAGUE ligada a identidad | 2 / 2, haya o no snapshot nuevo | 0 tras abrir 2 compatibles / 4: dos eventos más dos referencias exactas |
| LEAGUE sin identidad confirmada | 2 / 2 | Hasta 2 iniciales, separados de los ligados / 2; sin referencia inventada |
| Apertura recent/history/repair | 2 / 0; continuación compatible 0 / 0 | Sin cambio |
| Página de N IDs distintos | 0 / 2 × (1 + N), incluidos eventos pending | Sin cambio; duplicados de IDs conservados en página |
| Detalle o reutilización de un ID | 0 / 2 disposiciones | Sin cambio; IDs reutilizados pueden insertarse por lote |
| Reclasificación remake | 2 / 2 por owner asociado y petición | Sin cambio; no se fusiona con un scan |

Finalizar un scan modifica su lifecycle observacional, sin crear otra cabecera.
Una ventana nueva abre dos raíces; no se mezcla con una anterior incompatible.
El alta puede ser seguida por otra sincronización, cuyo costo se suma por separado.
No todo error previo al INSERT de un jugador tiene un owner confirmado: no se crea
un jugador/ledger ficticio para representarlo.

Antes, solo identidad+rango llenaban 1.000 headers a las 250 verificaciones;
con dos ACCOUNT iniciales, la 250.ª verificación completa ya no cabe. Bajo política
A un rechazo de cupo revierte fuentes/evidencia/cursor/R/checkpoint, por lo que ese
crecimiento puede impedir progreso. No se ha observado ese agotamiento en Neon:
es una consecuencia del código y cupos, no un diagnóstico operacional remoto.

## Modelo y alternativas

Se elige **contenedor nuevo explícitamente versionado**, no reutilizar cabeceras
E.2.3 que describen un evento individual. `ranked-event-store.ts`, privado y
`server-only`, almacena el formato `1.2.B.2.G.1-ranked-reception-stream-v1`.
La versión original del record y de su normalización permanece E.2.3 v1.

La metadata inmutable del contenedor declara `immutable_reception_units`,
`append_only`, kind, endpoint, versión de record/normalización, source y parent.
No representa una recepción, fecha de cobertura, último resultado o certificación.
`created_at` sigue siendo almacenamiento. Intervalos, revisiones de sello y huella
de cabecera permanecen NULL. La clave opaca determinista SHA-256 incluye owner,
plataforma, cola, temporada y toda esa metadata. La unicidad owner/operation_key
existente sirve para recuperarlo, sin columna/índice/tabla nuevos.

Se separan ACCOUNT/IDENTITY/LEAGUE, temporadas, versiones, fuentes y parents.
Unknown, synthetic y server_riot_received nunca comparten contenedor. Un error,
ausencia, mismatch o ambigüedad es otra observación, no razón para borrar o elegir
otra favorable. Un contrato/lifecycle corrupto o desconocido bloquea el camino;
no se adopta como formato compatible. No hay rotación automática al llegar al cupo.

Alternativas descartadas: subir límites (desplaza el fallo), deduplicar respuestas
iguales (pierde recepciones), sobrescribir el último evento (pierde trazabilidad),
fusionar retroactivamente cabeceras (cambia metadata inmutable/FKs), purgar por TTL
(retención no aprobada), nuevas tablas/índices (fuera del alcance). No se requiere
migración para el modelo elegido.

## Eventos, identidad y ranked

Cada recepción mantiene **el JSON del evento original y su SHA-256**, captureId de
proyección, requestId, todos los receptionIds/intentos y fechas recibidas/validadas,
source/confianza original, entradas completas permitidas de su cola, presencia,
ambigüedad, identidad y snapshot real. No se redondea, inventa LP o cambia timestamps.
Unit conserva owner/scope, R destino, ordinal y fingerprint. La clave `event:<requestId>`
se repite solo en ámbitos distintos; retry idéntico recupera exactamente la unidad.
Respuesta idéntica de una petición nueva mantiene otro evento y otra R al confirmar.

Identidad usa disposition. Ranked conserva snapshot cuando se insertó uno nuevo,
disposition cuando no; los enlaces y su contenido siguen cotejándose con la fila
real. El parent de ranked apunta al contenedor de identidad correspondiente, y una
unidad **reference** adicional apunta mediante la FK compuesta existente a la
unidad exacta de identidad de esa verificación. Contiene también el ID del evento
ranked; el reader valida que existe en ese mismo contenedor. No se usa el parent
compartido como prueba de que cualquier identidad anterior sirve para LEAGUE.

La restricción SQL actual prohíbe reference_unit_id en snapshot/disposition. Por
eso la referencia es otra unidad, con su propio hash, mismo R y ordinal siguiente.
No se elude el CHECK ni se convierte snapshot en reference. Parent y referencia
mantienen owner/plataforma/cola/temporada y CASCADE. No hay referencias entre owners.
La recepción de identidad se revalida con su handle privado original y record exacto,
incluido cuando comparte contenedor con otras. Reutilizar LEAGUE con otra identidad
es conflicto, aunque ambos resultados sean true y el parent contenedor sea igual.

## Compatibilidad y frontera de lectura

Las cabeceras y unidades antiguas quedan byte a byte sin UPDATE ni backfill.
Lookup busca primero la clave antigua y la unidad nueva, bajo owner lock, antes de
insertar. Retry antiguo conserva su ID, contenido, parent y revisión. Representar
la misma petición en ambos formatos es conflicto; no se cuenta dos veces.

`projectRankedEvents` es un reader **privado, puro**, sobre filas materializadas
con sus padres/referencias incluidos. Admite antiguo, nuevo y mixto; verifica scope,
formato/hash, ordinal/revisión causal, referencia y duplicados. Conserva todos los
eventos contradictorios; no elige el mejor/último como certificación. Requiere el
conjunto completo de unidades de cada contenedor suministrado; una página parcial
no debe presentarse como una lectura completa. Ordena determinísticamente por R,
kind, header y ordinal. Entre contenedores en una misma R no afirma orden temporal
total: la FK de identidad aporta el vínculo causal preciso.

No añade llamadas desde perfiles/endpoints ni conecta un consumidor de grants.
El repositorio local D conserva su contrato/reader/sellado sintético v1; no consume
estos formatos como si fueran D, ni los adapta automáticamente a B.1/B/C. Sus
pruebas de sello, reproducción, R/R+1 y datos posteriores siguen exigidas. Un futuro
reader operacional tendrá que cargar ámbitos/revisiones explícitos y diseñar su
materialización/reconciliación por separado. Una cabecera de versión D se distingue
y no se adopta como stream; una versión operacional desconocida se rechaza.

## Atomicidad y costos SQL

Misma syncWrite/lease/fencing, mismo orden lease → match cuando corresponda → owners
ordenados → headers → units. No otra conexión, transaction, savepoint, lease o red
bajo locks. Owner lock serializa búsqueda/reutilización y ordinals; header existente
se protege con FOR UPDATE antes de append. Nuevas filas están protegidas por el
INSERT de esa transacción. SQL obtiene `(source_revision + 1)::text`; el port devuelve
si insertó evidencia, y el caller marca cambio solo entonces. Flush original suma
una sola R por jugador/tx, incluyendo identidad/rango/fuentes/cursor/checkpoint.

No hay retry automático ni conflict-do-nothing que oculte diferencias. Un fallo de
cupo, contenido, SQL, overflow o fencing revierte la misma unidad completa. El
append no mantiene un cursor nuevo. La idempotencia transversal entre contenedores
se comprueba en la aplicación bajo owner lock; writers SQL privilegiados que omitan
ese protocolo siguen fuera de la garantía, como demostró F.

SQL adicional por evento respecto del escritor E.2.3 inspeccionado: primera apertura
+3 consultas (lookup del segundo formato, lookup de contenedor y ordinal), tanto
identidad como ranked. Una vez abierto, -3 consultas (dos agregados de alta y un
INSERT de header) compensan esas tres. Resolver el parent exacto necesita dos
consultas en vez de una: **+2 por verificación completa estable de dos colas**.
Retry puro: +8 consultas por verificación completa, por validación de ambas formas,
referencias y parent; no aumenta R/unidades. Son conteos del flujo de código, no
latencia ni planes Neon. Las referencias se insertan en el mismo INSERT del evento.

El fixture de medición registra **58 consultas de apertura y 46 con contenedores ya
abiertos** en su helper (incluye lectura de identidad, lock del owner y flush de R;
el logger no cuenta BEGIN/COMMIT del driver, transporte o fencing, y no es un trace
de syncPlayer completo). Los agregados de cupos y lookup transversal siguen
dependiendo de filas acumuladas. Hay índices existentes por owner/operation_key,
header/unit_key y header/ordinal; no se promete lookup global constante ni menor
latencia. El reader usa mapas, valida cada unidad y ordena; no añade proyección
cuadrática. Duración SQL, WAL, índices, MVCC, conexiones y locks Neon no medidos.

## Medición sintética y límites restantes

Fixture reproducible en `tests/evidence-capacity.test.ts`: 100 verificaciones, dos
colas, una entrada SoloQ Diamond I/49 LP y ausencia Flex, identidad true, snapshots
no insertados, recepciones ficticias de tamaño fijo. UUIDs distintos y de igual
longitud; tiempos explícitos de fixture. Reporte agregado ignorado
`artifacts/g1-capacity.json`; sin datos reales. Modelo anterior contrafactual:
duplicación de cada JSON de evento en header+unit. No se intenta superar su cupo.

| Medida | Anterior, 100 | Nuevo, 100 | Anterior, 1.000 (proyección) | Nuevo, 1.000 (proyección) |
| --- | ---: | ---: | ---: | ---: |
| Headers | 400 | 4 | 4.000, no admisibles | 4 |
| Units | 400 | 600 | 4.000 | 6.000 |
| JSON UTF-8 compacto | 677.200 B | 390.552 B | 6.772.000 B | 3.891.552 B |

Reducción de headers: **99 % / 99,9 %** en esos tamaños. Units: **+50 %**, por
referencias explícitas. Reducción JSON compacto a 100: aproximadamente **42,33 %**;
no es tamaño físico de la base. JSONB de units medido PGlite a 100: **412.700 B**,
mayor por representación con espacios. No incluye filas, claves, UUIDs de columnas,
índices, WAL, bloat, backups ni payloads MATCH. No es benchmark Neon.

Todos los límites permanecen: 1.000 headers/player, 100.000 units/header, 32 MiB
JSON/header, 64 MiB JSON/player, 64 KiB/header, 16 KiB/unit. Nuevas adiciones siguen
reservando 2× bytes compactos; existentes se cuentan como JSONB real. Se corrige
un detalle previo: el agregado por header ahora también usa su tamaño JSONB exacto,
en vez de compactarlo; una regresión prueba la diferencia en el borde.

Escenarios explícitos:

- Solo identidad/ranked como este fixture: antes falla por headers alrededor de
  250 verificaciones. Nuevo conserva cuatro headers; con ~4,1 KiB JSONB de units
  por verificación, 64 MiB/player aparece aproximadamente a **16 mil**. Es extrapolación
  de tamaño constante, no cupo operacional autorizado. La reserva conservadora
  puede rechazar antes. 32 MiB de un contenedor y 100.000 units se evalúan también;
  con esta distribución el total por owner llega antes. Payloads grandes cambian
  qué límite aparece primero; una sola unit puede exceder 16 KiB.
- Verificación + un recent acabado con ventana nueva en cada ciclo: los dos
  headers del scan permanecen. Con cuatro streams, 498 ciclos llenan 1.000, sin
  contar alta/history/remakes. Puede seguir fallando primero por headers.
- Historia que reanuda el mismo intervalo: reutiliza dos scans, pero páginas y
  disposiciones hacen crecer bytes/unidades. Remakes agregan dos headers por
  petición y owner asociado. Datos reales/distribuciones de temporada no medidos.

No se declara resuelto almacenamiento a largo plazo. Retención, cupos operacionales,
rotación/versionado futuros y observabilidad de capacidad necesitan decisiones
separadas. No purga, TTL, compactación de eventos, aumento de cupos ni cuota Riot nueva.

## Pruebas, seguridad y operación futura

PGlite: muchas verificaciones, metadata inmutable, eventos/hashes/fechas/revisiones,
retry tras R posterior, recepción nueva, enlace exacto de identidad, ambas colas,
temporadas/versions/sources, antiguo+nuevo, duplicados/contradicciones, versiones
desconocidas/lifecycle, D13, unidades/JSON/header/player caps y rollback de prefijo.
Los rellenos SQL de límites son exclusivamente fixtures SQL válidos de contabilidad,
no pretendidas recepciones semánticas ni pruebas de procedencia.

Se conservan las 43 regresiones E.2.3: asserts de recepciones leen eventos, no
confunden contenedores físicos con eventos. Se añade la comprobación física de
reutilización y se esperan dos referencias adicionales sin quitar evidencia.
Continuación MATCH, sellos D, R, fencing, snapshots y DELETE se prueban aparte.
La regresión de lectura del perfil en `source-revision.test.ts` cuenta los cuatro
eventos y sus dos referencias; mantiene R y todas las filas de units/headers
idénticas antes/después del reader y perfil, sin ejecutar nuevos consumidores.

PostgreSQL real **solo mediante el harness F**, sin descargas ni bases ajenas:
dos escritores/lease compartido con retry o petición distinta, barrier observada
`pg_blocking_pids`, R/ordinals/ref/FKs, rollback por fencing final en streams ya
abiertos y captura recibida antes de DELETE incapaz de recrear al jugador. No usa
sleeps como prueba de orden. Se ejecutan también las 36 pruebas reales anteriores.

Fuentes `server_riot_received` en tests del port son **literales de fixture**, no
transporte autenticado; no se afirma llamada real. El productor conserva los handles
privados y clasificación original, sin cambiar RiotClient. Todos los JSON conservan
`certification=not_established` y `grantAuthorized=false`. Sin endpoints/payloads
completos, PUUID duplicado, credenciales, grants o atestación nueva.

D13 elimina por CASCADE todos los formatos/colas/temporadas/referencias; conserva
otro owner. Redacción run_progress y sessionStorage siguen intactas. No se accede
ni borra logs/respaldos remotos. RLS no demuestra permisos Neon de un rol propietario.

Validación final ejecutada con Node **24.19.0**, PostgreSQL **17.11** local mediante
el harness F, sin suite/build paralelos:

| Comprobación | Resultado |
| --- | --- |
| PGlite focalizado de capacidad/capturas/sellos/D13 | 189 PASS, cinco archivos, 21,48 s |
| Regresión de fuente/lectura del perfil | 46 PASS, 5,33 s |
| PostgreSQL real focalizado final | **40 PASS**, cero omitidas/fallidas, 5,28 s; incluye cuatro casos nuevos |
| `npm run lint` | PASS, código 0 |
| `npm run typecheck` | PASS, código 0 |
| `npm run test -- --maxWorkers=2 --hookTimeout=60000` | **1.430 PASS**, **0 FAIL**, **0 omitidas**, 63 archivos, **124,79 s** |
| `node scripts/validate-production-demo.mjs` | **PRODUCTION_DEMO_PASS**, build real (compilación 17,6 s, TypeScript 7,4 s, siete páginas) y **40 checks HTTP** |

Son **25 pruebas nuevas** respecto de F: 21 de capacidad y cuatro PostgreSQL. No se
reducen pruebas anteriores ni se elevan timeouts. La primera secuencia integral se
detuvo antes del build: 1.429 PASS y una aserción de inventario en source-revision
que aún esperaba cuatro units. Se corrigió a cuatro eventos más dos referencias,
conservando y ampliando la igualdad de evidencia/R después de leer el perfil. No
se modificó runtime para eludir esa prueba. La secuencia completa siguiente pasó.
Los errores iniciales de preparación de fixtures (sintaxis, scanStart y puerto
tipado del driver) se corrigieron solo en tests; no justificaron cambios de schema,
drivers, límites o timeouts. Warnings React de keys preexistentes y NOTICE 00000
de cascadas locales no se ocultaron ni se corrigieron fuera del alcance.

El harness cerró conexiones y eliminó exclusivamente sus recursos/configuraciones
desechables; no usó el contenedor ajeno `soloq-postgres`. Logs ignorados en artifacts,
sin capturas reales. Hashes de archivos protegidos, schema/migraciones/metadatos y
main se vuelven a comprobar antes del commit local.

Dependencia de staging: 0007/0008 deben existir antes de código que usa esas tablas,
pero aquí no se consulta Neon ni se asume su estado. G.1 **no requiere 0009** y no
modifica schema, SQL, snapshots o journal. Publicación/preflight, rol, backup y una
captura real acotada requieren autorización posterior. Drenar writers antiguos y
coordinar readers privados antes de consumo probatorio; el rollback de código
conserva datos pero un lector anterior no entiende streams nuevos. Nunca DROP o
reescritura de evidencia para ocultar esa incompatibilidad.

Sin push/deployment, Neon, Riot operacional, migraciones remotas/nuevas, grants,
flags, main/Production o cambios LP/Firma/Salones/R1/I1/OTP. Demo build/smoke permite
solo loopback/assets públicos Data Dragon, sin PostgreSQL ni Riot autenticado.
