# 1.2.B.2.RC1 — Preview Demo aislada de staging

Fecha: 12 de octubre de 2026. **Preparación local; no publicación ni activación operacional autorizadas.**

## 1. Identidad del candidato y estado local

Base auditada: `716428c5088aa17c5e22099a14a7002cfa2e9081`, rama `staging`.
Referencia **local, no actualizada mediante fetch**: `origin/staging=726daaf58372324e2b01a41cce9f6a86401c6f29`.
Inicialmente 14 commits delante / 0 detrás. `main` y `origin/main` locales:
`635f1ae04f33d8aef894c3aaff4c723bc2e64799`. No acredita el estado remoto actual.
Working tree inicial: únicamente `CLAUDE.md` modificado y `.claude/` sin seguimiento;
`.env.local` ignorado. Hashes cotejados sin leer secretos; se preservan los cuatro
archivos protegidos existentes. Este documento es el único cambio del RC.

El SHA de publicación será el del commit local que incorpora este runbook,
comprobado mediante `git rev-parse HEAD` después del commit. No se reutiliza el SHA
base como si incluyera el documento ni se inventa un SHA autorreferencial.

## 2. Alcance permitido

Candidato principal: **Preview Demo aislada**, con `DEMO_MODE=true` exacto.
Ranking, perfiles ficticios SoloQ/Flex/5v5, métricas season/30d/7d, Salones,
gráficas, historial, privacidad/términos y assets públicos. La UI identifica los
datos ficticios; no reconstruye LP históricos reales.

Sin Neon, Riot autenticado, sincronización global/individual, backfill, ejecución
operacional de cron, escritura administrativa, capturas personales, headers/units,
certificación, grants o equipamiento. No requiere 0007/0008 remotas ni retención de
capturas personales para usar fixtures. Esto no resuelve la privacidad operacional.

Señales competitivas permanecen experimentales. Para este candidato se recomienda
mantener `ACHIEVEMENTS_EXPERIMENTAL` ausente; no se cambia el flag aquí. Una eventual
activación autorizada en Preview Demo solo evalúa fixtures, nunca concede insignias.

## 3. Matriz de variables reales

Los nombres proceden de `src/server/env.ts`, DB, auth, Riot, assets, status,
feature, HTTP y layout. **No se leyeron valores remotos ni archivos de secretos.**
“Ausente” significa ausencia efectiva tras resolver variables generales, específicas
de rama e integraciones; no basta con ocultarlas en el dashboard.

