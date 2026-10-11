# Logros 1.1.D — hardening del RC experimental

Base: `bf919ad720e626c16d7953b724e7281d45bb69fe`, después de A/B/C. Remoto inspeccionado: `e65716b985f2d64b4d5190d79674d38ab1bb34e7`. No se publica ni activa el módulo. Ver [checklist operativo](RELEASE_CHECKLIST.md).

## Auditoría y correcciones

Se conservan `certification: "not_established"`, `grantAuthorized: false`, los cuatro estados, umbrales 50 LP / 30 días / 7 días, cinco victorias y OTP 50 partidas / 7:10, y versión `1.1.A-observed-v1`. Sin grants, endpoints, títulos equipados, persistencia ni cambios de esquema. No se cambia LP, Firma, premios, B1–B5, leaderboard, sincronización, temporadas ni fixtures públicos.

Zod acredita estructura, no procedencia: el motor admite fixtures, pero la integración solo evalúa registros del lector interno. UUID validado, jugador habilitado, plataforma almacenada y temporada regional delimitan el ámbito. El navegador no aporta evidencia ni activa el flag. El DTO proyecta mediciones acotadas y mensajes fijos, sin PUUID, credenciales, UUID interno del jugador, excepción, SQL ni stack. Los IDs de MATCH-V5 de evidencia son públicos, limitados a 20 en la UI; no son PUUID.

Correcciones:

- `completed` con cero unavailable podía declarar `available` aunque procesados y descubiertos no coincidieran. Ahora queda `partial` y se comunica la discrepancia. Completed con detalles unavailable se identifica también como muestra parcial. Incluso contadores reconciliados mantienen `intervalCoverage: "unproven"`; no certifican temporada. Los contadores son del jugador en todas las colas, no del logro ni porcentajes de temporada.
- Textos precisos: recuperación entre verificaciones oficiales, racha en partidas importadas, especialización en muestra importada. Imparable se diferencia del premio comunitario homónimo. «OTP certificado» sigue siendo un concepto futuro del catálogo; no se muestra como nombre en esta UI.
- Resurrección evita búsqueda cuadrática en segmentos numéricamente imposibles mediante el precheck explicado abajo.
- El exportador SSR perdía claves al resolver arrays de RSC; ahora usa `Children.toArray`. Su `<pre>` de JSON axe provocaba overflow ajeno al perfil: se permite envolver el texto y se serializan auditorías de toggles. Son correcciones de pruebas, no del diseño de la aplicación.

Duplicados idénticos no inflan muestras; contradicciones invalidan entrada. Instantes ambiguos, tier/división, Unranked, valores negativos, resets y huecos interrumpen Resurrección. Remakes confirmados no cortan rachas; clasificación/resultado desconocido limita evidencia. Champion ID inválido no se descarta para mejorar OTP. Fechas inválidas no se inventan. Vacío/insuficiencia no prueban ausencia absoluta; fallo de infraestructura no significa `not_observed`.

## Resurrección: algoritmo y equivalencia

La referencia C valida, deduplica, filtra cola/ventana y ordena timestamp/ID. Por segmento comparable mantiene anclas A y mínimos B anteriores a C, con expiración de 30 días. B considera todos los puntos intermedios. En empate prefiere el primer mínimo con aumento de derrotas respecto de A; C exige aumento de victorias respecto de B. Selección: C más antiguo, mayor caída, A/B más antiguos, IDs ordinales. Reset/cambio ranked/ambigüedad/dato inválido/hueco cortan anclas; maxGap configurable solo puede ser más estricto que siete días.

D particiona con las mismas barreras y cachea validez/cortes. Un A/B/C válido necesita algún B con al menos `LP_B + minDropLp` tanto antes como después. Máximos de prefijo/sufijo prueban esa condición necesaria en O(s). Si no existe tal B, se omite buscar anclas en ese segmento, pero se visitan todos los puntos para conservar conteos y razones. No se incorporan razones posteriores a la recuperación seleccionada.

El precheck ignora deliberadamente ventanas/counters: puede retener trabajo innecesario, pero nunca descarta una recuperación válida ni produce positivos. En segmentos potenciales se conserva la búsqueda anterior. No cambia versión de regla ni evidencia.

