# Fase 03.B.5 — UX y espera de sincronizaciones

## Auditoría y cambios

- `/admin`: Actualizar todos estaba debajo del formulario completo de alta. Se mueve a
  la cabecera como acción principal; el alta es un detalle expandible, abierto si el
  roster está vacío o hay un error de sus campos. Cuenta activos/pausados visible.
- Global, individual y backfill: el aviso y los botones repetían Procesando sin acción
  ni reloj. Ahora el bloque de feedback identifica acción/jugador, tiene spinner y barra
  indeterminada, reloj local y mensajes de espera. Permanece visible al desplazarse.
- Resultados: se separan éxito, pendientes, errores reales, cooldown y respuesta perdida.
  Recientes completos con histórico pendiente es un resultado con pendientes; un error
  histórico sigue visible sin negar la cobertura reciente. No hay reintentos automáticos.
- Error de conexión: el texto previo sugería reintentar suponiendo que la solicitud no
  llegó al servidor. Ahora indica resultado sin confirmar y revisar diagnósticos primero.
  También se aplica a una respuesta 2xx no JSON/perdida; no se anuncia éxito sin respuesta.
- Diagnóstico: mantiene rango, cobertura y estado histórico arriba; fechas exactas,
  códigos, errores legacy y cursor siguen en detalles. El resultado global local se
  puede desplegar. IDs procesados/descubiertos son contadores, nunca porcentaje de temporada.
- Acciones: Actualizar jugador y Continuar/Reintentar historial tienen textos/iconos
  distintos. Seguimiento muestra activo/pausado. Eliminar tiene texto, color destructivo,
  separación y confirmación existente con foco inicial en Cancelar. Su espera también
  aparece dentro del modal; el background inerte no es su único feedback.
- Móvil: botones administrativos de al menos 44 px y acciones en dos columnas; el resumen
  se organiza en filas etiqueta/estado. Escritorio conserva estadísticas y acciones en
  horizontal, sin nueva cuadrícula de tarjetas ni cambios de identidad visual.
- Público: navegación, pestañas, perfiles y métricas ya tenían estados y semántica útiles.
  No se rediseñan. Se corrigen únicamente botones compartidos de 40 px, limpiar búsqueda
  de 40×40 y controles móviles de ordenación a un mínimo de 44 px; búsqueda/región a 46 px.
  Se conservan leaderboard, queries, gráficos, fixtures y datos ficticios.

## Qué acredita el indicador

El inicio acredita una activación local aceptada por el guard de acciones, no un inicio
confirmado del worker. El tiempo es el reloj local desde esa activación; un callback cada
segundo recalcula desde Date.now y se retira al finalizar/desmontar. Cambiar de acción
reinicia el reloj. Animación no equivale a avance. Los mensajes cambian en tres etapas,
sin heartbeat ficticio, porcentaje, total definitivo ni predicción de finalización.

Una respuesta HTTP y su contrato existente acreditan el resultado informado por el
servidor. Un fetch fallido o cuerpo perdido no acredita cancelación; el servidor pudo
guardar progreso o completar el trabajo. Una recarga no retoma ese contador ni recrea
una operación: muestra los estados persistidos y el lease observado al cargar. Los
detalles conservan las advertencias de intento posiblemente interrumpido/obsoleto.

No se implementa progreso real ni polling: el lease actual no correlaciona cada acción
individual con un run ID y los intentos por jugador conservan solo la última fase. El
resultado global es independiente de las acciones individuales. Atribuir estos campos
como avance de la solicitud actual o reconstruir un batch completo sería impreciso.
No se cambia schema, presupuesto, RiotClient, scheduling, lease, ingesta o deduplicación.

## Accesibilidad y validación

- Status polite para inicio/etapas/resultados; errores reales en alert. El reloj usa
  timer con aria-live off fuera del status para no anunciar cada segundo. Progressbar
  sin aria-valuenow y con etiqueta indeterminada; spinner decorativo aria-hidden.
- El guard síncrono bloquea una segunda activación antes del siguiente render y libera
  al finalizar, incluso ante errores. Controles conservan foco con aria-disabled y guards;
  seguimiento pausado deshabilita las sincronizaciones del jugador. Select de alta se
  deshabilita durante una acción. No se modifica la política del lease compartido.
- Se conserva foco visible y navegación por teclado. Colores semánticos tienen texto e
  iconos. Reduced-motion elimina spinner/movimiento y usa una banda estática completa,
  evitando que una fracción inmóvil parezca un porcentaje real.
- Regresiones de runner/request/avisos/reloj y render accesible. Suite existente sigue
  verificando DEMO_MODE, auth, diagnósticos, lease, scheduling y ausencia de DB/Riot en demo.
- QA de navegador con `/dev/admin` existente en copia aislada sin .env/credenciales y
  guardia de red: escritorio y móvil, objetivos de 44 px, sin overflow horizontal,
  feedback inmediato/bloqueo, rechazo demo y modal con Cancelar enfocado. Se usan fixtures
  existentes; no se modifican ni se inicia una sincronización real. Capturas locales en
  `artifacts/admin-ux-desktop.jpg` y `artifacts/admin-ux-mobile.jpg` (fuera de Git).

Validación final: `npm run lint` y `npm run typecheck` aprobados; `npm run test`
aprobado con 294 pruebas en 22 archivos. Vitest requirió permiso para crear procesos
fuera del sandbox. La primera suite concurrente con el build tuvo tres timeouts en
pruebas existentes de demo; la repetición sin tareas paralelas pasó con el timeout
normal de 30 s, sin cambiar pruebas ni configuración.

`npm run build` aprobado mediante `node scripts/validate-production-demo.mjs`, en
copia aislada con Node 24, sin archivos de entorno ni los cinco secretos. También
pasaron sus controles HTTP de demo y administración bloqueada; la guardia de red no
detectó conexiones a PostgreSQL o Riot autenticado. No valida Vercel Preview remoto.

## Propuesta posterior: seguimiento real, requiere autorización

Para correlacionar recargas y operaciones individuales, una ampliación revisable del
lease podría guardar un JSON nullable de último run: run ID opaco, acción, jugador
interno opcional, fase, inicio/último checkpoint/finalización, resultado y contadores.
Sería una migración aditiva Drizzle y cambios limitados en lease/servicios; no se aplica
en esta entrega. Mantener compatibilidad con filas existentes (null desconocido).

Escribir checkpoints únicamente tras transacciones verificadas (rank persistido,
cobertura completa, participación+cursor histórico), con comparación de propietario.
No actualizar por cada heartbeat artificial ni duplicar locks. Los contadores deben
distinguir visitados, completos, pendientes y errores; histórico descubierto no es total.

Un GET administrativo autenticado, no-store, nunca iniciaría trabajo y devolvería un
DTO sanitizado sin owner, PUUID o secretos. Leer el último run con una consulta acotada;
poll serial cada 15 s solo mientras visible y en espera, con backoff de red, pausa al
ocultar, cancelación de lecturas al desmontar y sin reintentar mutaciones. Un run ID
distinto debe invalidar la atribución, y lease vencido sin finalización indica posible
interrupción, no éxito. Pruebas de auth/demo, recarga, obsolescencia, 429, interrupción,
checkpoint atómico y no interferencia con budgets antes de validar en Preview autorizado.
