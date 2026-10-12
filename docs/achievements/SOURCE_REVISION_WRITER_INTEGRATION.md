# 1.2.B.2.E.1 — Integración local de escritores de source_revision

Fecha: 11 de octubre de 2026. Rama `staging`, base local `8fcc40ee1a3a2f207a335ba99a95f8f12fdb02a0`; referencia local `origin/staging` `726daaf58372324e2b01a41cce9f6a86401c6f29`, cinco commits por delante y cero por detrás. Solo cambios protegidos preexistentes en el preflight: `CLAUDE.md` y `.claude/`; `.env.local` ignorado. No se consultó el remoto ni Neon. Se leyeron instrucciones, diseños de certificación/revisión, auditoría A–C, persistencia local y escritores/tests actuales, y la guía instalada Next.js `use-server` antes de editar.

**Estado: E.1 validada localmente tras la corrección float4; apta para el único commit local autorizado.** La primera ejecución se detuvo ante el fallo descrito abajo; el encargo posterior «Corrección float4 y cierre» autorizó corregirlo y repetir las verificaciones. No autoriza publicación, consumo probatorio, E.2, E.3 ni F.

## Inventario y semántica preparada

Inventario contrastado mediante búsqueda de inserts/updates/deletes en `src/` y `scripts/`. Los wrappers globales, individuales y cron delegan a los escritores siguientes; no requieren un incremento adicional. No se encontró otro escritor operacional de partidas, participaciones, snapshots o identidad/elegibilidad. No se garantiza cobertura de SQL externo, deployments antiguos ni otros repositorios.

| Escritor | Cambios preparados que incrementan R | Exclusiones / límites |
| --- | --- | --- |
| Alta administrativa, `api/admin/players:POST` | Insert nuevo de identidad/plataforma/PUUID/contexto inicial: default cero y suma SQL una vez en la misma transacción. | Cuenta duplicada no incrementa; no captura vinculación Riot. Un fallo posterior no borra el alta confirmada. |
| `syncPlayer`, bloque ranked | Insert de uno o dos snapshots; cambio efectivo de `rankCheckedAt`, que el lector de logros consume. Una suma por transacción. | No crea snapshots por una verificación sin cambio. Nombre, tag e icono son presentación, no contexto del materializador actual. No reconstruye LP. |
| `importRecent`, detalle | Partida/participación nuevas y revisión del dueño de la participación en la misma transacción. | Reutilización idéntica sin suma. El lookup preexistente de participaciones sigue evitando nuevas llamadas; eso no acredita procedencia ni compara una respuesta Riot que nunca se solicitó. |
| `importRecent`, cierre | Cambio efectivo de `lastSyncedAt` (cobertura bajo la política existente). | `lastAttemptAt`, errores y resultado diagnóstico no incrementan por sí solos. Un cierre idéntico no suma por `updatedAt`. |
| `importHistory`, reset | Temporada, estado, contadores, límites y cursor realmente cambiados. | Conserva partidas/snapshots existentes; no crea manifests a partir de completed. |
| `importHistory`, abrir ventana | Cambio de scanEnd/status/startedAt. | Reabrir el mismo cursor congelado sin cambio no suma por backfillUpdatedAt. |
| `importHistory`, página | Cambios de pending/offset/exhausted/discovered. | No conserva nuevas páginas de evidencia: E.2 pendiente. |
| `importHistory`, disposición | Participación si es nueva y contexto de pending/processed/unavailable. Una suma conjunta. | Un ID existente, excluido o 404 puede cambiar contexto aunque no añada participación. No representa reconciliación o procedencia. |
| `importHistory`, cierre | Avance de ventana/cursor, completed/lastBackfillAt cuando corresponden. | No sella recibos ni afirma exhaustividad. |
| `syncBackfillPlayer`, catch | Cambio efectivo de backfillStatus por fracaso/partial. | Repetir el mismo estado failed no suma; errores, intentos y backfillUpdatedAt aislados no suman. |
| PATCH administrativo | Cambio efectivo de enabled. | PATCH idéntico mantiene comportamiento HTTP y no suma solo por updatedAt. |
| `scripts/backfill-remakes.ts` | Cambio de matches.isRemake: suma para todos los jugadores actualmente asociados bajo coordinación de fila. | Clasificación idéntica o partida ausente no suma. Se conserva selección/lote/cliente/lease; no se ejecutó el script. |
| DELETE administrativo | Conserva eliminación, cascadas y limpieza de partidas huérfanas existentes. | No se incrementa una fila eliminada, no se crea tombstone ni se borra run_progress. D13 externa sigue pendiente de E.3. |
| Repositorio de evidencia D | Mantiene su protocolo local anterior de suma SQL bajo lock, sin conectar a ingesta. | Sigue siendo repositorio privado desconectado, no productor Riot ni permiso de grant. |

