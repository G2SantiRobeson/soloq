# 1.2.B.2.E.2.M — Soporte SQL local para capturas operacionales

Fecha: **12 de octubre de 2026**. Base `81d617c93e23d8dffe1681a6f0c90e24d03946ab`, rama `staging`. Referencia local `origin/staging`: `726daaf58372324e2b01a41cce9f6a86401c6f29`, ocho commits por delante y cero por detrás al iniciar. No se consultó el remoto. Working tree inicial: solo `CLAUDE.md` modificado y `.claude/` sin seguimiento; ambos y `.env.local` preservados. **No aplicada en Neon, no publicable sin autorización independiente.**

## Cambio exacto y generación

Solo se amplían dos CHECK de `achievement_evidence_headers` y las uniones de sus columnas en Drizzle:

| CHECK | Valores anteriores | Valor añadido |
| --- | --- | --- |
| `evidence_header_kind` | rank_capture, match_scan, structural_receipt | **identity_capture** |
| `evidence_header_source` | unknown, synthetic | **server_riot_received** |

Generación con Node **24.19.0**, Drizzle Kit instalado y parámetros explícitos:

```text
node node_modules/drizzle-kit/bin.cjs generate --dialect=postgresql --schema=./src/db/schema.ts --out=./drizzle --name=operational_capture_support
```

No carga `drizzle.config.ts`, `.env.local` ni credenciales; no necesita conexión DB. El primer intento no inició esbuild por `spawn EPERM` del sandbox; el mismo comando con permiso para subprocesos locales generó SQL/snapshot/journal correctamente. No se fabricaron metadatos ni se modificó el journal manualmente.

SQL exacto de `drizzle/0008_operational_capture_support.sql`:

```sql
ALTER TABLE "achievement_evidence_headers" DROP CONSTRAINT "evidence_header_kind";--> statement-breakpoint
ALTER TABLE "achievement_evidence_headers" DROP CONSTRAINT "evidence_header_source";--> statement-breakpoint
ALTER TABLE "achievement_evidence_headers" ADD CONSTRAINT "evidence_header_kind" CHECK ("achievement_evidence_headers"."kind" IN ('rank_capture', 'match_scan', 'structural_receipt', 'identity_capture'));--> statement-breakpoint
ALTER TABLE "achievement_evidence_headers" ADD CONSTRAINT "evidence_header_source" CHECK ("achievement_evidence_headers"."source" IN ('unknown', 'synthetic', 'server_riot_received'));
```

No DML, backfill, tablas/columnas nuevas, DROP TABLE, ALTER de fuentes operacionales o actualización retroactiva. DROP CONSTRAINT sustituye la restricción del mismo nombre por una ampliada; no elimina datos. El migrador PostgreSQL instalado (`PgDialect.migrate`) ejecuta los statements de las migraciones pendientes y su registro dentro de `session.transaction`. **No ejecutar estas sentencias manualmente o por separado**: el reemplazo necesita una misma transacción, sin intervalo visible de checks ausentes. No se modifica `scripts/migrate.ts` ni se ejecuta su comando aquí.

`0008_snapshot.json` generado: id `3c07c637-b4ce-4dc6-8911-6077cfc44966`, prevId `de319b17-df7f-4fe7-a160-7310612778f9` del snapshot 0007, versión 7/PostgreSQL. Solo difieren las dos expresiones CHECK, además de id/prevId. Journal: nueve entradas, índice 8/tag `0008_operational_capture_support`, timestamp generado mayor que 0007, breakpoints true. El prefijo íntegro 0000–0007 no cambia.

## Semántica, ámbito y frontera de confianza

`server_riot_received` es una **clasificación de almacenamiento** prevista para una recepción atribuida al servidor mediante un futuro productor privado autorizado. PostgreSQL solo admite el texto: no demuestra una petición Riot, identidad concordante, validación, commit de fuentes, reconciliación, cobertura recuperable, cierre estacional, certificación o permiso de grants. Un INSERT ficticio que use el literal tampoco acredita esos niveles.

