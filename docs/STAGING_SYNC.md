# Sincronización reciente y scheduler de staging

## Dos fases, una sola conexión lógica a Riot

El cron y Actualizar todos usan el lease PostgreSQL existente, un cliente Riot serial,
pacing mínimo de 1300 ms, presupuesto global de 230 s y máximo HTTP declarado de 300 s.
No configurar otro consumidor de la misma clave que ignore el lease.

1. **Recientes:** identidad, summoner y ranked; después una ventana independiente de
   `scan_*`. Inicio: `lastSyncedAt - 24 h`, acotado al inicio de temporada. Sin cobertura
   previa: `createdAt - 24 h`, de modo que el inicio no se mueve entre reintentos.
   El corte superior es el reloj actual menos dos minutos, redondeado a segundos y
   acotado al fin de temporada. Cada jugador puede añadir hasta cinco participaciones
   nuevas por pasada. Las ya guardadas no consumen ese cupo ni se vuelven a descargar.
   Modos excluidos y 404 no consumen el cupo, aunque sus requests sí consumen tiempo.
2. **Historial:** solo después de recorrer la pasada reciente, y si todavía hay tiempo.
   Retoma `scan_start/end/offset/pending/exhausted`, hasta 25 IDs por jugador. Prioriza
   backfills con `backfillUpdatedAt` antiguo, sin cambiar la prioridad de recientes.
   No se vuelve a recorrer normalmente una temporada cuyo backfill ya terminó.
   Se conservan también incrementales ya congelados y se reparan huecos antiguos
   anteriores al overlap reciente: el antiguo `lastSyncedAt` podía indicar una
   finalización mucho posterior al `scanEnd` cubierto. Esto usa el cursor existente,
   sin reiniciar la temporada ni cambiar marcas recientes.

MATCH-V5 sigue importando exclusivamente `STANDARD_QUEUES`, map 11 y modo CLASSIC.
El historial cubre la temporada; 7d/30d siguen siendo filtros de consulta. Los snapshots
ranked siguen siendo observaciones Riot reales, independientes del backfill.

## Marcas de tiempo y resultados

- `lastAttemptAt`: Riot devolvió correctamente una página de IDs recientes, incluso
  vacía. Un deadline anterior a esa respuesta no baja la prioridad del jugador.
- `lastSyncedAt`: corte superior cuya ventana reciente se recorrió completamente.
  Ni cupo agotado, página pendiente, deadline ni error lo avanzan. Un backfill tampoco.
- `rankCheckedAt`: última respuesta oficial LEAGUE-V4 persistida, incluso sin cambios
  de LP. Los errores de rango, recientes e histórico se guardan por separado, junto
  con el último intento de fase. Contrato, transición de `syncError` y despliegue
  aditivo antes del código: [PLAYER_SYNC_STATE.md](PLAYER_SYNC_STATE.md).
- `lastSuccessfulSyncAt`: fin de una ejecución global con todos los jugadores
  elegibles completos en recientes. Puede avanzar con historial todavía pendiente.
- `lastOutcome`: `running`, `success`, `partial` o `failed`. `partial` indica recientes
  incompletos por cupo/deadline; `failed`, errores en recientes.
  Un error o deadline exclusivamente histórico se reporta en `backfill` y no invalida
  la cobertura reciente. Trabajos individuales no modifican el éxito global.

El JSON conserva `results` por jugador y añade `outcome`, `recent` y `backfill`.
`recent.eligible/complete/pending/errors` son los contadores operativos; `visited`
cuenta llamadas al jugador, no garantiza una respuesta Riot. `pending` incluye
incompletos, errores y jugadores que no llegaron a ejecutarse. El deadline global
limita la pasada; quienes quedan fuera conservan prioridad y el resultado es parcial.
El backfill incluye resultados y contadores propios. HTTP 200 no implica éxito total.

Al reintentar, se vuelve a paginar recientes desde su inicio con un nuevo corte estable
para esa llamada. Las participaciones persistidas permiten continuar sin un cursor nuevo.
Exactamente 100 IDs exige consultar otra página. La cobertura solo se confirma al
agotar toda la lista. El historial mantiene sus transacciones de participación + cursor.
No hay cambio de schema ni migración.

401/403/429 en recientes abortan la ejecución como antes. El cliente respeta retries
acotados y `Retry-After`; el lease conserva cooldown incluso si el 429 aparece en
historial después de completar recientes. No hay retries externos inmediatos.
Un deadline reciente termina parcial sin iniciar historial; uno histórico conserva
el éxito reciente. Al agotar el cupo reciente se continúa con el siguiente jugador.

## Elegir scheduler sin tocar Production

RC1 elimina el cron diario de `vercel.json`: Production será una demo sin sincronización.
Las invocaciones residuales en demo devuelven `skipped` antes de consultar secretos.
Vercel Cron no programa Preview; su eliminación no altera un scheduler externo de staging.
`LADDER_SCHEDULER_ENABLED` solo informa a la UI: no crea trabajos.

