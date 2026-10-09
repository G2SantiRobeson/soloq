# Fase 03.B.4 — planificación justa y acotada

## Auditoría del código previo

- `syncAllPlayers` ya separaba recientes e histórico, usando un cliente serial y un
  lease PostgreSQL. Recientes importaba hasta cinco participaciones nuevas por jugador;
  histórico procesaba hasta 25 IDs con cursor persistido. No había que reemplazarlos.
- El orden reciente dependía de `lastAttemptAt`, escrito solo tras una respuesta de IDs.
  Fallos de identidad, summoner o rango no rotaban esa prioridad. El desempate carecía
  de ID estable. Era posible repetir los primeros jugadores sin ofrecer turnos al resto.
- Los detalles excluidos/404 y páginas ya guardadas no consumían el cupo de cinco
  participaciones: podían consumir el deadline global antes de llegar a otros jugadores.
- Histórico solo se iniciaba si toda la pasada reciente había sido visitada. Un backlog
  reciente persistente podía privar indefinidamente al histórico de oportunidades.
- El lease expiraba a 285 s frente al máximo HTTP declarado de 300 s: existía un intervalo
  potencial de solapamiento si SQL o el worker se prolongaban. No se observó un incidente
  real; esto es un riesgo identificado en el código, no una causa operacional acreditada.
- Cursores históricos, transacciones y deduplicación ya eran reanudables. El cliente
  ya tenía timeout de 10 s, tres intentos, pacing y Retry-After. Se conservan.

## Política

Una ejecución global serial conserva 230 s de presupuesto Riot. Primero ofrece turnos
de rango/recientes durante hasta 180 s, cada uno con 30 s y 12 despachos HTTP máximos.
Después ofrece turnos históricos, cada uno con 20 s y 6 despachos, usando el resto del
presupuesto global. Una pasada reciente corta deja más tiempo al histórico; una larga
no debe consumir su reserva nominal de 50 s. No hay cupo fijo de jugadores por ronda.

Los despachos incluyen reintentos, IDs y detalles excluidos/404. Son presupuestos de la
aplicación, no cuotas oficiales. El límite anterior de cinco participaciones recientes
y 25 IDs históricos permanece como un segundo límite. El mismo cliente retiene pacing
y backoff al cambiar de turno; no hay concurrencia ni un segundo lock.

Recientes usa la última oportunidad verificable entre `lastAttemptAt`, `rankCheckedAt`,
fechas de errores rank/recent y el inicio de la última fase no histórica. Ordena de más
antigua a más nueva, con desempate por cobertura, creación e ID. Un jugador intentado,
incluso si falla antes de IDs, rota detrás de los no atendidos. La actividad histórica
no cambia esa prioridad. Historial usa `backfillUpdatedAt`, creación e ID. Se mantienen
la elegibilidad estacional, la reparación legacy y los incrementales congelados.

Solo se escriben intentos realmente iniciados; los no atendidos no pierden prioridad.
Los pausados quedan excluidos. Los cambios administrativos de seguimiento comparten
el mismo lease. La política garantiza oportunidades sucesivas si el scheduler sigue
ejecutándose y Riot/base permiten trabajo; no garantiza cobertura completa ante fallos.

## Recuperación y observabilidad

`SyncBudget` registra un parcial con `pendingReason` opcional en el JSON existente.
No crea error nuevo, no limpia errores previos y no avanza `lastSyncedAt` sin cobertura
completa. Las participaciones recientes guardadas y el cursor histórico continúan
siendo los checkpoints; no se reinicia la temporada ni se inventan datos de rango.

Los errores de red/timeouts/5xx siguen con reintentos acotados. Si una respuesta fallida
no puede reintentarse dentro del turno, conserva el error real. En particular 429 sigue
abortando la pasada reciente y guardando cooldown en el lease. En histórico detiene
los nuevos turnos y conserva el resultado reciente independiente. Se retiene backoff
incluso cuando el último intento lanza error. No se baja el pacing de 1300 ms.

JSON y logs enumeran los jugadores pendientes y motivos; `visited` mide turnos reales.
El panel muestra los motivos persistidos y la última respuesta global solicitada allí.
`recent.budgetPending` separa límites internos de `recent.errors`. Un batch parcial sin
errores mantiene `outcome:partial`, no `failed`. El éxito global sigue significando que
todos los recientes están completos, aunque histórico continúe parcial.

El único lease dura ahora 330 s, cubriendo el máximo HTTP de 300 s con 30 s de margen.
La liberación normal/cooldown sigue usando comparación de propietario, evitando que
un worker anterior libere un lease reemplazado. Tras una interrupción sin finally se
recupera al vencer. No se modifica ni configura el scheduler externo.

## Límites y validación pendiente en Preview

- La duración de SQL no tiene un deadline cancelable nuevo. Los 230 s acotan trabajo
  Riot y comprobaciones de bucle; el timeout efectivo del hosting debe ser de hasta
  300 s. Un proceso que sobreviva al vencimiento del lease no queda cercado en cada
  transacción. No se añade heartbeat ni otro sistema de locks en esta fase.
- No se persisten batches completos: los no atendidos se consultan en JSON/logs, y la
  respuesta del panel se pierde al recargar. Fechas y errores de fases sí son durables.
- Recientes repagina desde la cobertura anterior, reutilizando participaciones guardadas.
  Una larga cabecera de modos excluidos o 404 puede repetirse en sucesivas rondas y
  mantener ese jugador parcial, aunque ya no bloquee al resto. Histórico sí avanza
  mediante su cursor. Una solución durable para esas exclusiones requiere estudiar un
  checkpoint reciente o cache de exclusiones, sin certificar cobertura inexistente.
- Las pruebas locales usan PGlite, fetch simulado y reloj virtual, incluida una comunidad
  de 18 jugadores. No acreditan capacidad/latencia real, estado de la clave ni funcionamiento
  del scheduler. Tras publicación autorizada: observar varias rondas en Preview y revisar
  `visited`, motivos, crecimiento de processed/cursor, 429 y duración antes de ajustar límites.
- DEMO_MODE conserva el rechazo de sincronización antes de DB/Riot; fixtures y demo pública
  quedan intactos. No hay schema nuevo, migración, dependencias ni cambio de secretos.