El helper conserva una lista explícita de contexto: puuid, platform, enabled, rankCheckedAt, lastSyncedAt, backfillSeason/status/startedAt/lastBackfillAt, contadores discovered/processed/unavailable y scanStart/end/offset/pending/exhausted. Es conservador respecto del cursor y etapas de cobertura: no promete que todo cambio altere un resultado numérico. Comparación `IS DISTINCT FROM` antes de actualizar, bajo lock de la fila. No utiliza timestamps como sustituto de R.

Render, consultas, motor de Firma, LP y premios, assets, auth/sesiones, errores/lastSyncAttempt, lastAttemptAt, updatedAt, backfillUpdatedAt y checkpoints del lease quedan excluidos. Si futuras pruebas consumen campos hoy excluidos, su incorporación exige revisar este inventario y los escritores; no se considera una garantía preventiva.

## Atomicidad y rollback

`source-revision.ts` es interno y server-only. Un WeakMap ligado al objeto de transacción deduplica los jugadores marcados; no guarda revisiones en memoria ni coordina trabajos. `syncWrite` confirma `source_revision = source_revision + 1` mediante un UPDATE agrupado antes de persistir checkpoints y de la comprobación final del lease. No se añade conexión, transacción o lease por incremento. El resultado se publica tras el commit existente.

SourceConflict no incluye payload, PUUID, SQL o valores sensibles. El insert de partida/participación compara los campos almacenados con la fuente entrante cuando hay respuesta normalizada disponible. No sobrescribe un conflicto; rollback conserva el registro anterior y no atribuye una nueva procedencia. No trata onConflictDoNothing como atestación. Una clasificación null y una respuesta booleana discordante permanecen conflicto no resuelto; no se corrigen silenciosamente en el importador.

Los locks de jugadores múltiples se adquieren por UUID ascendente en una consulta, y la suma se agrupa. Ranked/contexto toma lock antes de snapshots; el alta es una fila nueva propia. Para partida nueva se inserta primero el padre aún no visible a otras transacciones, como exige la FK, y luego se protege la fila compartida y el dueño antes de insertar participación. No hay requests Riot dentro de transacciones/locks.

Rollback de fuente, participación, contexto y revisión se comprueba en PGlite; también pérdida de lease en la comprobación final después del flush y overflow bigint en el fanout. No es evidencia de concurrencia entre conexiones PostgreSQL independientes.

## Remakes compartidos

Clasificación y nuevas asociaciones usan la misma fila `matches` con FOR UPDATE **antes** de bloquear jugadores. La clasificación descubre asociados dentro de la transacción y después del lock de partida; luego bloquea esos UUIDs en orden estable, actualiza la clasificación y marca a todos. Una asociación que ocurre después debe leer la clasificación vigente y concordar con ella; su propio insert suma su revisión. No basta una SELECT descoordinada del conjunto.

Se preparan regresiones con dos dueños: clasificación efectiva e idéntica, asociación posterior concordante/discrepante, legacy null, rollback y overflow de uno de los dueños. DELETE conserva el lease y las cascadas actuales; no añade limpieza parcial de JSON. La coordinación real de DELETE/alta/locks, posibles esperas/deadlocks y nuevos actores deberá probarse en F, no se afirma demostrada por PGlite.

## Fallo original y parada (registro histórico)

Node **24.19.0**, instalado; PATH modificado únicamente en los procesos de validación. Sin instalaciones ni cambios en archivos de entorno.

Durante preparación se ejecutó typecheck: pasó para los escritores; al añadir los tests detectó un import de catálogo incorrecto en el test nuevo. Ese import se corrigió para comprobar R1/I1/OTP reales, pero no se repitió typecheck ni se afirma PASS del estado final. No se cambiaron contratos ni reglas.

La primera invocación de Vitest dentro del sandbox no arrancó por `spawn EPERM`; cero tests ejecutados. Se ejecutó la suite focalizada con permisos para los subprocesos locales, sin acceder a servicios operacionales:

`node node_modules/vitest/vitest.mjs run tests/source-revision.test.ts --maxWorkers=1 --hookTimeout=60000`

Resultado: **32 aprobadas, 1 fallida, 0 omitidas (33)**, 6,02 s totales y 4,041 s de tests. Falló `compares PostgreSQL float4 participation without false conflicts`.

