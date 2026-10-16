
# F5.R8 — Preferencia local y mecanismos anteriores

La elección manual es una preferencia del visitante, por perfil consultado, plataforma y modalidad.
Namespace: `soloq:rival:v1:<id público>:<plataforma>:<soloq|flex>`.
Valor: `{"version":1,"rivalId":"<id público>"}`. No incluye identidad autenticada, tokens ni datos de cuenta.
Los valores se normalizan y validan contra los candidatos actuales. Una elección obsoleta no se muestra;
se conserva hasta que el visitante la cambie o quite. Almacenamiento bloqueado: estado React de esa
visita, con aviso y sin persistencia tras recarga. SSR empieza sin elección y se hidrata con
`useSyncExternalStore`. El evento storage actualiza otras pestañas del mismo navegador.

## Auditoría de consumidores y retirada de escrituras

Antes: `ManualRival` enviaba POST a `/api/player/[id]/rival`; el perfil leía
`getManualRivalContext`. En Demo, `src/server/manual-rival.ts` usaba un mapa global;
fuera de Demo podía consultar/escribir `public.community_rivals` bajo MANUAL_RIVALS_ENABLED.

Ahora: el perfil usa `getLocalRivalOptions`, solo candidatos de rangos públicos.
La interfaz no llama a la API. El endpoint se conserva y responde 410, sin leer ni escribir
preferencias, independientemente de Demo o del flag antiguo.
El código servidor anterior, su propuesta SQL y cualquier registro previo se conservan.
No se borró, consultó ni migró información almacenada. El mapa anterior queda fuera de la ruta
pública y no se importa en la nueva interfaz.

La única referencia de ejecución al repositorio anterior es el test de persistencia local legado,
ahora opt-in MANUAL_RIVAL_LEGACY_PG_TESTS=true y excluido de esta validación.
Antes de integrar: decidir la retirada definitiva del módulo y de la propuesta SQL, tras revisar
posibles consumidores fuera de este worktree. No aplicar esa propuesta como parte de F5.R8.

## Enlaces y semántica

La URL tipo=elegida abre una comparación de dos IDs públicos; no crea ni copia una preferencia.
La elección local no se atribuye al jugador consultado, no modifica al rival automático y no se
convierte en una selección oficial. Perfil sin datos: comparación no disponible.
Los tiers/divisiones normales distintos no muestran coordenadas internas como LP.
Se conserva la excepción apex expresamente confirmada: diferencia directa de LP entre Master,
Grandmaster y Challenger, manteniendo sus categorías oficiales y sin umbrales de ascenso.

## Historial

La información detallada se renderiza una sola vez. Un botón aria-expanded/aria-controls controla
un panel oculto al inicio. En el grid, el panel ocupa ambas columnas en una segunda fila;
la primera conserva 60/40 y alineación superior. Los snapshots y los detectores no se modifican.
