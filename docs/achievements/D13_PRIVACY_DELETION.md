# E.3 — Eliminación D13 y privacidad operacional

Fecha: **12 de octubre de 2026**. Rama `staging`; HEAD inicial
`7fa60a27d7b8d617c3de6ca83695f90e16083d91`. Referencia **local**, sin fetch,
`origin/staging`: `726daaf58372324e2b01a41cce9f6a86401c6f29`, once commits por
delante y cero por detrás. Solo `CLAUDE.md` y `.claude/` eran cambios ajenos;
se preservan junto con `.env.local`, sin leer sus secretos.

Alcance: eliminación administrativa existente y minimización local. **No es una
declaración de cumplimiento legal integral, anonimización irreversible o borrado
de todas las copias externas.** Las políticas D13/D18 aprobadas en
[el diseño de certificación](CERTIFICATION_AND_GRANTS_DESIGN.md) conservan sus
parámetros operativos pendientes. No hay concesiones, equipamiento ni consumo
probatorio autorizado.

## Inventario de superficies

Clasificación: **A** borrado transaccional; **B** redacción por código;
**C** acción de un navegador; **D** infraestructura/proveedor;
**E** finalidad/retención/acceso pendientes. Una superficie puede tener más de una.

| Superficie real                                             | Información / vínculo                                                                                                              | Clase y tratamiento                                                                                                                                                                                                                                                |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `players`                                                   | UUID, PUUID canónico, Riot ID, plataforma, icono, estados/errores, cursores, IDs pendientes y revisión                             | **A — IMPLEMENTADO**: DELETE original elimina toda la fila. Sin tombstone, suma a una fila eliminada ni recreación de identidad.                                                                                                                                   |
| `ranked_snapshots`                                          | Owner, colas, LP/rango oficiales y tiempos                                                                                         | **A — IMPLEMENTADO**: FK CASCADE de owner. No reconstruye LP.                                                                                                                                                                                                      |
| `player_matches`                                            | Owner/Match ID y estadísticas individuales                                                                                         | **A — IMPLEMENTADO**: CASCADE de owner.                                                                                                                                                                                                                            |
| `matches`                                                   | ID compartido, cola, mapa, tiempo, duración y remake                                                                               | **A — IMPLEMENTADO**: limpieza original de matches sin participaciones. Una partida usada por otro owner se conserva, incluida su clasificación. No contiene PUUID ni Riot ID; conservarla no equivale a anonimizar todos los datos correlacionables externamente. |
| `achievement_evidence_headers`                              | Owner/scope, padres, claves de operación, huellas y capturas mínimas de identidad/rank/MATCH/remake/recibos                        | **A/E — IMPLEMENTADO**: CASCADE completo, ambas colas y temporadas. Retención de evidencia de jugadores no eliminados sigue pendiente.                                                                                                                             |
| `achievement_evidence_units`                                | Owner/scope, páginas, Match IDs, disposiciones, snapshots, referencias y huellas                                                   | **A/E — IMPLEMENTADO**: CASCADE completo. FKs compuestas impiden referencias probatorias entre owners. No queda un hash personal como tombstone.                                                                                                                   |
| `sync_locks.run_progress`                                   | `latest`/`previous`: `playerId`, `currentPlayerId`, `players[].playerId`; datos/errores de fase y `lastConfirmedMatchId` del owner | **B — IMPLEMENTADO**: redacción selectiva en la transacción DELETE. Conserva la ejecución y otros owners.                                                                                                                                                          |
| `sync_locks` control                                        | Owner opaco del lease, vencimiento, run/request IDs, tiempos/resultados agregados                                                  | **B/E — CONSERVADO**: coordinación y diagnóstico no personal directo. Un ID opaco puede correlacionarse con registros externos; no se afirma anonimización de esas copias.                                                                                         |
| Cache de Firma                                              | `unstable_cache` de medias/desviaciones por cola y modo, sin IDs/PUUID ni filas personales en el valor                             | **D/E — CONSERVADO**: agregado preexistente, sin cambiar cálculos/reglas de Firma. Puede reflejar una contribución hasta su revalidación ya existente; política sobre agregados/derivados pendiente.                                                               |
| Otras caches / memoria                                      | Assets públicos; React `cache` limitado a request, datos RSC/estado de UI y handles privados WeakMap                               | **C/D/E**: no se encontró nueva cache persistente de capturas. Peticiones ya servidas, memoria en otros workers, caches HTTP del proveedor y copias de usuarios no se borran remotamente.                                                                          |
| Logs de aplicación sync                                     | Antes: player UUID y arrays de resultados individuales; errores de capturas no deben imprimir JSON/SQL/payload                     | **B/D/E — IMPLEMENTADO hacia adelante**: logs de sync solo fase/código y conteos agregados. Se conserva diagnóstico por jugador autenticado en BD. No se borraron logs históricos.                                                                                 |
| `sessionStorage` admin                                      | Clave versionada `soloq-admin-sync-observation-v1`: request UUID, acción y hora local; no player ID/PUUID/capturas                 | **C — IMPLEMENTADO**: tras DELETE confirmado, este panel limpia solo su correlación individual coincidente y detiene ese watcher. No borra observaciones de otro jugador/globales o una correlación nueva.                                                         |
| Otros navegadores                                           | Estado de página, correlaciones, historial de navegación, exportaciones/capturas personales                                        | **C/D/E — FUERA DE CONTROL DIRECTO**: no hay limpieza remota de todos los navegadores. No se encontró uso de `localStorage` por la aplicación.                                                                                                                     |
| Sesión administrativa                                       | Cookie HTTP-only/token hash, vencimiento; bucket compartido de login                                                               | **C/D/E — CONSERVADO**: identifica sesión administrativa, no FK al jugador. DELETE no cierra sesiones ni cambia autenticación.                                                                                                                                     |
| Respaldos, WAL/MVCC, ramas Neon, PITR, logs Vercel/Neon/CDN | Copias o rastros anteriores que pueden contener datos personales, paths o identificadores                                          | **D/E — FUERA DE CONTROL DIRECTO**: no consultados, creados, restaurados ni purgados. DELETE lógico no acredita borrado físico inmediato.                                                                                                                          |
| Grants/eventos/equipamiento                                 | No existen tablas ni escritores de concesión                                                                                       | **E — PENDIENTE**: aplicar D13 antes de introducirlos; cero grants actuales.                                                                                                                                                                                       |