Diagnóstico adicional de solo lectura en PGlite efímero: `SELECT 0.123456789::real` devuelve número JS `0.12345679`; `Math.fround(0.123456789)` es `0.12345679104328156`. La comparación implementada normaliza solo la entrada, por lo que rechaza esa reutilización idéntica. Aplicar la representación float4 a ambos lados devuelve igualdad en este ejemplo, pero la corrección y su regresión **no se han realizado ni validado tras la parada**. No se usan tolerancias amplias ni redondeo de criterios OTP.

El defecto real bloqueó el commit en aquella entrega: podía producir un conflicto falso si una participación normalizada era reinsertada y el adaptador entregaba la representación decimal corta de real. Se conservó el test fallido. No se aumentó timeout, no se suavizaron expectativas ni se repitió la suite para intentar ignorarlo. La corrección posterior autorizada se registra a continuación.

La secuencia final obligatoria `lint → typecheck → test --maxWorkers=2 --hookTimeout=60000 → validate-production-demo.mjs` **no se ejecutó en aquella primera entrega** tras la parada. Build y smoke quedaron pendientes; los resultados anteriores de D no sirven para aprobar E.1. Los 63 tests D se conservaron sin modificar, pero no se reejecutaron entonces. No se creó commit en esa entrega.

### Reanudación autorizada: corrección específica float4

Se comprobó `player_matches.kill_participation`: es `REAL` en el esquema y las migraciones existentes. Es el único campo de esta comparación al que se aplica `Math.fround`. Las métricas integer y la revisión bigint mantienen sus comparaciones/aritmética previas; no hay tolerancia epsilon, redondeo general, cambio de cálculo o reglas de logros.

`participationFloat4` valida número finito en el dominio [0,1] antes de la escritura y normaliza tanto el valor entrante como el valor almacenado; null/undefined conservan el tratamiento nullable existente. También rechaza un valor almacenado corrupto al comparar una reutilización. NaN/Infinity no se convierten en igualdad o evidencia válida. La validación de ámbito, identidad, partida y resto de campos conserva los conflictos reales.

Se mantiene el caso originalmente fallido, agregando comprobación de fila idéntica tras reutilizar. **13 regresiones adicionales**: dos decimales JS distintos con la misma representación float4; diferencia representable que mantiene conflicto/rollback; seis entradas no finitas o fuera de rango; entrada y fila NaN inválidas en reutilización; null/0/1; y diferencia integer de damage que se perdería si se aplicase float4 indebidamente. No se modifica ningún test anterior ni sus límites.

Node **24.19.0**. Suite focalizada requerida: **46 aprobadas, 0 fallidas, 0 omitidas**, duración **5,76 s**; incluye los 33 casos originales. Secuencia final efectivamente ejecutada, sin suite y build simultáneos:

| Comando | Resultado |
| --- | --- |
| `npm run lint` | PASS, código 0. |
| `npm run typecheck` | PASS, código 0, incluido el test de catálogo antes corregido. |
| `npm run test -- --maxWorkers=2 --hookTimeout=60000` | **1.143 aprobadas, 10 omitidas, 0 fallidas** (1.153 total); **54 archivos aprobados y 2 omitidos**; duración **146,05 s**. Incluye los 46 casos E.1 y los 63 casos D sin modificar; pasan las regresiones anteriores de Demo, LP, Firma, premios y sincronización. |
| `node scripts/validate-production-demo.mjs` | **PRODUCTION_DEMO_PASS**, código 0. Ejecuta `npm run build` en copia aislada, sin archivos .env, con los cinco secretos ausentes y guard de red. Compilación **27,6 s**, TypeScript **11,6 s**, siete páginas estáticas. Smoke HTTP correcto en SoloQ/Flex/5v5, perfiles, ranking, períodos de métricas y bloqueos admin/cron/dev/status esperados. |

El guard bloquea PostgreSQL y Riot autenticado y solo permite localhost/assets públicos Data Dragon. No es QA remoto de Preview/Production ni autorización para sincronizar. Diez tests PostgreSQL opt-in permanecen **omitidos**, no acreditan concurrencia real. No se modifican timeouts, configuración ni expectativas previas. Logs locales ignorados: `artifacts/source-revision-final-tests.log` y `artifacts/source-revision-final-demo.log`, fuera del commit.

Revisión final de atomicidad: fuente, revisión y checkpoint permanecen en syncWrite con fencing inicial y final; fanout agrupado por jugadores bajo locks ordenados, idénticos sin otra suma y rollback de prefijo/overflow/lease perdido cubiertos por PGlite. Se volvió a buscar el inventario de escritores: no aparecen nuevas rutas, productores fuera del protocolo ni conexión al repositorio D. Es inspección y pruebas de motor local, no prueba de MVCC con sesiones independientes.