| Variable | Función | Necesaria Demo Preview | Debe estar ausente | Riesgo de valor Production / comportamiento si falta | Acción futura autorizada |
| --- | --- | --- | --- | --- | --- |
| `DEMO_MODE` | Selección servidor fixtures / operacional | Sí, literal `true` | No | Ausente, `false` o inválida NO activa Demo; podría entrar en rutas DB. No hay fallback por fallo de DB | Confirmar `true` efectivo para build y runtime de staging Preview antes del push |
| `DATABASE_URL` | Cliente PostgreSQL y migrador explícito | No | Sí | Credenciales/destino real si se desactiva Demo; ausente DB lanza error. Demo rechaza antes de inicializar cliente | Confirmar no inyección por integración ni override de rama; nunca copiar Production |
| `RIOT_API_KEY` | Cabecera servidor Riot | No | Sí | Exposición/uso indebido; ausente fuera de Demo produce RiotError 401. Demo rechaza antes de fetch | Confirmar ausencia efectiva |
| `ADMIN_PASSWORD` | Login operacional | No | Sí | Acceso indebido por reutilizar secreto; fuera de Demo exige mínimo 16 caracteres | Confirmar ausencia; Demo bloquea login antes de consultar el secreto |
| `ADMIN_SESSION_SECRET` | HMAC de sesión | No | Sí | Reutilización de confianza entre entornos; fuera de Demo exige mínimo 32 caracteres | Confirmar ausencia; cookies residuales no habilitan Demo |
| `CRON_SECRET` | Bearer de cron | No | Sí | Autorizar consumidor operacional accidental; fuera de Demo exige mínimo 32 caracteres | Confirmar ausencia; no configurar scheduler |
| `APP_URL` | Metadata y comprobación de Origin | Sí para origen correcto; render admite fallback | No | URL Production generaría metadata/origen incorrectos; falta: metadata localhost, HTTP usa origen del request | Elegir origen Preview autorizado, sin secreto ni rutas; verificar alias real |
| `ACHIEVEMENTS_EXPERIMENTAL` | Sección observacional servidor | No | Sí para el candidato mínimo | Ausente/desconocido desactiva; `true` solo en entorno permitido, nunca Production identificado | Confirmar ausente/apagado; cualquier activación requiere otra autorización |
| `LADDER_SCHEDULER_ENABLED` | Indicador UI, no scheduler | No | No; ausente o `false` | Ausente=false; incluso true Demo informa false. No impide cron operacional cuando Demo=false | Confirmar ausente/false; no usarlo como lock o autorización |
| `RIOT_REQUEST_INTERVAL_MS` | Pacing Riot | No | No | Ausente=1300 ms; mínimo efectivo 1300. Sin efecto operacional en Demo | No cambiar ni reducir |
| `DDRAGON_VERSION` | Assets públicos Data Dragon | No | No | Ausente descubre versión pública; error devuelve assets vacíos. Sin credenciales | Opcional versión pública válida; permitir solo assets necesarios |
| `VERCEL`, `VERCEL_ENV`, `VERCEL_TARGET_ENV` | Identificación de entorno del flag | Gestionadas por plataforma | No | Production identificada desactiva flag; entorno desconocido lo desactiva. NO autorizan DB/sync | Verificar valores de entorno no sensibles, no sobrescribirlos para simular Preview |
| `NODE_ENV` | Runtime, cookies y dev routes | Gestionada por Next/Vercel | No | Preview puede usar production; no distingue por sí sola Preview de Production | Verificar build production y dev routes ocultas |
| `NEXT_TELEMETRY_DISABLED` | Telemetría Next en harness | No | No | Ausente no afecta Demo guards | Harness local usa 1; no modificar remoto en RC |

`ACHIEVEMENT_LOCAL_PG_URL`, `ACHIEVEMENT_VISUAL_DIR`, `ACHIEVEMENT_VISUAL_CSS` y
`BACKFILL_VISUAL_DIR` son entradas de tests locales, no requisitos del deployment.
`VERCEL_AUTOMATION_BYPASS_SECRET` aparece en la documentación del scheduler externo;
no es un secreto requerido por Demo ni se obtiene/usa en este RC. P3 no autoriza
crear bypasses, relajar protección ni activar servicios.

## 4. Guards revisados y frontera de confianza

| Camino | Control efectivo anterior a operaciones |
| --- | --- |
| Imports e inicialización DB | `src/db/index.ts`: cliente lazy; `db()` rechaza Demo antes de crear postgres. Importar schema no conecta |
| Ranking/perfil | `src/server/queries.ts`: fixtures antes de SELECT; ID inexistente Demo devuelve null sin DB |
| Logros observacionales | `service.ts`: Demo reader antes de importar DB; 5v5 no aplicable. Flag ausente no llama servicio desde perfil |
| Riot | `RiotClient.request`: Demo antes de clave/fetch; observadores privados conservan guard de scope/Demo |
| Autenticación/admin | `authenticated()` devuelve false en Demo; `requireAdmin()` rechaza 503 antes de sesión/DB; login guard propio |
| Mutaciones admin | POST/PATCH/DELETE verifican Origin y requireAdmin antes de parsear/leer/escribir o tomar lease |
| Diagnóstico privado | GET players/progress requiere admin; `readSyncProgress` también rechaza Demo directamente |
| Global/individual/history | `withSyncLease` rechaza antes de adquirir lease; llamados individuales sin lease también llegan a `db()` bloqueado |
| Cron | Guard Demo antes de secreto/autorización/global sync: devuelve skipped, no ejecución |
| Admin page | LoginForm deshabilitado; no lecturas admin. Privilegios/cookies no superan Demo |
| Evidencia/grants | Productores privados únicamente dentro de escrituras operacionales; no rutas públicas de verificación/concesión ni Server Actions nuevas |

