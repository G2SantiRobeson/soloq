# 1.2.B.2.F — Concurrencia PostgreSQL local

Fecha: 12 de octubre de 2026. Rama `staging`; HEAD inicial
`4453addaa1e4804168a957cdceabd59f08a130a1`. Referencia local `origin/staging`
`726daaf58372324e2b01a41cce9f6a86401c6f29`: 12 commits por delante y cero por
detrás. Sin fetch ni consulta remota. Cambios ajenos iniciales: `CLAUDE.md` y
`.claude/`; `.env.local` ignorado. Los tres se preservan.

## Entorno y reproducción segura

Node **24.19.0**, PostgreSQL **17.11** de la imagen Docker local existente
`postgres:17-alpine`, Docker Engine **29.6.2**, postgres-js **3.4.9** y Drizzle
**0.45.3**. No se instaló ni descargó software. No se utiliza PGlite para demostrar
esta matriz; la suite anterior PGlite se conserva como regresión independiente.

Ejecutar con Node 24.19.0:

```sh
node scripts/validate-evidence-postgres.mjs --focused
node scripts/validate-evidence-postgres.mjs
```

El segundo comando repite primero la matriz y ejecuta secuencialmente lint,
typecheck, suite completa con dos workers/hookTimeout 60 s y el harness aislado
de build/smoke Demo. No modifica los timeouts normales de tests.

El harness crea **su propio** contenedor `soloq-evidence-f-<UUID>`, con `--pull=never`,
`--rm`, datos tmpfs y puerto aleatorio publicado **solo en 127.0.0.1**. No utiliza
ni detiene el contenedor ajeno `soloq-postgres`. El usuario `postgres` es exclusivamente
de tests, sin contraseña, con trust dentro de ese contenedor descartable. No es una
configuración recomendada para ningún servicio persistente.

Antes de DDL crea `soloq_concurrency_test` y `soloq_progress_test`, comprueba cero
tablas public, usuario/base/versiones y tres `pg_backend_pid()` distintos por base.
Ejemplo del ciclo final: puerto **53535**, PIDs **88/87/89** y **91/90/92** respectivamente;
las tres conexiones posteriores de la matriz fueron **98/99/100**. Los IDs/puertos
cambian en cada ejecución y no constituyen una credencial.

Se ejecuta el **script existente `scripts/migrate.ts`**, sin modificarlo, desde una
carpeta nueva que solo contiene copia del historial `drizzle`. No hay `.env` ni
`.env.local` allí; DATABASE_URL del subproceso es explícitamente loopback hacia la
base nueva. Su loader dotenv informa cero variables inyectadas. La matriz coteja
las **nueve huellas y timestamps reales** de `drizzle.__drizzle_migrations` con el
journal. Verifica bigint, RLS de las nueve tablas, cascadas y CHECK actualizados
por 0008. No cambia/regenera ninguna migración 0000–0008.

Las dos suites opt-in anteriores usan el mismo migrador Drizzle instalado en su
setup en lugar de ejecutar archivos SQL sueltos, sin cambiar sus expectativas:
seis tests de lecturas coherentes y cuatro de lease. La primera crea además una
base nueva `achievements_test_<UUID>` y la elimina al terminar. Configuración
explícita: `ACHIEVEMENT_LOCAL_PG_URL` sin contraseña, host 127.0.0.1 y base control
postgres; los otros tests usan archivos temporales con solo el puerto. Sin esa
configuración los tests de PostgreSQL permanecen opt-in: no sustituyen el motor
por mocks ni acceden a DATABASE_URL operacional.

El entorno de los hijos se restringe a variables del sistema necesarias; no hereda
credenciales, flags ni URLs operacionales. La matriz prohíbe fetch externo; receptores
usan únicamente transporte inyectado ficticio. La limpieza retira solo configuraciones,
carpeta y contenedor creados por esta ejecución, tanto ante PASS como ante fallo.

## Matriz ejecutada