SQL 0007, snapshot y journal conservan los hashes del preflight; `git diff` de migraciones/schema, evaluadores, lectores y presupuestos no muestra modificaciones. Archivos protegidos conservan sus hashes. `main` y `origin/main` permanecen en `635f1ae04f33d8aef894c3aaff4c723bc2e64799`. La revisión habilita solo el commit local `feat(achievements): integrate source revision writers`, limitado a diez archivos: siete integraciones preparadas, helper source-revision, tests nuevos y este documento. SHA final se informa en el chat, sin incorporarlo a su propio contenido.

## Coste e invariantes

Overhead identificado por código, sin benchmark Neon: cada escritura efectiva de contexto añade una SELECT con comparación/lock, y cada transacción marcada un UPDATE agrupado. Participaciones usan la protección de partida, lock del dueño y, solo si hay conflicto PK, lectura de concordancia de la participación. Reclasificación añade lock de partida, consulta agrupada de asociados y lock agrupado de dueños; no consulta por jugador del fanout. Se mantiene la unidad de transacción por ID que ya tenía la ingesta, sin conexiones adicionales. No se afirma overhead nulo ni que quepa en todos los turnos sin medirlo.

No se modifican 230 s globales, turnos/lotes Fair Scheduling, pacing 1300 ms, Retry-After, policy de ventanas, lease/fencing, reglas R1/I1/OTP ni lectores/cálculos de Firma/LP/premios. Las nuevas comprobaciones de conflicto son la excepción deliberada: deduplicación discrepante deja de aceptarse silenciosamente. La suite completa pasa las regresiones disponibles; no representa prueba de todos los escenarios operacionales. Demo no usa estos escritores; build/smoke aislado aprobado en esta reanudación.

## Matriz pendiente para B.2.F

En PostgreSQL **local desechable**, con dos conexiones independientes, tras reanudar y validar E.1:

1. Dos transacciones al mismo dueño: serialización y dos incrementos sin lost update.
2. Asociación vs clasificación compartida en ambos órdenes: barreras tras lock de partida; ningún asociado confirmado queda con una clasificación cambiada sin revisión correspondiente.
3. Dos dueños, distinto orden de entrada UUID: locks estables y ausencia de incremento parcial; overflow/fallo fuerza rollback de todos.
4. DELETE vs asociación/reclasificación/sellado: cascadas, rollback de víctima si hubiera deadlock, sin evidencia huérfana ni pérdida de datos del otro dueño. No afirmar eliminación de run_progress.
5. PATCH vs futura confirmación local de revisión: rechazo de revisión/eligibilidad obsoletas sin grants reales.
6. Lease expirado/takeover mientras hay escritura: final fencing rechaza fuente y R juntas.
7. Respuesta perdida después de commit, retry de contexto/participación: sin doble incremento por contenido idéntico; cursor persistido continúa.
8. Lectura repeatable read concurrente con fuente nueva: R y datos en la misma fotografía; sellado D detecta revisión posterior.
9. Writer antiguo/SQL directo: demostrar que queda fuera de la garantía y mantener consumo probatorio deshabilitado.

No se ejecutó esta matriz ni Neon; tampoco se ejecutaron las diez pruebas opt-in anteriores de PostgreSQL real.

## Migración, despliegue y siguientes etapas

0007 SQL, snapshot y journal permanecen intactos. No se genera migración. La columna está solo preparada localmente: **no asumir que staging la tiene ni publicar este código antes de aplicar 0007 con autorización**.

Tras esta corrección, validación y commit local de E.1, orden futuro sujeto a permisos separados: E.2 autorizado (capturas/manifestaciones/disposiciones, sin confundir origen declarado con autenticación) → E.3 autorizado (D13 externo, run_progress/logs/sessionStorage/respaldos y retención/acceso definidos) → F de concurrencia real local y evaluación de overhead → RC/preflight de respaldo y migración staging → aplicación explícita 0007 → publicación autorizada → QA protegido y operaciones reales solo con permiso separado. Ninguna de esas etapas se inicia aquí.

Deployments antiguos, scripts directos o SQL externo pueden cambiar fuentes sin sumar R. Drenarlos y controlar acceso es precondición de consumo probatorio; un rollback a escritor anterior obliga a mantener ese consumo cerrado. Rollback de código conserva DDL/journal aditivos; no DROP ni reconstrucción histórica. Revisión no acredita procedencia Riot, reconciliación, autenticidad, certificación ni permiso de grant.

Sin push, deployment, acceso Neon, llamadas Riot operacionales, migración remota/nueva, grants, equipamiento, activación de flags, cambios main/Production o inicio de E.2/E.3/F. Archivos protegidos se preservan; Git final y verificaciones de integridad se informan en el chat.