El inventario procede del schema, DELETE, productores E.1/E.2, logs, DTOs,
lectores, caches y búsquedas de storage actuales. No inventaría sistemas externos
no inspeccionados como si estuvieran validados. No se incluyen identificadores
personales reales en este documento ni en fixtures de pruebas.

## IMPLEMENTADO: transacción y redacción selectiva

Se mantiene origin + sesión admin + confirmación explícita + `withSyncLease`
originales. Dentro de su `syncWrite`:

1. DELETE del owner, con todas las cascadas originales. Ausente: mismo HTTP 404.
2. `redactDeletedPlayerProgressInTx` comprueba cliente ligado a lease **sin run
   nuevo**, protege la fila `riot` con `FOR UPDATE` y valida owner/vencimiento.
3. En `latest` y `previous`, sustituye por NULL solo los campos `playerId` y
   `currentPlayerId` coincidentes. Elimina solo la entrada del owner en `players`;
   así desaparecen su último Match ID, rank, errores y contadores individuales.
4. Conserva los demás checkpoints, resultados, fases, tiempos, run/request IDs,
   owner del run, revisiones y agregados originales. No ejecuta `summarizeRun`:
   los agregados describen la ejecución original, no un roster recalculado. Después
   del borrado no deben usarse como conteo exhaustivo de los detalles conservados.
5. Limpieza de matches huérfanos original y fencing final de `syncWrite`.
   Un fallo revierte las filas, cascadas y redacción de esa transacción.

No reemplaza todo `run_progress` por NULL, crea un run de borrado, borra los datos
de otros owners ni altera cursores/revisiones/eligibilidad de jugadores restantes.
Sin referencia propia, evita otro UPDATE de progreso. NULL previo sigue NULL.
Un run individual sin owner queda disponible como diagnóstico técnico, nunca se
asigna a otro jugador; la política de visibilidad existente oculta su panel personal.

