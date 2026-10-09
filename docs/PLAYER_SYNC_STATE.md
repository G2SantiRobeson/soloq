# Estados independientes de sincronización — Fase 03.B.1–2

## Contrato

`PlayerSyncState` en `src/lib/player-sync-state.ts` es un contrato nuevo y serializable.
`toPlayerSyncState` adapta una fila de Drizzle sin consultar Riot ni hacer queries adicionales.
No reemplaza todavía `PublicPlayer`, los endpoints existentes o la interfaz administrativa.

- `rank.checkedAt`: última respuesta validada de LEAGUE-V4 persistida junto con sus
  snapshots. Incluye SoloQ y Flex, incluso una respuesta Unranked y estados sin cambios.
  No se deduce de `updatedAt`, del timestamp de un snapshot o de MATCH-V5.
- `recent.coveredThrough`: el `lastSyncedAt` existente, exclusivamente el corte cubierto
  completamente por el importador reciente. Un lote parcial o un backfill no lo avanzan.
- `recent.lastIdsResponseAt`: el `lastAttemptAt` existente. Conserva su significado y
  uso para prioridad: respuesta satisfactoria de la primera página reciente, no inicio de intento.
- `lastAttempt`: última **fase** iniciada para el jugador, con fase, inicio, final y
  resultado `running/success/partial/failed`. Null significa desconocido. No sustituye
  el resultado global de `sync_locks`. `running` acredita un inicio, no un worker activo;
  una terminación abrupta puede dejarlo así para su diagnóstico posterior.
- `history`: estado y contadores actuales de temporada, última actividad histórica,
  fecha de finalización y cursor persistido. `processed/discovered` cuenta IDs procesados
  de los descubiertos hasta ahora, no porcentaje de temporada ni número de partidas válidas.
  El cursor incluye su temporada almacenada, que puede ser anterior a la actual antes del reset.
- Cada fase tiene un error independiente con fecha, código HTTP/deadline/internal,
  paso y mensaje seguro. Los fallos de identidad/summoner previos a LEAGUE-V4 pertenecen
  a la fase rank, identificados por `step`; no prueban una comprobación del rango.

Se añaden solo cinco columnas nullable, sin defaults: `rank_checked_at`, `rank_error`,
`recent_error`, `backfill_error`, `last_sync_attempt`. Las tres columnas de error y el
intento son JSONB con tipos explícitos; se reutilizan todas las marcas y cursores existentes.
No se reconstruye evidencia previa. Un error null con comprobación/intento desconocido
no certifica éxito. Los estados históricos y coberturas ya existentes se conservan.

## Escrituras y recuperación

El inicio conserva todos los errores. Solo el éxito completo de una fase limpia su
propio error. Un resultado parcial por cupo no borra un error anterior pendiente;
su fecha permite distinguirlo del último intento. Un deadline se registra como
`partial` con código `deadline`; el estado histórico sigue siendo reanudable.

La verificación del rango y su resultado se guardan en la transacción de snapshots;
un fallo en recientes no los revierte. La cobertura reciente y su éxito se escriben
juntos. La finalización histórica y su éxito se escriben con el cierre del cursor.
Las transacciones participación + cursor y las restricciones de unicidad se mantienen.
Los resultados de servicios/rutas y el resultado global siguen teniendo su contrato anterior.
El retorno `partial` del modo interno rankOnly se conserva; el intento de rango puede
ser `success` porque esa fase sí terminó.

No se cambian pacing, retries, lease, presupuestos ni orden entre jugadores/fases.
Se añaden escrituras de metadata, por lo que hay un pequeño coste SQL adicional.

## Transición de syncError

`sync_error` permanece para los lectores actuales. Un fallo nuevo refleja su mensaje
en este campo y en la columna de la fase. Al resolverlo, se conserva como resumen
el mensaje de otra fase pendiente (prioridad rank/recent/history). Nunca se borra el
error independiente de otra fase. Los parciales conservan el resumen anterior.

Un mensaje anterior a la migración no puede atribuirse con certeza a ninguna fase.
Se conserva sin copiarlo a una fase ni inventar su fecha. Puede requerir revisión del
operador en 03.B.3; no se limpia automáticamente solo porque nuevos intentos terminan.
Un fallo nuevo puede reemplazar ese resumen único, como en el contrato anterior;
`sync_error` no constituye un registro duradero de todos los errores pasados.

Será seguro retirar `sync_error` únicamente cuando todos los lectores y escritores
usen el nuevo contrato, no queden deployments antiguos activos y los mensajes legacy
sin clasificar hayan sido revisados. Esa retirada necesitará una migración posterior
explícita; esta entrega no elimina columnas ni modifica consumidores existentes.

## Despliegue: expandir antes de publicar el código

La migración generada `drizzle/0005_player_sync_states.sql` contiene únicamente cinco
`ALTER TABLE ... ADD COLUMN` nullable. No tiene UPDATE, DELETE, cambio de defaults,
reconstrucción de timestamps ni cambios de constraints. Fue probada con filas previas
en PostgreSQL efímero local; no se aplicó en Neon.

1. Tras autorización, revisar el SQL exacto y verificar el destino Neon **staging**
   mediante el panel, sin imprimir credenciales. Confirmar historial de migraciones.
2. Aplicar la migración con el procedimiento habitual en staging **antes** del deploy.
   Las columnas admiten null y el código anterior sigue funcionando. ALTER TABLE toma
   un bloqueo breve: elegir un momento sin sincronización activa y verificar su finalización.
3. Comprobar columnas, filas previas intactas y nuevos valores null. No rellenarlos
   retroactivamente ni inferir éxitos de `updated_at`.
4. Solo entonces hacer el push autorizado y desplegar Vercel Preview; si el push
   activa automáticamente el deploy, el SQL debe haberse aplicado antes. Las selecciones de
   filas completas de Drizzle dependen del esquema nuevo: desplegar antes del SQL falla.
5. Con autorización independiente, validar futuras sincronizaciones reales y la
   lectura de los tres estados. El código viejo durante la transición no escribe
   metadata nueva: un null sigue siendo desconocido, no ausencia de fallo.

Rollback de aplicación: volver al código previo conservando las columnas aditivas.
No revertir destructivamente la migración. Production queda fuera de esta fase.

## Pendiente para 03.B.3

Exponer el contrato en administración, mostrar fases/progreso/errores y legacy sin
clasificar, y añadir reintento individual independiente de un backfill completado.
La UI pública mantiene su etiqueta actual hasta que se reemplace explícitamente.
Scheduler, fairness, presupuestos y recuperación del lease quedan para tareas posteriores.