Coste: preparación/orden O(s log s), precheck O(s), memoria adicional O(s). Segmentos rechazados evitan O(s²). **El peor caso global sigue siendo O(s²)** y existe sobrecoste lineal si C se encontraba muy pronto. Una estructura de ventanas/mínimos sería futura y necesitaría conservar expiraciones/empates y demostrar equivalencia, no un refactor preventivo.

`tests/achievements-resurrection-reference.ts` congela la búsqueda C. Comparación completa (status, razones, scope, flags, reglas, A/B/C, IDs, fechas y todas las observaciones) en 1.200 historiales con semilla 73013, ocho familias, permutaciones, empates, duplicados idénticos/contradictorios, resets, tiers/apex, colas, offsets, límites de temporada/ventana, fechas y configuraciones inválidas. Permanece el oráculo exhaustivo independiente de A sobre 250 historiales. Se usan entradas congeladas.

## Consultas y consistencia

Se conservan tres SELECT: contexto (11 columnas), snapshots (8), JOIN participaciones/partidas (6). SQL filtra jugador, cola y ventana `[inicio regional, min(asOf, fin))`; prefijo de plataforma MATCH-V5 literal escapado. Orden timestamp/ID determinista. Sin N+1, límite de 40 ni COALESCE de remakes desconocidos. Se carga temporada almacenada: memoria O(n+s); no se reutiliza una ventana recortada como si fuera toda la evidencia.

Drizzle 0.45.3 / postgres-js 3.4.7 abre BEGIN y aplica SET TRANSACTION antes del primer SELECT:

```ts
{ isolationLevel: "repeatable read", accessMode: "read only" }
```

Materialización dentro, evaluación/proyección después del commit. Sin llamadas externas, locks, escrituras ni configuración global. Una conexión para contexto y evidencia; sin anidamiento ni reintentos automáticos. Una petición posterior obtiene una fotografía nueva. Pool existente máximo tres conexiones y connect_timeout diez segundos; **no se añade statement_timeout específico**. Muchos datos/visitantes pueden ocupar pool/CPU: Suspense no elimina ese coste.

Pruebas ejecutadas:

- PGlite: SET antes del SELECT, aislamiento/read-only efectivos, UPDATE rechazado, fallos simulados al construir la primera/segunda/tercera lectura con recuperación, evaluación fuera de transacción incluso ante defecto, y contexto eliminado/pausado que corta tras un SELECT. Cambios de partidas/snapshots/contexto/backfill/contadores en fixtures se etiquetan como simulaciones.
- **PostgreSQL 17 local desechable, dos conexiones independientes, adaptador postgres-js real:** después del SELECT de contexto, otro cliente confirma partidas, snapshots, coverage/counters o todo conjuntamente. El resultado entero conserva la fotografía anterior; la siguiente petición ve lo confirmado. Error SQL real hace rollback y libera la conexión; read-only rechaza UPDATE con SQLSTATE `25006`, sin cambiar al jugador.
- Test opt-in solo acepta `postgres://postgres@127.0.0.1:PUERTO/postgres` sin password/parámetros. Crea una base única `achievements_test_<32 hex>` y elimina exclusivamente esa base tras cerrar conexiones. No lee DATABASE_URL ni .env. Usa fixtures y SQL existente dentro de la instancia desechable. Sin URL explícita omite seis casos, sin buscar servidores remotos.

No se valida Neon, su red/pooling ni RLS del rol desplegado. El test local sí demuestra MVCC entre sesiones PostgreSQL, no esos aspectos operativos. La fotografía puede contener un avance parcial legítimo del sincronizador y no hace atómico todo el perfil.

Consistencia interna ≠ cobertura ≠ autenticidad de fuente ≠ certificación ≠ concesión. Los registros de tests son ficticios aunque ejerciten SQL real.

Índices existentes: snapshots jugador/cola/timestamp; matches cola/timestamp; PK participaciones jugador/match y su índice match. EXPLAIN de PGlite con un jugador que posee todas las filas eligió Seq Scan + Sort para snapshots, Hash Join + Sort para partidas. No se extrapola a Neon ni se afirma uso de índices. No se añade ninguno. Si un plan real autorizado demuestra que el desempate/orden domina, estudiar incluir id en el índice de snapshots; si domina JOIN, medir selectividad e índices existentes antes de proponer migración. No denormalizar preventivamente.