Se trabaja sobre el formato **v1 actual**. La primitiva rechaza estructuras
incompatibles o claves desconocidas en la fila que recibe protegida; no hace una
limpieza recursiva por coincidencias de strings ni elimina UUID de lease por error.
**Límite:** la adquisición preexistente del lease ya proyecta `run_progress` mediante
`parseEnvelope` antes de llamar esta primitiva. No se afirma que este guard nuevo
preserve formatos desconocidos anteriores a esa adquisición. Antes de introducir
otra versión/extensiones, revisar conjuntamente ese parser, la adquisición y D13;
no hay una nueva garantía de compatibilidad futura ni protocolo de lease aquí.

La adquisición/finalización del lease son transacciones anteriores/posteriores
preexistentes. Un DELETE fallido puede dejar el cooldown de su intento; no se
promete revertir la adquisición, ni se altera esa semántica HTTP.

## Coordinación existente y límites de concurrencia

Un lease activo o cooldown impide DELETE con HTTP 409. No se elimina mientras un
worker válido siga sincronizando. Tras vencimiento, DELETE toma el lease con owner
nuevo y marca como interrumpido el run abandonado mediante el protocolo existente.
El writer antiguo falla la comprobación de owner/vencimiento antes/final de SW y
su finalizador no puede sobrescribir la fila del nuevo propietario.

La redacción solo admite una operación de mantenimiento (`runId=null`): su finalizador
original **no escribe** la copia en memoria del envelope. Por eso esa copia no
restaura referencias después del commit. Un run posterior lee la versión redactada
antes de desplazarla a `previous`. No se añaden locks ni se cambia fencing, revisión
de checkpoint, lease, Retry-After, pacing o presupuestos.

**PROBADO LOCALMENTE:** intercalación controlada con lease expirado, takeover DELETE,
rechazo de checkpoint/escritura antiguos, rechazo del finalizador antiguo y run
posterior sin resurrección de referencias. SQL y rollback usan PGlite efímero.
**PENDIENTE F:** barreras reales con conexiones PostgreSQL independientes; DELETE vs
SW/finalización, asociación y remake compartido, sellado D, expiración dentro de la
transacción y deadlocks. PGlite no prueba esas carreras ni latencia Neon.
Writers antiguos, SQL externo o un llamador que ignore lease/FKs quedan fuera de
esta garantía; deben drenarse/controlarse antes del futuro consumo probatorio.

## Logs, navegador y D18

Capturas E.2 permanecen mínimas, `server-only`, sin PUUID, Riot ID duplicado,
headers, tokens, URLs completas ni payload Riot. Los logs de `service.ts` dejan de
copiar player IDs/listas personales; mantienen fase, error sanitizado y contadores.
El wrapper HTTP y el script de remakes conservan sus mensajes sanitizados, sin
imprimir las capturas ni excepciones SQL completas. Logs históricos/proveedor:
**pendientes**, no purgados ni acreditados como libres de datos personales.

La limpieza de navegador solo sucede tras respuesta DELETE satisfactoria. Mantiene
correlaciones globales/ajenas y permite seguir consultando control disponible.
No inicia sincronización ni continuación automática. No cambia formato/TTL del
storage ni exige cookies nuevas. Si el storage falla, el resultado confirmado del
servidor sigue siendo válido; la copia externa no se declara eliminada.

Inspección y regresiones: capturas no se incorporan a perfil, leaderboard, Salones,
DTO de logros observacionales ni respuesta admin de jugadores/progreso. El DTO admin
conserva solamente diagnóstico sanitizado necesario; sin endpoint nuevo de evidencia.
RLS y ausencia de policies anteriores quedan intactas. **No** acreditan permisos de
un rol Neon propietario/BYPASSRLS. D18 aún requiere definir autenticación, campos,
finalidad y autorización de acceso privado antes de implementar lectores de evidencia
o motivos de suspensión/revocación. Las señales siguen sin certificación ni grant.

## PROBADO LOCALMENTE y validación

Node **24.19.0**, PATH solo del proceso. Tests nuevos: 13 D13 PGlite/fixtures y
cuatro de correlación de navegador; 17 adicionales, sin nuevos skips/timeouts.

- Ambos ámbitos SoloQ/Flex con identidad, rango/snapshots, páginas MATCH y remake
  asociado a dos owners; CASCADE de uno, conservación exacta de fila/R, evidencia,
  participaciones y snapshots del otro; match compartido intacto y huérfano retirado.
