# E.2.2 — Captura MATCH-V5 en la sincronización

Estado: implementación local, no desplegada. Base: `c6cf4b82cd3f3037ade454860e574781fd5869e0`.
No autoriza grants, certificación, sellado operacional ni activación pública.

## Hechos implementados

### Frontera de recepción

`RiotClient.observeMatchIds` y `observeMatchDetail` llaman a los métodos existentes.
El punto de transporte registra cada intento de la petición observada: categoría,
UUID de captura, UUID de recepción y fecha de recepción **solo ante respuesta HTTP**,
status, validación y Retry-After efectivo. Red/timeout conservan el intento con
`receptionId` y `receivedAt` nulos. JSON, schema o normalización inválidos dejan
evidencia irresuelta; no permiten avanzar fuente/cursor como éxito.

El handle se confirma por identidad de objeto en un WeakMap privado de ese cliente,
vinculado a jugador, plataforma y PUUID en memoria. Copiar su UUID u objeto no
construye una recepción. No hay factoría pública, ruta ni `use server` que acepte
evidencia operacional desde el navegador. La procedencia depende de esta frontera
de servidor; no es una firma criptográfica ni una prueba independiente de Riot.

El transporte inyectado se etiqueta `synthetic`. Métodos sustituidos sin despacho
HTTP se etiquetan `unknown`/`unobserved`, sin fechas HTTP. El camino por defecto
con respuesta utiliza `server_riot_received` y exige lease vinculado al persistir.
Mockear globalmente fetch en un test no prueba autenticación de Riot.
No se amplían los contratos históricos de D/E.2.1 para aceptar fixtures como reales.

Se guardan parámetros efectivos, IDs originales (orden y duplicados), una proyección
mínima del detalle (partida, cola/mapa/modo, timestamp, cardinalidad del participante,
victoria/campeón y presencia/ausencia de indicadores de remake), versiones y estados.
No se serializan PUUID, tokens, cabeceras, URLs completas ni payloads Riot completos.
Los IDs reales recibidos deben corresponder a la plataforma. Las claves legacy
acotadas son referencias almacenadas, **no acreditación de identidad Riot**.
La base probatoria de remake sigue `unknown`; no se implementó E.2.3.

### Persistencia, revisión y fencing

`evidence-in-tx.ts` contiene el puerto común de builders PostgreSQL instalado,
compatible por asignación con PGlite y postgres-js, y la comprobación de cupos
compartida con D. La API local D conserva sus contratos y transacciones.
`match-evidence.ts` añade operaciones internas para abrir/recuperar scans, páginas,
disposiciones, reutilización, cierre observacional y proyección diagnóstica.

Estas operaciones usan la **misma transacción `syncWrite`**. No abren conexión,
transacción, savepoint, lease ni red; no acceden a DATABASE_URL ni incrementan R.
Se mantiene lease → match cuando corresponde → jugador(es) UUID → headers → units.
El lock del jugador serializa las mutaciones de su evidencia. Los headers existentes
se bloquean en orden UUID; las peticiones HTTP suceden fuera de esos locks.

Las units calculan `R_destino = source_revision + 1` en SQL bajo lock, convertido
desde texto a BigInt. Fuente, captura, disposición y cursor marcan cambios en E.1;
su flush incrementa **una sola vez por jugador/transacción**, incluso con dos colas
y varios INSERT de lote. Fencing inicial y final siguen intactos. Reintentar la
persistencia del mismo handle/contenido no añade unidades ni R. Una nueva petición
idéntica tiene otro requestId y conserva otro evento y su revisión.

Se comprueban owner, ámbito, versión, lifecycle, fingerprint y cadena causal al
extender evidencia. Los detalles resueltos se comparan con la participación y
partida almacenadas dentro de esa transacción. Recibir un detalle no basta para
afirmar `stored_and_compared`. Contradicciones de fuente no se sobrescriben.

### Scans y disposición