No existe un guard global que convierta cualquier configuración Vercel en Demo:
**es imprescindible configurar `DEMO_MODE=true`**. La ausencia de credenciales es
defensa adicional, no sustituto de esa selección. `VERCEL_ENV=preview` tampoco
autoriza sincronización. Funciones internas con transacciones inyectadas no son
endpoints ni una nueva barrera de autenticación; su exposición futura exigiría revisión.
Los formatos/DTO preservan `certification=not_established` y `grantAuthorized=false`.
No hay lector D18 público o acceso a capturas desde perfiles.

## 5. Bloqueos HTTP esperados y verificables localmente

El harness existente hace **40 comprobaciones HTTP** contra Next real, con cookies
residuales de aspecto válido e input inválido. No llama al backend operacional.

- GET `/admin`: 200, formulario Demo deshabilitado; no panel de operación.
- GET `/api/admin/players` y `/api/admin/sync/progress`: 503, no-store.
- POST login/logout/players/sync y players/:id/sync o backfill: 503 con Origin correcto.
- PATCH/DELETE players/:id: 503; no mutación. Origin ajeno en sync: 403.
- GET `/api/cron/sync`: **200** con `skipped:true, reason:"demo"`; el bloqueo es de
  ejecución, no un 403. No confundir HTTP 200 con sincronización exitosa.
- GET `/api/ladder/sync-status`: 200/no-store, never, scheduler false y éxito null.
- Rutas `/dev/*`: not-found, aunque streaming puede iniciar HTTP 200.
- Perfiles inexistentes: not-found sin DB; públicas SoloQ/Flex/5v5 y métricas renderizan.

El preload `demo-network-guard.cjs` impide hosts ajenos y PostgreSQL 5432;
permite loopback, IPC de build y Data Dragon público. Es instrumento de validación,
**no firewall desplegado** ni demostración de cero tráfico público. El harness no
copia `.env*`, `.git`, CLAUDE o .claude; elimina sus recursos desechables al terminar.

## 6. Dependencias SQL y compatibilidad

Journal local: nueve entradas 0000–0008, sin 0009. No se altera ningún SQL/snapshot/journal.
`0007_local_evidence_persistence`: añade `players.source_revision` bigint NOT NULL
default 0/CHECK no negativo y tablas `achievement_evidence_headers/units`, FKs,
CHECKs, unicidad y RLS. `0008_operational_capture_support`: sustituye únicamente
dos CHECK de headers para admitir `identity_capture` y `server_riot_received`.

Dependencias reales: SELECT de player completo en sync/admin y
`getLeaderboard` operacional incluyen la nueva columna; `source-revision.ts`
bloquea/incrementa R. `match-evidence`, `ranked-evidence`, `ranked-event-store` y
`verification/evidence-in-tx` leen/escriben tablas de evidencia. Repositorio privado
D usa columna/tablas para lecturas, sellado y revisiones. 0008 es necesaria para
las nuevas capturas de identidad/fuente operacional: sin ella fallan los CHECK.
Incluso una lectura operacional puede necesitar 0007; no basta con evitar sync.

Demo evita esos caminos en build/render/HTTP y no necesita migraciones remotas.
El estado real Neon de 0007/0008 **no se conoce ni se presupone**. `npm run build`
solo invoca prebuild de assets locales + Next; `next.config.ts` añade headers,
`vercel.json` solo contiene $schema, sin cron declarativo ni hooks de migración.
`npm run db:migrate` es separado: `scripts/migrate.ts` carga .env.local y .env sin
override de variables existentes, y aplica **todas** las migraciones pendientes
del directorio drizzle, no una seleccionada. **No ejecutarlo para preparar Demo.**

## 7. Validación del candidato sin cambios funcionales