`identity_capture` es una cabecera collecting independiente de rango/scan. Conserva owner UUID, plataforma, cola ranked y temporada obligatorios. Representa un vínculo declarado **en ese ámbito**, no una identidad universal entre colas o temporadas. Una futura recepción account común podría proyectarse mínimamente por ámbito, con correlación adecuada y sin duplicar PUUID; la estrategia/producer quedan pendientes de E.2.3. No se elige una cola arbitraria para afirmar prueba global ni se crean ámbitos all-queues.

Unknown/synthetic/legacy existentes mantienen exactamente su clasificación y JSON. No asigna captureId/receivedAt ni convierte unknown en server_riot_received. CreatedAt sigue siendo almacenamiento, no recepción. No se cambia ningún formato B.1/B/C/D/E.2.1, factoría, evaluación, perfil, flag o productor. El contrato D solo permite fuentes unknown/synthetic y tipos rank_capture/match_scan en su insert; E.2.1 sigue synthetic/declared, sin recepción/validación/commit reales. Ampliar el tipo de columna Drizzle no amplía esas fronteras Zod ni autoriza nuevos consumidores.

D continúa desconectado de Riot y grants. Los DTO privados existentes preservan certification not_established, grantAuthorized false y procedencia no comprobada. No se adapta D para leer/sellar el JSON de futuras capturas operacionales; no almacenar un formato nuevo y después tratarlo como v1 antiguo.

## Restricciones y privacidad conservadas

- PK/UNIQUE de cabeceras/unidades; owner NOT NULL y FK a players; claves de operación y órdenes únicos.
- FKs compuestas de owner/plataforma/cola/temporada para padres, cabeceras, predecesores y referencias; CASCADE y prohibición de autorreferencias directas.
- CHECK de cola ranked, keys/intervalo, JSON objeto y límites 64 KiB/16 KiB, hashes hexadecimales, revisiones no negativas y reglas de unidades.
- `players.source_revision` bigint NOT NULL/default cero/CHECK no negativo, sumas E.1 sin cambios.
- Sellado solo structural_receipt, parent obligatorio, inputRevision R, sealedAtRevision R+1 y fingerprint; identity_capture no puede declararse sealed para evadir ese protocolo.
- Las mismas nueve tablas, RLS activada en todas, sin policies nuevas; roles ordinarios sin acceso a filas de evidencia bajo la configuración probada localmente. No es inspección de permisos del rol Neon desplegado.

D13 local: borrar owner elimina evidencia y referencias por cascadas; otro dueño conserva sus filas. No crea tombstones o retención adicional. D13 externo —run_progress, logs, sessionStorage, respaldos—, política de retención y D18 siguen pendientes de E.3. No se eliminan checkpoints ni historial para cambiar presentación o privacidad.

## Pruebas y ajustes de inventario

Nuevo `tests/operational-capture-migration.test.ts`, exclusivamente PGlite efímero. Copia temporal de migraciones 0000–0007 y su journal original para ejecutar el **migrador instalado**, crea fixtures ficticias con fuentes legacy y R mayor que Number.MAX_SAFE_INTEGER, y luego migra el directorio completo. La copia se elimina con comprobación del directorio desechable; sin URL/credenciales/servicios remotos.

Comprueba filas idénticas por JSON textual (sin pérdida de bigint), revisión/huellas/campos nullable, registro/hash e idempotencia de migración, SQL exacto, byte-hashes de ocho SQL y ocho snapshots frente a la base Git, prefijo del journal y snapshot exclusivamente ampliado. Prueba rollback local al fallar entre drops y replacements. El uso de transacción en el migrador real también se contrasta con el código instalado; las pruebas no simulan que DDL separado sea seguro.

Casos SQL: fuentes antiguas/nueva y tipos collecting, tipos/orígenes arbitrarios, ámbito no global/cross-queue/season/platform, owner ausente, FKs cruzadas, cascadas y preservación de otro dueño, RLS con filas nuevas visibles para el dueño de tablas antes de SET ROLE, sellos/JSON/hashes/revisiones/unicidad/referencias inválidos. Inserciones usan **fixtures**, no Riot. Las pruebas de confianza confirman que los schemas D/E.2.1 no aceptan la nueva procedencia como confianza operacional.