No añadir un workflow scheduled únicamente a `staging`: GitHub ejecuta `schedule`
solo desde la rama por defecto. Si la rama por defecto de SoloQ es `main`, ese archivo
no resolvería el problema. No modificar `main` ni la rama por defecto de SoloQ.
[Referencia de GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

Opciones manuales:

- **cron-job.org**, si la cuenta permite timeout de al menos **300 segundos**.
  Su límite estándar es 30 s y no sirve para observar esta operación síncrona completa.
  Confirmar el límite permitido antes de activarlo; configurar request timeout 300 s,
  método GET y headers personalizados. No confiar en que la función seguirá trabajando
  correctamente después de que el scheduler corte la conexión.
  [FAQ](https://cron-job.org/en/faq/) y [campo requestTimeout](https://docs.cron-job.org/rest-api.html).
- **Un repositorio privado separado de automatización**, con workflow en su propia rama
  por defecto, secretos de Actions y un cliente HTTP que espere 300 s. No necesita
  checkout ni modificar ninguna rama de SoloQ. Usar cron cada 10 minutos, preferiblemente
  minutos 3/13/23/33/43/53; `workflow_dispatch` para la prueba manual y concurrencia de
  un solo job sin cancelar ejecuciones en curso. Los schedules son best effort.
- Otro servicio externo equivalente con headers secretos y timeout suficiente.

## Configuración manual del Preview

1. Desplegar el commit de `staging` a Vercel Preview y verificar que usa Neon staging,
   `DEMO_MODE=false` y una clave Riot válida para el entorno privado. Confirmar el timeout
   efectivo de Functions. No cambiar variables ni cron de Production.
2. Usar una URL de Preview que corresponda a la rama `staging`, preferiblemente su alias
   estable; añadir `/api/cron/sync`. No usar el dominio de Production ni un deployment
   antiguo. No guardar secretos en la URL.
3. En Vercel, Environment Variables: configurar/verificar `CRON_SECRET` **solo para
   Preview de staging** (mínimo 32 caracteres aleatorios); redeployar si se cambia.
4. En Settings → Deployment Protection → Protection Bypass for Automation, crear un
   bypass para este runner. Vercel requiere permisos adecuados; el secreto es de proyecto
   y puede permitir bypass de otros deployments del proyecto. Guardarlo solo en la
   configuración segura del runner; no abrir públicamente el Preview ni modificar la
   protección/variables de Production. Si se cambia el secreto automático, redeployar
   Preview según las instrucciones de Vercel.
5. Guardar en el scheduler: URL de staging y dos valores secretos. Configurar los headers:
   `Authorization: Bearer <CRON_SECRET>` y
   `x-vercel-protection-bypass: <VERCEL_AUTOMATION_BYPASS_SECRET>`.
   Nunca hardcodearlos en workflows/scripts, usar query params, imprimir headers,
   activar trazas HTTP ni guardarlos en `.env.local` o Git.
6. Ejecutar manualmente con esos headers y timeout de 300 s. Confirmar respuesta JSON
   de SoloQ, no HTML de login ni redirect. Revisar `outcome`, `recent` y `backfill`, no
   solo el código HTTP. 401: Bearer inválido; 409: lease/cooldown; 503: error Riot
   propagado; errores de clave requieren renovación. No reintentar en bucle.
7. Programar cada 10 minutos (o 15 si hace falta) y comprobar varias rondas reales en
   scheduler, Functions y Neon staging. Alertar fallos de transporte/autenticación y
   `recent.errors`/`backfill.errors`; vigilar pendientes que no disminuyen.
8. Solo después de comprobarlo, establecer manualmente
   `LADDER_SCHEDULER_ENABLED=true` **en Preview de staging** y redeployar Preview.
   El contador conserva su objetivo de diez minutos; con scheduler de quince puede
   mostrar retraso temporal antes de la siguiente ronda.

[Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation).

## Checklist de validación manual

- Verificar `recent.complete/pending` y `players.last_synced_at` en varias rondas para
  todos los habilitados. El timestamp representa cobertura y queda unos minutos atrás.
- Jugar una partida compatible con un jugador que tenga `backfill_status=running`;
  comprobar que aparece tras una ronda reciente sin terminar su historial.
- Confirmar que el historial avanza con presupuesto sobrante: crece processed o cambia
  pending/offset; `scan_end` conserva la ventana mientras se procesa. No toca
  `last_attempt_at` ni `last_synced_at`.
- Comprobar recuperación de parciales: no atendidos conservan prioridad, incompletos
  siguen importando sin duplicados y su marca no avanza hasta cubrir todas las páginas.
- Distinguir `success` con `backfill.pending > 0` de `partial` con `recent.pending > 0`.
- Ante 429, comprobar cooldown y esperar la siguiente ronda. No forzar requests paralelos.
- Confirmar que la tabla muestra el aviso de nuevos resultados y se actualiza por acción
  del usuario; no se reordena automáticamente. Revisar frescura de perfil/admin/métricas.
- Si aparecen volúmenes de IDs excluidos o huecos 404 que consumen reiteradamente todo
  el presupuesto, revisar logs y coste antes de aumentar frecuencia. No prometer frescura
  de todos en una sola ejecución ante backlog o fallos de Riot.