## Benchmarks opcionales

Node 24.19.0, tres muestras/caso y medianas, Windows local. Heap delta no es pico y puede ser negativo por GC. Sin umbral CI, SLA ni extrapolación Neon/Vercel.

```sh
node --import tsx tests/achievements-resurrection-benchmark.ts
node --conditions=react-server --import tsx tests/achievements-sql-benchmark.ts
node --conditions=react-server --import tsx tests/achievements-integration-benchmark.ts
```

Resurrección emite preparación, min/mediana/max, total y heap para 30/300/3.000/10.000 snapshots. Datasets fijos en 28 días; adversarial `100 → 49 → 99` retiene búsqueda sin recuperar el ancla 100.

| Serie | 30 ref / D ms | 300 ref / D ms | 3.000 ref / D ms | 10.000 ref / D ms |
| --- | --- | --- | --- | --- |
| Constante | 0,47 / 0,34 | 4,00 / 1,32 | 133,00 / 11,83 | 1.330,12 / 37,36 |
| Ascendente | 0,29 / 0,24 | 3,75 / 1,09 | 140,68 / 12,13 | 1.536,93 / 38,44 |
| Descendente | 0,34 / 0,23 | 4,00 / 1,96 | 129,84 / 10,97 | 1.374,35 / 37,73 |
| Oscilaciones pequeñas | 0,26 / 0,20 | 4,78 / 1,09 | 131,91 / 10,93 | 1.405,27 / 37,19 |
| Recuperaciones tempranas | 0,20 / 0,18 | 0,65 / 1,16 | 6,69 / 12,67 | 25,28 / 37,58 |
| Interrumpida | 0,15 / 0,17 | 0,98 / 0,86 | 8,76 / 7,43 | 30,21 / 25,02 |
| Cerca del umbral (49 LP) | 0,25 / 0,16 | 3,70 / 1,24 | 129,78 / 10,90 | 1.366,77 / 36,87 |
| Adversarial | 0,16 / 0,28 | 1,25 / 1,74 | 41,29 / 40,59 | 355,72 / 357,42 |

Antes de editar, baseline ~1.478–1.523 ms en varias series de 10.000. La comparación final vuelve a medir referencia y D en el mismo proceso; carga/JIT explican variación. Mejora marcada en series imposibles, coste adicional en recuperación temprana, peor caso conservado.

SQL PGlite: «materialización» incluye tres lecturas, BEGIN/SET/COMMIT, Drizzle y normalización real. «ISO adicional» es una proyección Date→ISO controlada para aislar su coste, **no se suma otra vez al total**. Evaluación ocurre sobre registros ya materializados.

| Partidas / snapshots | Materialización ms | ISO adicional ms | Evaluación ms | DTO ms | Serialización ms | Total ms | Δ heap MiB | DTO bytes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 50 / 30 | 5,56 | 0,05 | 1,53 | 0,15 | 0,02 | 7,25 | 2,41 | 3.400 |
| 500 / 300 | 16,44 | 0,45 | 5,90 | 0,15 | 0,02 | 22,52 | 7,69 | 3.408 |
| 5.000 / 3.000 | 109,48 | 4,49 | 40,23 | 0,18 | 0,02 | 149,93 | -4,36 | 3.428 |
| 50.000 / 3.000 | 627,69 | 44,24 | 256,71 | 0,18 | 0,02 | 881,02 | 81,74 | 3.435 |

Un solo jugador sintético, sin red. Preparación SQL y ANALYZE excluidos. DTO pequeño; coste alto en filas/normalización/evaluadores. Imparable/OTP mantienen preparaciones independientes: compartirlas sería mejora futura con prueba de invariancia, no cambio de esta etapa.

Camino apagado: la importación estática de presentación carga código puro/validación de servidor, sin consultas/evaluaciones. Ensayo tsx: importación ~265 ms / +7,2 MiB, retorno gated null ~0,13 ms. Incluye carga/transpilación tsx, **no mide bundle Next compilado ni cold start desplegado**; no justifica refactor de bundling. No se añade Client Component ni dependencia.

## Flag, UI y QA