Cada raíz tiene scanId opaco propio, independiente del runId/owner del lease, ligado
a jugador, plataforma, cola, temporada, fase e intervalo congelado. Las consultas
de IDs no filtran cola: su misma recepción se proyecta en dos raíces ranked; cada
unidad conserva ámbito en columnas y FK. Las raíces de control tienen source
`unknown` porque abrir un scan no es recibir Riot; la procedencia efectiva está en
el record de cada unidad. Los IDs de recepción/captura compartidos identifican la
misma petición, mientras los IDs de unidad identifican sus proyecciones por cola.

Fases: `recent`, `season_backfill`, `incremental_repair`. Lifecycle:
`active` → `import_finished`, o `active` → `interrupted` cuando cambia la ventana.
Una raíz activa compatible se reutiliza. Dos activas para la misma fase/cola
producen error; no se elige silenciosamente la última. La metadata del intervalo
debe coincidir con las columnas. Los cursores de `players` siguen siendo la única
fuente del avance de ingesta; no se añadió un segundo cursor.

Al introducir capturas sobre un cursor antiguo con offset/pending/exhausted, se
registra `prefix_unknown`. No se reconstruyen páginas desde los contadores. Un
prefijo observado desde cero solo describe el comienzo registrado de ese scan.
No certifica cobertura de temporada ni estabilidad del índice del proveedor.

Estados efectivos por ID: `pending`, `resolved`, `excluded_with_basis`,
`unavailable_404`, `unknown`, `reused_without_attestation`. Los eventos originales
son inmutables; la proyección diagnóstica toma la última disposición causal,
sin destruir intentos anteriores. Páginas distintas al mismo offset conservan
ambas listas y `requires_review`. No seleccionan la favorable para certificación.

404 permanece un gap. Reutilizar una participación existente no inventa recepción.
Otra cola/modo/intervalo tiene exclusión con base; identidad o campos ambiguos
permanecen unknown. La importación observacional mantiene su política de temporada
y puede guardar datos fuera de la ventana particular si ya lo permitía history;
la captura conserva esa diferencia y no acredita cobertura de ese intervalo.

La página terminal es terminal **según la política de ingesta**, no un recibo completo.
`import_finished` puede coexistir con gaps, legacy o unknown. Los headers siguen
`collecting`: no se invocan prepareSeal/seal, no se declara scan_complete y siempre
se conservan `certification: "not_established"`, `grantAuthorized: false` y
`recoverableCoverage: "not_established"`.

### Puntos instrumentados

- Recent: apertura + página (también error); reutilización agrupada por página;
  detalle + participación en la misma SW; 404/error/exclusión con SW fenced mínima;
  cobertura + cierre observacional en una SW.
- History: apertura/recuperación + contexto; página + offset/pending/contadores en
  una SW; detalle/reutilización/404 + consumo de pending en una SW; errores
  temporales sin consumo del cursor; finalización + reset existente en una SW.
- Interrupción antes del commit: rollback. Después del commit: la fuente y el
  cursor conservan el avance; recuperar la raíz no fabrica nuevas recepciones.
  Un proceso muerto puede dejar una raíz active hasta que se recupere/cambie
  ventana: active no demuestra por sí solo un worker vivo.

### Política A y límites

Cupo/tamaño, ámbito, contradicción, storage, referencia o fencing fallidos revierten
la unidad completa, su fuente, evidencia, cursor y R. Checkpoints anteriores se
conservan. Los errores de captura/cupo tienen mensaje sanitizado en el contrato
existente de sincronización. No hay alternativa de pérdida durable ni truncado.
El servicio existente sigue aislando errores por jugador. Un límite permanente
requiere intervención; repetirlo no lo resolverá. No se añadió retry infinito.

Sin requests Riot adicionales ni cambios de scheduling, 230 s global, recent
180 s/turnos 30 s/12 requests, history 20 s/6 requests, pacing mínimo 1300 ms,
Retry-After, overlap 24 h, batch recent 5/history 25 o semántica lastSyncedAt.
La captura añade tiempo SQL dentro del presupuesto existente, sin ampliarlo.