- Redacción exacta latest/previous/current/arrays/último match; agregado original,
  tiempos/resultados y DTO de control preservados; progreso ajeno/NULL intactos.
- Lease activo/cooldown, takeover/interrupción modelados, escritor/finalizador
  obsoletos, nueva ejecución, rollback tras redactar, 409/404 del segundo DELETE.
- Sin autorización/Demo no alteran fuente/evidencia; errores y logs sanitizados;
  logs agregados del global/429; ausencia de grants y de lectores públicos nuevos.
- Correlación individual eliminada solo por evento confirmado, global/otro jugador/
  correlación nueva intactos, incertidumbre anterior conservada y storage fallido.

Focalizadas finales: **348 aprobadas**, siete archivos, 0 fallidas/omitidas.
La primera ejecución nueva detectó dos fixtures con fase `history` inválida para
el scan: corregida a la fase real `season_backfill`, sin cambiar el contrato.
El primer typecheck detectó el puerto específico postgres-js del helper frente a
dos llamadas directas PGlite del test. Se sustituyó únicamente la anotación por el
puerto común instalado de builders Drizzle ya existente (`select`/`update`); sin
casts entre drivers, conexiones nuevas ni cambios de ejecución. Las 33 pruebas
de los dos archivos específicos volvieron a pasar después de ese ajuste.

Secuencia final, sin build paralelo a tests:

| Verificación                                         | Resultado                                                                                                                                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                                       | PASS, código 0.                                                                                                                                                                       |
| `npm run typecheck`                                  | PASS, código 0.                                                                                                                                                                       |
| `npm run test -- --maxWorkers=2 --hookTimeout=60000` | **1.369 aprobadas, 10 omitidas, 0 fallidas**; 59 archivos aprobados y 2 omitidos; 123,82 s.                                                                                           |
| `node scripts/validate-production-demo.mjs`          | **PRODUCTION_DEMO_PASS**, código 0: `npm run build` aislado y **40 checks HTTP** aprobados; compilación 62 s y TypeScript 7,8 s. Sin PostgreSQL/Riot autenticado ni errores de guard. |

Las diez omisiones preexistentes requieren PostgreSQL local independiente: seis
de lecturas consistentes y cuatro del lease. No se habilitaron ni se sustituyeron
por Neon. La suite conserva regresiones de Demo, LP, Firma, premios, perfil,
capturas, fuente, scheduling y progreso; no altera reglas ni timeouts.
Build se realiza con el harness existente, sin `.env*` ni credenciales: bloquea
PostgreSQL/Riot autenticado; solo permite loopback y assets públicos Data Dragon.
No constituye QA remoto ni demuestra borrado de respaldos o navegadores ajenos.

## PENDIENTE: política, operación y despliegue

No hay plazo de retención nuevo, TTL, purga automática para cupos, excepción legal,
calendario de cierre ni eliminación remota. Definir con el propietario: finalidad y
plazo de evidencia aún conservada, agregados/derivados, logs, respaldos y restauraciones,
responsabilidad del operador, acceso privado D18 y tratamiento de copias externas.
Restaurar un respaldo podría reintroducir datos eliminados: el procedimiento debe
acordarse antes de restauración, sin inventar aquí un ledger/tombstone personal.

Orden futuro, **sujeto a autorizaciones independientes**: F local y medición → RC/
preflight remoto (escritores drenados, rol/permisos, respaldo, recuentos) → aplicar
0007/0008 revisadas en Neon staging si faltan → publicar código dependiente → QA
protegido y operaciones reales expresamente autorizadas. No se asume que esas
migraciones estén aplicadas. E.3 no cambia schema, SQL 0000–0008 o journal.
Production Demo no necesita dichas migraciones ni PostgreSQL.

Rollback de código no revierte un borrado confirmado ni debe recrear owners. Mantener
DDL/journal; nunca DROP automático. Volver a un DELETE antiguo pierde la redacción
en eliminaciones futuras: no habilitar consumo probatorio con writers incompatibles.

Sin push/fetch, deployment, acceso Neon, Riot operacional, migración remota/nueva,
grants, equipamiento, activación de flags, cambios main/Production o inicio de F.
Solo los tests preparan y mutan bases efímeras locales. Archivos protegidos ajenos
se conservan; SHA del único commit local y Git final se informan en el chat.