Solo ACHIEVEMENTS_EXPERIMENTAL=true exacto. Ausente/vacío/false/FALSE/TRUE/True/espacios/arbitrario apagados. Local: NODE_ENV=development sin marcadores Vercel. Preview: VERCEL=1, ENV=preview, target ausente/preview, incluso NODE_ENV=production. ENV/target production rechaza siempre, también contradictorio. Resto desconocido/custom/contradictorio falla cerrado. Sin cookie/query/header/NEXT_PUBLIC/endpoint/acción/control administrativo.

Off: wrapper/adaptador null antes del servicio/lectura/evaluadores, sin espacio/fallback. Metadata no evalúa. 5v5 omite; inexistente corta antes del módulo. Demo usa memoria antes de importar DB. Catch imprime solo fase/tipo infrastructure/invalid_data/unexpected, nunca payload; defecto de programación no se convierte en datos insuficientes.

Se mantiene bloque plegado **Señales competitivas · Experimental**, después de Firma y antes de gráficas. Suspense independiente del encabezado/rango/estadísticas, fallback pequeño solo al permitirlo. Native details, estados textuales, símbolos decorativos, evidencia/reglas a demanda. Sin tarjetas nuevas ni cambios CSS de aplicación.

QA local con fetch externo bloqueado:

- Next **hidratado**: SoloQ/Flex ficticios y omisión 5v5; 1440/1280/1024/768/390/375/320 sin overflow tras estabilizar gráficas. Enter/Espacio alternan evidencia, Tab avanza, foco cyan, summaries >=44 px. Tooltip dentro de 320 px y Escape cierra. Historial/pool/Firma/gráficas preservados.
- 16 perfiles completos SSR: observado/no observado/insuficiente/inválido/indisponible/mixto/parcial/completed con unavailable/Unranked/ID largo/vacío/pool50/SoloQ/Flex/5v5/Demo. Página/componentes reales, lecturas mock, CSS global compilado local y CSS modular de tests. 112 comprobaciones (16×7), evidencia/pool grande abiertos, sin overflow final. **No tienen hidratación Next ni streaming o controles React funcionales**; no representan perfiles reales de Preview.
- Axe y DOM/encabezados/estados: muestras revisadas sin infracciones automáticas A/AA, 21–25 reglas aprobadas; color-contrast manual. Tokens sobre #0e1528: texto 16,24:1, muted 8,36:1, verde 12,28:1, warning 9,64:1, foco 11,62:1. Estados no dependen solo del color y no se añade movimiento. No certifica accesibilidad integral.
- Zoom **real** 200 % y lector de pantalla no disponibles en el control del navegador; pendientes. Reducir viewport no sustituye zoom. Preview/latencia/RLS no comprobados.

Capturas/HTML/JSON/preload fuera del repo. ACHIEVEMENT_VISUAL_DIR/CSS solo son opciones de tests, no rutas ni bypasses públicos.

## Validación y pendientes

Node 24.19.0, **715 aprobadas, 4 omitidas, 0 fallidas; 43 archivos aprobados, uno omitido**. 51 casos nuevos; el seeded incluye 1.200 comparaciones. Cuatro omitidas: lease PostgreSQL opcional anterior. Las seis de MVCC sí se ejecutan en PostgreSQL 17 local; sin URL opt-in se omiten además esos seis (diez omitidos), no se consideran aprobados. Lint, typecheck y build correctos. Smoke del build local con Demo y marcadores Production, incluso flag true solo en ese proceso aislado: HTTP 200 en SoloQ/Flex/5v5, perfil presente y sección experimental ausente. No se encontraron referencias a Resurrección/evaluación/flag en los JS cliente compilados. No acredita deployment ni runtime remoto de Neon/Preview.

Terminada técnicamente: motor, lectura consistente probada en PostgreSQL local, integración gated, DTO/UI, errores neutros, equivalencia/benchmarks/checklist. Pendientes de activación: Preview protegido apagado validado, autorización separada, permisos/RLS/pooling/coste real Neon, carga/concurrencia, zoom/lector y reversión. Mantener off ante anomalías. Peor caso cuadrático y preparación duplicada de partidas quedan como optimizaciones opcionales, con mediciones y equivalencia previa.

Producto pendiente: umbrales definitivos, evidencia que autoriza certificación/concesión, permanencia, versionado/invalidación, temporadas, títulos seleccionables, rarezas, leaderboard. **No preparado ni autorizado para concesiones permanentes.**