Node **24.19.0**, PATH solo del proceso. Secuencia autorizada: lint, typecheck,
suite con dos workers/hookTimeout 60000 y harness Demo que ejecuta npm run build.
Resultados RC ejecutados secuencialmente, todos con código de salida 0:

| Comprobación | Resultado actual |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test -- --maxWorkers=2 --hookTimeout=60000` | **1390 PASS, 40 omitidas opt-in, 0 FAIL**; 60 archivos aprobados / 3 omitidos; 125,75 s |
| `node scripts/validate-production-demo.mjs` | **PRODUCTION_DEMO_PASS**; npm run build real y **40 checks HTTP**; ninguna conexión prohibida detectada |

No son resultados remotos. El smoke ejecuta build optimizado production, no una
instancia Vercel. La matriz de flag Preview/Production se comprueba en los tests
existentes de feature y perfil; no acredita variables efectivas remotas.
No dependencias nuevas, nuevos skips/timeouts ni tests duplicados. No se necesita
el harness F: no hubo una corrección local de integridad que justificase ejecutarlo.
Las suites opt-in PostgreSQL existentes sin su configuración se reportan por separado;
no convertir omisiones en PASS. G.1 documenta su ejecución anterior de 40 pruebas
reales locales y 1430 totales, que no se afirma repetida en RC.

## 8. Riesgo de autodeployment y documentación contradictoria

Un push puede publicar inmediatamente todos los commits pendientes a Preview con
variables **operacionales previamente existentes**. No subir primero y revisar
variables después. No ejecutar P1–P4 en esta tarea.

AGENTS describe staging habitual con DEMO_MODE=false. Este RC propone temporalmente
Demo como destino distinto, sujeto a autorización. README conserva textos antiguos
sobre cron declarativo diario y Production operacional (secciones Cron/Despliegue);
contradicen `vercel.json`, AGENTS y `docs/STAGING_SYNC.md`. No seguirlos para este RC.
No se modifican instrucciones ajenas aquí. STAGING_SYNC también contiene inventarios
anteriores de logs: D13 y G.1 describen cambios posteriores; usar código actual.

## 9. Verificación remota pendiente: P1

**Requiere autorización futura, solo lectura.** Identificar proyecto/repository link,
Production Branch main, rama staging dirigida a Preview, SHA Production actual,
protección Vercel Authentication y acceso autorizado, automatic Git deployments,
overrides build/install/output, integraciones y variables efectivas de staging.
Examinar nombres, ámbitos y overrides sin mostrar secretos. Confirmar build/runtime
Demo y ausencia de las cinco credenciales; confirmar flag apagado para este candidato.
Sin inspección de Neon ni queries operacionales.

Si staging sigue operacional, P1 termina **NO-GO**: solicitar autorización separada
para que el propietario configure Preview Demo aislada, retire la inyección de
credenciales y compruebe el resultado. No cambiar Production ni otras ramas. Esa
configuración no está incluida en P1 de solo lectura. Los cambios de variables
no cambian deployments antiguos: inventariar sus URLs/aliases y evitar usar uno
operacional para QA. No iniciar redeploy manual como parte de este runbook.

## 10. Checklist anterior a cualquier push

- P1 documentada y configuración efectiva Demo confirmada; ningún secreto heredado.
- Autorización explícita de publicación con SHA final exacto y rama destino staging.
- Entonces fetch autorizado; rama/HEAD, remoto actual y ancestro comprobados, sin divergencia.
- Inspeccionar lista exacta de commits y archivos; proteger working tree ajeno, sin add -A.
- Revisión migraciones inmutables, flag, scripts/build overrides y grants ausentes.
- main/Production verificados de solo lectura con permiso; no asumir sus SHA remotos.
- Validaciones locales RC satisfactorias y límites/omisiones registrados.
- Confirmar que el push dispara solo Preview; detenerse ante cambio de target o configuración.

## 11. Orden de publicación futuro

**P1 → configuración independiente autorizada si hace falta → P1 repetida → P2 → P3.**

P2, solo tras nueva autorización: comprobar identidad/remoto/fast-forward, ejecutar
una sola vez `git push origin HEAD:staging`, sin force ni cambios de main. Confirmar
SHA remoto; esperar deployment automático con Git branch staging, SHA final exacto,
target Preview y READY. No redeploy manual, segundo push ni migración si falla.
Reportar logs sanitizados y parar. No fusionar con Production.

## 12. QA real posterior: P3

Con permiso y sesión autorizada al Preview protegido, comprobar las rutas de la
sección 5, banner/disclaimer, ranking/filtros, perfiles Demo SoloQ/Flex/5v5,
métricas/Salones, pool/Firma/LP/historial y móvil 320/390 px. No introducir cuentas
reales, borrar jugadores, login operacional, activar continuaciones o ejecutar
backfills. Para API usar origen Preview exacto y datos ficticios. Comprobar ausencia
de capturas/grants/equipamiento/señales si flag apagado, consola/hidratación,
no-store y fuentes Barlow. Revisar logs autorizados sin imprimir secretos.

Comprobar nuevamente SHA, variables/ámbitos y Production anterior sin cambios.
Un smoke HTTP correcto no demuestra configuración ausente de secretos: se necesitan
ambas evidencias. No declarar QA Vercel cumplida a partir del harness local.

## 13. Rollback conservando DDL

Ante fallo antes de push: detenerse, no hay despliegue que revertir. Tras deployment,
intervenir únicamente con nueva autorización; seleccionar un deployment Demo
conocido y configurado de forma aislada. Nunca devolver aliases a una versión
operacional por conveniencia. No force-push, reescritura, DROP, reestrechamiento de
CHECKs ni eliminación del journal/evidencia. Conservar 0007/0008 si se aplicaron
en una fase futura. Restaurar backup requiere autorización y revisión D13.

Volver a writers antiguos pierde captura/R/redacción de progreso en futuras
operaciones. Lectores D/operacionales antiguos no entienden streams G.1. Drenar
writers incompatibles y mantener operación desactivada antes de rollback; no
reclasificar/borrar datos para hacerlo compatible ni conceder por lectura incompleta.

## 14. Staging operacional futuro: P4 independiente

Nueva autorización: destino Neon staging inequívoco, rol/permisos efectivos,
backups Ready/PITR y tratamiento de restauraciones D13, migraciones aplicadas,
recuentos y ausencia de operaciones incompatibles. Si faltan, migrar cadena revisada
0007/0008 mediante migrador antes de habilitar código dependiente, con backup y
verificación posterior. No asumir que un build Demo haya probado Neon.

Antes de capturas reales: finalidad/retención, logs/backups externos, D18 privado,
control de writers antiguos/SQL privilegiado, transporte atribuido, latencia/costo
SQL/locks/pooler/WAL, scans/remakes y límites JSON/headers. Mantener límites actuales:
1000 headers/player, 100000 units/header, 32 MiB/header, 64 MiB/player,
64 KiB/header, 16 KiB/unit. G.1 reduce headers ranked pero no resuelve crecimiento
de scans/remakes o almacenamiento a largo plazo. Sin TTL/purga automática aprobada.
F prueba concurrencia PostgreSQL local, no roles ni rendimiento Neon.

Operación real acotada, reconciliación, certificación, grants, equipamiento y
scheduler necesitan permisos separados. Ninguno se autoriza por preparar Demo.

## 15. GO / NO-GO

GO local para **preparar P1 de Preview Demo** si las validaciones RC pasan; no es
autorización para publicar ni constatación de Preview segura desplegada.
NO-GO de publicación mientras P1/configuración efectiva no estén confirmadas.
NO-GO operacional mientras falten migraciones verificadas, permisos, política de
privacidad/capacidad, writers compatibles o autorización concreta.

Detenerse ante Git inesperado, target Production, DEMO_MODE no literal true,
secretos efectivos, build override con migración/sync, acceso admin operacional,
tráfico DB/Riot autenticado, filtración privada, grants, fallo crítico de tests o
incompatibilidad que exija rediseño. No corregirlo con cambios remotos implícitos.