`achievements-persistence.test.ts` deja de asumir que 0007 es el último archivo: conserva el test incremental concreto de 0007 y sus huellas, después aplica migraciones posteriores para ejecutar **todas las garantías D** con los CHECK nuevos. `sync-progress-migration.test.ts` conserva los prefijos/SQL/snapshots de 0006/0007 y añade prefijo íntegro de ocho entradas, longitud nueve y tag 0008. `database.test.ts` no requiere cambios: siguen nueve tablas y sus pruebas RLS permanecen completas. No se suavizan reglas, timeouts, checks o expectativas de seguridad para aprobar.

Validación secuencial ejecutada con Node **24.19.0**:

| Comando | Resultado |
| --- | --- |
| `npm run lint` | Correcto |
| `npm run typecheck` | Correcto |
| `npm run test -- --maxWorkers=2 --hookTimeout=60000` | **1.260 aprobadas, 10 omitidas, 0 fallidas**; 56 archivos aprobados y 2 omitidos |
| `node scripts/validate-production-demo.mjs` | **PRODUCTION_DEMO_PASS**: `npm run build` real y smoke HTTP en copia local aislada |

Las **33 pruebas nuevas** de 0008 pasan; las 1.227 anteriores se conservan. El build utiliza fixtures Demo, sin `.env` ni cinco secretos operacionales, con guard de red contra PostgreSQL y Riot autenticado. Smoke cubre SoloQ/Flex/5v5, perfiles, métricas season/30d/7d, privacidad/términos, rutas inexistentes y aislamiento de admin/cron. No es un deployment remoto ni valida Neon.

Los SHA-256 de los ocho SQL y ocho snapshots anteriores coinciden byte a byte con la base Git; el prefijo de ocho entradas del journal es idéntico. Los hashes de `CLAUDE.md`, los dos archivos `.claude/` y `.env.local` permanecen iguales al preflight. `git diff --check` de los archivos de tarea pasa; el whitespace protegido preexistente no se corrige.

Las diez omisiones PostgreSQL opt-in no prueban concurrencia real; los tests PGlite no acreditan dos conexiones Neon, latencia, permisos operacionales o ausencia de deadlocks.

## Despliegue, rollback y siguientes permisos

Preparación local no permite aplicar 0007/0008, publicar código, activar producer o ejecutar ingesta. No se asume que Neon tenga esas migraciones. Un futuro preflight autorizado debe confirmar destino staging/backup/migraciones/operaciones activas, y aplicar la cadena pendiente revisada con el migrador antes de código que escriba nuevos literales. Sin 0008 esos INSERT fallarán por CHECK; sin 0007 el schema ya depende de columna/tablas ausentes. Demo público no necesita DB ni ninguna migración.

0008 puede requerir un lock de tabla y validación de filas al reemplazar CHECK: evaluar duración/actividad en staging autorizado, no prometer coste nulo. No amplía presupuestos Riot o fairness. SQL directo/roles privilegiados pueden declarar el literal sin productor: procedencia y política siguen sin demostrar. Consumidores antiguos D no entienden formatos operacionales; futuros escritores y lectores deben versionarse y desplegarse coordinadamente.

Rollback recomendado: retirar/desactivar código nuevo y **conservar DDL ampliado, journal y datos**. No DROP automático, restauración remota o reescritura de migraciones. Reestrechar CHECK después de existir filas nuevas necesitaría diagnóstico, política de datos y una nueva migración revisada/autorizada; no borrar o reclasificar filas para permitirlo. La Demo no se modifica.

E.2.2 requiere autorización separada para productor privado MATCH, timestamps de respuesta reales, port InTx/fencing/idempotencia/capacidad, páginas/captura/fuente/cursor/revisión atómicos y política A. E.2.3 para identidad/LEAGUE/remakes compartidos y concordancia del vínculo; E.3/F para privacidad externa, roles, retención, concurrencia real y costes. La admisión SQL solo resuelve los dos CHECK: **no resuelve esos bloqueadores ni establece cobertura o grants**.

Sin push/deployment, Neon/Riot operacional, migraciones remotas, main/Production, grants/equipamiento, cambios de flags o inicio E.2.2/E.2.3/E.3/F. Se autoriza un único commit local limitado a schema, SQL/snapshot/journal 0008, tests/inventarios y este documento después de validar. Archivos protegidos preservados y fuera del commit.