Tres pools con **max:1**, cada uno con PID distinto. A/B ejercitan transacciones;
C observa `pg_blocking_pids` y confirma datos finales. Barreras explícitas liberan
los actores solo tras observar locks; los pequeños intervalos de polling no son
criterio de éxito. `statement_timeout=8s` y `lock_timeout=6s` son límites locales
de seguridad, no ampliaciones de timeout para ocultar errores. Los actores no
realizan red dentro de transacciones.

| Grupo | Casos y garantía observada | Resultado focalizado |
| --- | --- | --- |
| Migraciones | Cadena 0000–0008, journal real, bigint NOT NULL, nueve tablas RLS, FKs CASCADE y CHECK 0008. | PASS real |
| A — mismo dueño | Writer esperando al dueño bloqueado; dos cambios producen R=2 sin lost update; retry D recupera cabecera idéntica sin sumar; rollback fuente/participación/R. | PASS real |
| B — compartidos | Asociación→clasificación y clasificación→asociación bajo lock de match; R coherente de ambos; rollback de fanout; FK entre dueños rechazada con 23503 sin mutación. | PASS real |
| C — captura/cursor | Página/pending y cursor/R atómicos; respuesta perdida recuperada con mismo handle; otra recepción añade evento; rollback y retry seguro; lease tomado por otro impide captura antigua; disposición resuelta con fuente/cursor atómicos; checkpoint confirma con R o revierte junto con él. | PASS real |
| D — sellado local | REPEATABLE READ READ ONLY conserva contexto/R/unidades anteriores aunque otra sesión confirme nuevas unidades; sello obsoleto rechaza tras lock; recibo previo/hash/referencias reproducibles e inmutables. | PASS real |
| E — DELETE | SW/renovación bloquean adquisición administrativa; takeover tras expiración; finalizador y writer antiguos rechazados; latest/previous redactados; captura pendiente no resucita dueño; asociación esperando DELETE revierte; remake compartido conserva evidencia/checkpoints de otro dueño; sin huérfanos ni referencias personales restauradas por run posterior. | PASS real |
| F — locks/conflictos | Helper multi-owner ordenado serializa inputs invertidos. Inversión deliberada fuera del protocolo provoca 40P01, un solo victim y rollback completo. Updater obsoleto REPEATABLE READ provoca 40001 sin lost update. | PASS real |
| G — writer antiguo | UPDATE privilegiado directo cambia contexto sin R; el estado local no puede descubrirlo. Recibo permanece no certificado y grantAuthorized=false; no existen tablas de grants. | PASS real de la limitación |
| Opt-in anteriores | Cuatro intercalaciones MVCC, rollback SQL/read recovery, READ ONLY efectivo; adquisición concurrente, fila lease bloqueada, expiración con rollback y fencing de worker anterior. | 10 PASS reales |

En clasificación→asociación el segundo jugador aún no estaba asociado durante el
fanout: recibe R por su posterior asociación **a la fuente ya clasificada**, no por
una clasificación previa atribuida retroactivamente. Ningún caso convierte snapshots
o MATCH en LP inventado ni cambia R1/I1/OTP.

La inversión deliberada toma A→B y B→A mediante SQL/llamadores privilegiados que
omiten la adquisición agrupada ordenada y el lease compartido. Se observa la espera
antes de cerrar el ciclo, se acepta exactamente una transacción y se registra
SQLSTATE **40P01** del victim, sin retry automático. No se oculta el error ni se
deduce un defecto operacional a partir de un escritor que viola el protocolo.
No se demuestra ausencia universal de deadlocks. El caso **40001** muestra la
necesidad de rechazar/repreparar una fotografía obsoleta, no de forzar su commit.

## Cambios y defectos

No se ha demostrado un defecto de runtime D/E que exija cambiar locks, leases,
fuentes, cursores o sincronización. La única adaptación del módulo D es **de tipos**:
la factoría privada acepta `PgDatabase<T, schema>` en vez de PGlite exclusivamente,
manteniendo el tipo de resultados del driver y el puerto común de builders. No hay
casts entre drivers, conexión nueva, llamada operacional, cambio SQL ni autorización.