Límites conservados: 64 KiB/header, 16 KiB/unit, 100 units/INSERT,
100.000 units/header, 32 MiB/header, 1.000 headers/player y 64 MiB JSON/player.
La estimación previa operacional duplica bytes JSON como margen conservador;
las restricciones PostgreSQL siguen siendo la última defensa. Puede rechazarse
un payload antes del límite físico, nunca truncarse para hacerlo pasar.

IDs reutilizados y pendientes se consultan/escriben por lote. Una página de 100 IDs
produce 101 units por cola, repartidas en INSERT 100+1 dentro de la misma SW.
Cada detalle confirmado añade una comparación SQL conjunta de fuente, no un
SELECT por campo/cola. Integridad carga antecedentes de los IDs afectados y
páginas para comparar intentos; cupos agregan JSON del jugador/header. Este costo
crece con la evidencia y debe medirse en staging antes de habilitar escrituras.
No se inventa latencia Neon ni se añaden umbrales dependientes de la máquina.

## Pruebas ejecutadas

Validación local del 12 de octubre de 2026 con **Node 24.19.0**, en secuencia:

- Focalizadas: cinco suites, 295 pruebas aprobadas, incluidas las 48 nuevas
  regresiones de captura e integridad.
- `npm run lint`: aprobado.
- `npm run typecheck`: aprobado, incluidos los puertos de ambos drivers sin casts.
- `npm run test -- --maxWorkers=2 --hookTimeout=60000`: **1.308 aprobadas,
  10 omitidas**, 57 suites aprobadas y dos opt-in omitidas; ningún fallo.
  Las omitidas requieren PostgreSQL local independiente: seis de lecturas
  consistentes de logros y cuatro de concurrencia del lease. No se habilitaron
  ni se usó Neon como sustituto.
- `node scripts/validate-production-demo.mjs`: aprobado; ejecutó `npm run build`
  en copia aislada sin archivos de entorno ni credenciales, y **40 comprobaciones
  HTTP**. Guard activo contra PostgreSQL y Riot autenticado, sin infracciones.

Las regresiones nuevas usan PGlite efímero y transporte simulado; no Neon.
Comprueban páginas 0/99/100, orden/duplicados e intentos contradictorios; 404,
red/timeout, 429/Retry-After, 5xx y validación; recepción inmutable, handles y
scopes; fuente/cursor/R atómicos; retries de persistencia frente a nuevas
peticiones idénticas; rollback por almacenamiento/cupo/overflow/conflicto/lease
y fencing final; prefijos legacy, gaps y cierre no probatorio; límites agrupados
y aislamiento Demo. No se aumentaron timeouts ni se añadieron skips.

## Garantías pendientes y despliegue

- PGlite demuestra SQL/constraints y rollback locales. **No demuestra concurrencia
  entre conexiones PostgreSQL reales**, deadlocks, latencia Neon ni recepción Riot
  autenticada. La clasificación del transporte es una frontera interna de código.
- E.2.3: identidad/LEAGUE y base compartida de remakes. E.3/F: materialización,
  reconciliación, autorización versionada y revisión monotónica antes de grants.
  Esta captura no habilita sus rutas, recibos ni concesiones.
- Se requiere autorización y preflight independiente para Neon. Las migraciones
  0007/0008 deben estar aplicadas antes del código dependiente; no se modificaron
  ni aplicaron aquí. No hay 0009. Revisar respaldo, cupos, privacidad/retención y
  costo operacional antes de publicación/uso real.
- Deployments anteriores pueden escribir fuente/cursor sin estas capturas. R no
  corrige retroactivamente esa ausencia. Antes de una futura validación probatoria,
  excluir writers antiguos/simultáneos y detectar prefijos o unidades sin recepción.
  Retroceder código conserva registros, pero las nuevas escrituras del código viejo
  dejan de ser capturadas y no pueden acreditarse como completas.
- Los scans acabados también consumen cupos. No se añadió borrado ni retención
  automática: definir una política explícita antes de agotar 1.000 headers/jugador.
- LP, Firma, Salones, evaluadores y reglas R1/I1/OTP no cambiaron. Demo no usa esta
  frontera ni PostgreSQL. Sin grants, sellado, equipamiento ni cambios de flags.
