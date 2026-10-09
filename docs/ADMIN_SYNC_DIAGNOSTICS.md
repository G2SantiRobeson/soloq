# Diagnóstico administrativo — Fase 03.B.3

`/admin` y `GET /api/admin/players` usan `getAdminPlayers()` y el adaptador existente
`toPlayerSyncState()`. Ambas consultas requieren sesión administrativa. La ruta GET
mantiene el array y campos anteriores y añade `syncState` y `legacyError`. La página
es dinámica y las respuestas JSON llevan `Cache-Control: no-store`.

Los registros solo se proyectan al cliente mediante una lista explícita de campos:
no se envía PUUID. Los errores tipados conservan código, paso y fecha, con mensajes
seguros derivados del código. El mensaje legacy sin coincidencia exacta con un error
de fase se muestra como error previo sin clasificar, sin enviar su texto arbitrario.
Esto no modifica ni limpia los errores almacenados. `syncError` sigue disponible como
resumen compatible y sanitizado; el contrato público permanece intacto.

El resumen separa verificación oficial del rango, corte de cobertura reciente y estado
histórico. Un dato null sigue siendo desconocido. El detalle muestra la última respuesta
de IDs, actividad y finalización histórica, intento y errores. Un error anterior al inicio
de la última fase registrada se etiqueta como anterior aún pendiente, sin atribuirle
éxito o fracaso de otra fase. Los contadores son IDs procesados entre los descubiertos
hasta ahora, nunca porcentaje de temporada. Una exploración completada con detalles
no disponibles se explica como tal.

`running` prueba un inicio sin finalización, no un worker activo. Transcurrida la duración
máxima del lease desde ese inicio se muestra posiblemente interrumpido. Antes de ese
límite, un lease vigente solo acredita ocupación compartida o cooldown: no identifica
al jugador ni prueba que ese intento esté ejecutándose. La evaluación usa la fecha del
servidor al cargar el panel, visible en el detalle. Recargar actualiza esa evidencia.

## Sincronización individual

`POST /api/admin/players/[id]/sync`, sin body:

1. Valida Origin mediante `verifyOrigin`, sesión, UUID, existencia y seguimiento habilitado.
2. Ejecuta `withSyncLease(client => syncPlayer(id, client))`, con los valores por defecto
   existentes: deadline 230 s, lease 285 s, lote reciente de cinco detalles y Riot serial.
3. No llama a `syncBackfillPlayer`, no mueve cursores ni usa callbacks de resultado global.
   El histórico completado no impide actualizar rango y recientes. El lease actualiza
   únicamente sus campos habituales de exclusión/cooldown; no el resultado global.
4. Tras terminar vuelve a leer el estado persistido sanitizado. Si el seguimiento dejó
   de estar habilitado antes de la lectura de `syncPlayer`, devuelve `skipped`.

Respuesta de operación:

```ts
{
  result: {
    playerId: string;
    status: "complete" | "partial" | "skipped" | "error";
    imported?: number; // solo cuando el servicio lo devuelve
    syncState: PlayerSyncState;
  };
  message: string;
  error?: string;
}
```

`complete` significa rango verificado y cobertura reciente completa; no certifica el
histórico. Presupuesto agotado y deadline son `partial` (HTTP 200), con mensaje explícito.
Un fallo previo a recientes conserva la fase rank e indica que no se alcanzó recientes;
un fallo reciente después del rango preserva su verificación. No se inventa el número
importado cuando el servicio termina lanzando una excepción.

Validaciones y lease ocupado usan las abstracciones actuales: 400 UUID, 401 sesión,
403 Origin, 404 inexistente y 409 deshabilitado/ocupado/cooldown. Estas respuestas previas
a ejecución llevan `{ error }`. Riot 404 devuelve 404; Riot 429 devuelve 429 y `Retry-After`,
después de que el lease persista el cooldown. Otros fallos Riot usan 503 como las rutas
existentes; errores inesperados, 500 sanitizado. Un reintento durante el cooldown devuelve
409 sin consultar Riot. No se cambia el lease ni el planificador global.

El panel conserva añadir, actualizar todos, continuar/reintentar historial, seguimiento,
eliminación y cierre de sesión. `Actualizar jugador` está disponible con seguimiento
habilitado, aun con histórico completo. Un ref bloquea acciones duplicadas inmediatamente;
el estado visible informa del tiempo de espera por Riot y el panel se refresca al terminar,
también tras errores. Los parciales se muestran con aviso, no como éxito completo.

## Validación y límites

Regresión mediante PGlite local y mocks de Riot/sesión: estados independientes y desconocidos,
legacy, intentos interrumpidos, seguridad, UUID, seguimiento, conflictos/cooldown, fallos,
deadlines, lotes parciales, cursor y otros jugadores intactos, resultado global conservado y
acciones anteriores. Pruebas de render verifican etiquetas y controles. `/dev/admin` y
`/dev/history` mantienen fixtures sintéticos restringidos a desarrollo para QA responsive.

No requiere migraciones adicionales. Depende de 0005, aplicada previamente en staging.
No se ejecutan sincronizaciones reales, migraciones ni pruebas contra Neon. La comprobación
real de la nueva operación en Vercel Preview requiere autorización posterior independiente.
Scheduler, observabilidad durable de workers y planificación global quedan fuera de esta fase.