Fallos de preparación corregidos únicamente en tests/harness: URI del loader Windows
necesita file URL; readiness debe consultar TCP y no el servidor Unix provisional;
tipos numéricos de timeouts y parámetros del test; fixture JSON utiliza el mapper
Drizzle en vez de mezclar serializadores postgres-js. No se cambiaron expectativas
anteriores, no se añadieron retries de tests ni se suavizaron SQLSTATE.

## Validación integral

Focalizada final: **36 aprobadas, cero omitidas/fallidas**, tres archivos, **4,42 s**;
incluye **26 casos nuevos** y los **10 opt-in** anteriormente omitidos.

| Comando secuencial, Node 24.19.0 | Resultado final |
| --- | --- |
| PostgreSQL focalizado | 36 PASS, 0 FAIL, 0 omitidas. |
| `npm run lint` | PASS, código 0. |
| `npm run typecheck` | PASS, código 0. |
| `npm run test -- --maxWorkers=2 --hookTimeout=60000` | **1.405 PASS**, **0 FAIL**, **0 omitidas**, 62 archivos; **119,16 s**. Incluye PostgreSQL real, PGlite y todas las regresiones anteriores. |
| `node scripts/validate-production-demo.mjs` | **PRODUCTION_DEMO_PASS**, código 0. `npm run build` aislado: compilación **17,1 s**, TypeScript **7,7 s** y siete páginas estáticas; **40 comprobaciones HTTP** de SoloQ/Flex/5v5, métricas, perfiles y bloqueos operacionales. |

La primera secuencia final se detuvo correctamente en typecheck por `pendingReason`
en un evento nuevo de test; el campo existente es `reason`. Solo se corrigió el
fixture, y se repitió toda la secuencia sin alterar el contrato. En los tests
visuales existentes se emitieron advertencias React de claves de lista; no se
modificó UI para silenciarlas. Los NOTICE de cascadas (00000) y logs sanitizados
de fallos intencionados no son fallos de validación. No se omitieron tests.

El harness cerró conexiones y eliminó su contenedor/configuraciones/carpeta al
terminar. Logs locales ignorados en `artifacts`, sin dumps de datos reales y fuera
del commit. Se cotejan nuevamente los hashes de los archivos protegidos y la
ausencia de cambios en schema/migraciones, sincronización y reglas antes del commit.

## Límites y publicación futura

- SQL privilegiado/otro deployment puede omitir R, incluso producir un estado
  `local_revision_unchanged` incorrecto como indicador de fuentes. No hay trigger
  universal ni autenticación criptográfica de la revisión. Drenar writers antiguos,
  inventariar todos los productores y controlar permisos antes de consumo probatorio.
- D sigue desconectado de verificación operacional y grants; recibos sintéticos
  no se adaptan a B.1 como Riot. `certification=not_established`, `grantAuthorized=false`
  y `provenanceAuthentication=not_performed` permanecen. No se creó un concedente.
- RLS activa/cascadas en PostgreSQL local no acreditan permisos de Neon, roles propietarios
  o BYPASSRLS, autenticación privada D18, eliminación de logs/respaldos ni retención.
- Reglas futuras/versiones de run_progress deben revisar parser del lease y D13 juntos:
  la adquisición previa puede proyectar formatos desconocidos; F solo prueba v1 actual.
- Sin mediciones de Neon: latencia, pooler, WAL, conexiones, lock waits, memoria,
  límites/capacidad por owner y retención siguen pendientes. No se infiere rendimiento
  de Production ni disponibilidad del proveedor por estas pruebas locales.
- Cierres regionales, reconciliación real de índices/intervalos, procedencia operativa,
  D06/D17/D18 y parámetros de producto siguen sujetos a aprobación independiente.
- Aplicación de 0007/0008 en Neon staging necesita preflight inequívoco, respaldo Ready,
  writers compatibles detenidos y autorización separada. Código dependiente después
  de la migración revisada. Rollback de código conserva DDL/journal; no DROP remoto.
- Publicación, QA Preview, captura real acotada y eventual consumo probatorio son
  operaciones futuras separadas. **F no hace push, deployment, grants, acceso Neon,
  llamadas Riot operacionales ni cambios en main/Production.** El smoke Demo permite
  assets públicos Data Dragon y loopback; no se afirma cero tráfico de assets públicos.
