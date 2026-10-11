# Continuación individual desde administración

## Diagnóstico y diseño

Base: `f22da505a2418dd4d60f855aa09543a9e39926a7`. El backfill actual limita cada
lote a 25 IDs y RiotClient mantiene al menos 1300 ms entre despachos, con timeout
HTTP de 10 s y tres intentos. El endpoint histórico ejecuta primero rango y
recientes. La pasada global asigna 20 s / 6 despachos por turno histórico. Son
límites de SoloQ, no cuotas oficiales de Riot. Sin logs no se acredita que la
lentitud observada provenga de 429, latencia de Riot o PostgreSQL.

Se reutilizan el endpoint individual, importHistory, cursores, unicidad y lease
compartido `riot`. Una opción explícita solicita solamente histórico de la temporada
actual; el comportamiento manual anterior permanece compatible. La continuación
desde el navegador espera el resultado correlacionado, respeta el cooldown y se
detiene ante incertidumbre, sesión inválida, error permanente o límites de sesión.
No hay scheduler, cron, worker, autoinvocación ni promesa de trabajo en segundo plano.

## Persistencia mínima implementada, sin migración

El JSON existente `sync_locks.run_progress` admite campos opcionales compatibles
con los registros anteriores: instante de espera Riot y último Match ID confirmado
del trabajo histórico. El ID se registra después de confirmar la transacción de
partida/cursor, aprovechando el flush existente (15 s y final de fase). No se guarda
un ID actual: no existe telemetría que acredite el despacho en curso. No se añaden
tablas, columnas ni transacciones por ID para animar la barra.

Un 429 persiste inmediatamente la espera sobre el mismo lease y conserva su
exclusión hasta al menos Retry-After, incluso si el proceso se interrumpe. Por
desconocerse el alcance de la cuota, se bloquea conservadoramente todo el trabajo
Riot de SoloQ. La duración de trabajo y los presupuestos globales no aumentan.

La barra expresa procesados / IDs descubiertos, nunca cobertura anual. Durante
descubrimiento incompleto o contadores desconocidos es indeterminada. `processed`
incluye IDs ya almacenados, excluidos y 404; no equivale a partidas recuperadas.
`unavailable` cuenta detalles 404. Nuevas participaciones guardadas en la ejecución
son una métrica separada. Nuevos IDs pueden aumentar el denominador.

## Operación y límites

En `/admin`, un jugador activo con histórico pendiente ofrece «Continuar historial
automáticamente». El POST existente recibe `{ historyOnly: true, season: "2026" }`
y una correlación opaca nueva por lote. Autenticación, origen, validación de UUID,
temporada vigente y lease permanecen obligatorios. Sin este cuerpo, el botón manual
conserva su operación anterior. El modo nuevo nunca solicita rango ni recientes;
si la temporada ya está completada, no inicia una reparación incremental.

El navegador espera que termine el POST y que el GET autenticado confirme la misma
ejecución, jugador y temporada. No usa la respuesta HTTP como prueba del avance.
Mantiene el polling existente (15 s durante ejecución, pausado en pestaña oculta),
con un mínimo de 5 s entre continuaciones y el cooldown compartido como límite.
Cada petición conserva los 230 s de trabajo y 25 IDs; no se modifican los turnos
ni presupuestos de Fair Scheduling. El POST del navegador tiene timeout de 310 s:
si pierde la respuesta, observa el resultado persistido antes de decidir.

Paradas: finalización según cursor, 100 lotes, una hora, tres lotes consecutivos
sin incremento confirmado, jugador pausado, rechazo de sesión/origen, 401/403
de Riot, error permanente o resultado no correlacionado/interrumpido. Los 5xx
confirmados admiten tres reintentos de lote con 15/30/60 s más jitter de hasta
999 ms; consultar repetidamente no desplaza ese plazo. RiotClient conserva tres
intentos por petición, pacing mínimo de 1300 ms y añade jitter acotado a su backoff
de red/5xx. Un error de red del POST no autoriza repetir una mutación desconocida.
Los parciales por presupuesto pueden continuar desde el checkpoint.

`Retry-After` válido se respeta (segundos o fecha); ausente/inválido utiliza 60 s.
La espera se persiste inmediatamente con el propietario/revisión vigentes sobre
el lease existente. Se extiende su vencimiento si la espera lo supera. Tras terminar
se conserva un cooldown al menos igual a la espera restante. No se añaden locks.
Si PostgreSQL no permite confirmar esta escritura, la llamada falla sin reintentar;
no se promete persistencia durante una caída de la base. Un proceso interrumpido
puede mantener el lease hasta su vencimiento, conservadoramente.

«Detener continuación automática» cancela nuevas peticiones; no cancela una
transacción/lote ya aceptado por el servidor. Volver a la pestaña consulta primero
el estado. Recargar/cerrar solo recupera observación y checkpoints, nunca reactiva
la automatización. Se requiere otra activación explícita. No se guarda este permiso
en cookies, URL ni sessionStorage. No existe un feature flag nuevo; el flag de Logros
no cambia y Demo conserva su bloqueo anterior a cualquier conexión PostgreSQL/Riot.

## Qué garantiza la barra

Actualización **por checkpoint** (flush aproximadamente cada 15 s cuando existe
avance) y **al finalizar el lote**; no se anima ni publica una transacción adicional
por cada ID. El GET sigue haciendo una sola lectura de `sync_locks`, sin consultar
matches ni Riot. Se muestra posición confirmada, pendientes `discovered - processed`,
404, participaciones nuevas de esta ejecución, último checkpoint y último ID
confirmado si fue registrado por esta versión. JSON anteriores funcionan sin esos
campos; se presentan como desconocidos. El ID en curso siempre es desconocido:
la arquitectura actual no acredita su despacho. No se calcula `processed + 1`.

El porcentaje solo aparece con contadores coherentes y descubrimiento agotado.
Durante el descubrimiento se muestran los contadores disponibles con barra
indeterminada. Ni 100 % ni `completed` prueban exhaustividad de Riot. El último
Match ID es un identificador regional validado, no un número secuencial de posición;
el DTO no contiene PUUID, claves ni credenciales.

## Validación y límites de la evidencia

Regresiones del controlador con reloj simulado: serialización, correlación, cierre,
parada, pestaña oculta, 429, 5xx, pérdida de respuesta, presupuesto y límites de sesión.
PGlite prueba el endpoint real con Riot simulado: cursores entre dos lotes,
deduplicación, exclusión de dos pestañas, rechazo de temporada/pausa y espera larga
compartida persistida antes de finalizar. No son pruebas contra Neon ni contra Riot.
Los tests anteriores de leases, recuperación, estados, Demo y feature flags continúan.

QA visual local con SSR de los componentes reales y datos ficticios a 320 y 390 px:
sin desbordamiento de contenido visible; control automático con altura de 50 px,
progreso nativo con nombre accesible y foco visible en «Detener». Axe no detectó
violaciones en esta muestra; contraste quedó como comprobación incompleta. Es una
página estática aislada, no una sesión administrativa hidratada de Preview ni una
certificación de accesibilidad. La operación real autorizada, latencias Neon/Riot,
expiración de sesión y comportamiento de Vercel quedan para la validación posterior.

Exportación visual opcional: definir `BACKFILL_VISUAL_DIR` únicamente para ejecutar
`tests/auto-backfill.test.tsx`, apuntando a un directorio local fuera del commit.
No necesita secretos, un servidor Next ni conexiones remotas.

## Publicación y reversión futura

No hay migración ni cambio de variables requerido. Publicar en staging solo con
autorización posterior, validar Preview sin activar sincronizaciones involuntarias.
Reversión: volver al código anterior mediante el flujo Git autorizado; campos
opcionales del JSON se ignoran por el parser anterior. La espera ya persistida en
el lease conserva su vencimiento incluso con código anterior. No borrar cursores,
datos históricos ni el registro del lease para acelerar una reanudación.

## Verificación local de esta entrega

Node 24.19.0. `npm run lint`, `npm run typecheck` y `npm run test` correctos:
836 pruebas aprobadas y 10 omitidas (PostgreSQL local opcional). PGlite sí ejecutado.
`npm run build` y smoke HTTP correctos mediante el validador existente
`node scripts/validate-production-demo.mjs`: copia aislada sin `.env`, cinco secretos
ausentes y guardia que prohíbe conexiones PostgreSQL/Riot. No se validó Preview.

Archivos de esta implementación:

- `src/app/api/admin/players/[id]/backfill/route.ts`
- `src/app/globals.css`
- `src/components/admin-panel.tsx`
- `src/components/admin-backfill-progress.tsx`
- `src/components/use-admin-progress.ts`
- `src/lib/admin-operation.ts`
- `src/lib/admin-progress-polling.ts`
- `src/lib/auto-backfill.ts`
- `src/lib/sync-progress.ts`
- `src/server/riot/client.ts`
- `src/server/sync/history.ts`
- `src/server/sync/lease.ts`
- `tests/auto-backfill.test.tsx`
- `tests/database.test.ts`
- `tests/riot-client.test.ts`
- `docs/INDIVIDUAL_BACKFILL.md`
