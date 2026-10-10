# Logros 1.1.B — lectura y presentación experimental

Estado: implementado localmente, desconectado de rutas públicas. No existen concesiones, tablas nuevas, migraciones, endpoints, Server Actions, jobs ni cambios en la sincronización. El motor de [ENGINE.md](./ENGINE.md) sigue siendo puro. Todos los resultados mantienen `certification: "not_established"` y `grantAuthorized: false`.

## Auditoría adversarial de 1.1.A

Se revisaron los algoritmos, normalización, selección de evidencia, consultas existentes y restricciones SQL, además de las pruebas anteriores.

| Área                  | Hallazgo y decisión                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resurrección          | Examina todos los puntos intermedios; mínimos, pérdidas y recuperación requieren contadores coherentes. Cola, temporada, Unranked, división/tier, resets, fechas inválidas, huecos e instantes ambiguos siguen siendo barreras. No se encontró un caso reproducible de recuperación falsa en las pruebas revisadas.                                                                                             |
| Complejidad del rango | El peor caso O(n²) sigue presente. No se reescribió el algoritmo ni se cambiaron sus criterios deterministas; el oráculo exhaustivo y propiedades de 1.1.A siguen ejecutándose. Optimizar exige demostrar equivalencia con ventanas, expiraciones y mínimos empatados.                                                                                                                                          |
| Imparable             | Defecto confirmado: un remake confirmado con timestamp idéntico al de una victoria cortaba la secuencia como ambigua. Ahora se excluyen remakes confirmados **antes** de agrupar timestamps; se conservan para listar remakes intercalados. Dos partidas competitivas/indeterminadas simultáneas siguen cortando. Una regresión reproducible y 30 permutaciones sembradas verifican esta corrección localizada. |
| OTP                   | Mantiene comparación racional exacta con enteros, mínimo 50 y 7/10, campeón dominante determinista y revisión cuando se descubren partidas antiguas. Un remake/campeón/resultado desconocido impide concluir sobre el denominador.                                                                                                                                                                              |
| Cobertura             | La racha significa secuencia registrada; no afirma ausencia de derrotas no recuperadas. OTP mide muestra importada. Backfill `completed` y cero detalles no disponibles **no** constituyen certificado.                                                                                                                                                                                                         |
| Autenticidad          | Zod valida estructura, no autenticidad, pertenencia a un jugador ni procedencia Riot. La autoridad de lectura se establece en el servicio de servidor y sus filtros internos. El motor ni el DTO autorizan concesiones.                                                                                                                                                                                         |

La corrección de Imparable aplica la regla ya documentada de ignorar remakes; no cambia umbrales, nombre de catálogo ni versión provisional. Salones de Premios, LP y Firma no se modifican. Un Champion ID positivo seguro es válido estructuralmente; el catálogo local incompleto no demuestra por sí solo autenticidad de una identidad futura. El DTO utiliza un nombre local suministrado o `Campeón #ID`, sin inventar nombres.

## Arquitectura y frontera de confianza

```text
service.ts (server-only, Demo primero)
  ├─ Demo → demo.ts → datos ficticios deterministas
  └─ Live → db() → queries.ts → contexto interno + dos conjuntos de evidencia
                                  ↓
                             evaluate.ts
                 ámbito regional + normalización + validación
                                  ↓
                Resurrección / Imparable / OTP (motor puro)
                                  ↓
                  presentation.ts (proyección acotada)
                                  ↓
       AchievementPanel / AchievementTitlePreview (aislados, SSR)
```

Solo `src/server/achievements/*` puede obtener evidencia real. Todos sus módulos están marcados `server-only`. El motor no importa PostgreSQL, React ni secretos. Los componentes importan tipos de presentación, no evaluadores ni consultas. No se acepta evidencia del navegador mediante ninguna ruta nueva. El lector inyectable sirve para pruebas y llamadas internas confiables; nunca debe construirse con objetos de evidencia remitidos por un cliente.

API interna:

```ts
const result = await readPlayerAchievements({
  playerId: internalPlayerId,
  view: "soloq", // o "flex"; 5v5 devuelve not_applicable
  season: "2026", // explícita; solo calendario actual soportado
  asOf: suppliedObservationCutoff, // ISO con zona; reloj del llamador
});
const presentation = achievementPresentation(result, localChampionCatalog);
// Uso futuro sujeto a autorización: <AchievementPanel presentation={presentation} />
```

`platform` no es un parámetro de autoridad del navegador: se obtiene y valida del jugador interno. La solicitud valida UUID, vista, temporada e instante; 5v5 y solicitudes mal formadas se rechazan antes de abrir PostgreSQL. El lector excluye jugadores inexistentes o pausados antes de obtener evidencia. Un contexto interno inválido devuelve `invalid_data`. Una temporada histórica no soportada devuelve `invalid_request`; no se inventa su calendario a partir del año.

`AchievementReadResult` distingue `available`, `not_found`, `ineligible`, `not_applicable`, `invalid_request`, `invalid_data` e `unavailable`. Dentro de `available`, cada evaluador conserva sus cuatro estados, motivos y evidencia íntegra. `available` significa que la lectura funcionó, **no** que se observó o certificó un logro. Un fallo SQL/conexión/normalización impide entregar evaluaciones; devuelve `unavailable`, sin texto del error, logging de credenciales ni sustitución por resultados ficticios.

## Lecturas SQL y normalización

Tres SELECT por jugador/cola: contexto, snapshots y partidas. Los dos últimos se realizan en paralelo tras validar el contexto. No se cargan perfiles completos ni se vuelven a consultar partidas por logro.

| Lectura                       | Campos y condiciones                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `players`                     | ID, plataforma, enabled, temporada/estado/contadores de backfill, lastSyncedAt y rankCheckedAt. Filtro por UUID interno; no selecciona PUUID, Riot ID, errores runtime, cursores, credenciales ni sesión.                                                                                                                             |
| `ranked_snapshots`            | ID, cola, timestamp, tier, división, LP, wins, losses. Filtros por jugador, cola específica y límites regionales. Orden timestamp + ID ascendente. Sin límite visual de 30 ni transformación gráfica.                                                                                                                                 |
| `player_matches JOIN matches` | Match ID, queue ID, timestamp, win, champion ID, is_remake. JOIN por match ID; filtros por player ID, cola única y fechas. Prefijo `PLATFORM_` literal en MATCH-V5 ID excluye asociaciones de otra plataforma o prefijos mal formados. Orden timestamp + ID ascendente. Sin límite 40/500, duración heurística ni COALESCE de remake. |

Los timestamps PostgreSQL se convierten a ISO UTC manteniendo el mismo instante. No se redondean ni interpolan valores. Las filas de rango inválidas y los timestamps coincidentes no se filtran para ocultar barreras: el motor las examina. La consulta no deduce remake de duración, ni crea LP desde MATCH-V5. La duración, métricas de combate y nombre del jugador no son necesarios para las reglas actuales y no se seleccionan.

Límites `[seasonStart(platform), min(asOf, seasonEnd))`. Se reutiliza el calendario de `season.ts`, por ejemplo LA2 comienza a las 15:00Z y KR a las 03:00Z el 8 de enero de 2026. Se incluyen registros en el inicio exacto y excluyen los del corte final. El ID de temporada es explícito. Cambiar de año requerirá otro calendario aprobado y fixtures actualizados.

Integridad existente: snapshots UUID PK y FK a jugador; matches PK por ID; participaciones PK `(player_id, match_id)` y FKs impiden inflación del JOIN. El motor continúa deduplicando copias idénticas y rechazando contradicciones fuera de la consulta. `win` y champion ID son NOT NULL en SQL, mientras `is_remake` admite NULL legado: esa incertidumbre se conserva. Un Champion ID persistido como cero es rechazado por el motor.

Índices existentes: `snapshot_player_queue_time_idx`, `match_queue_time_idx`, PK de participaciones por jugador/match y `player_match_match_idx`. No se añadieron índices. Antes de una futura activación medir EXPLAIN en staging autorizado: solo si aparece coste relevante podría justificarse añadir ID al índice de snapshots para desempate o un índice/materialización que resuma evidencia por jugador/cola/temporada. No afirmar un plan óptimo de Neon a partir de PGlite.

## Contexto de cobertura

`AchievementCoverageContext` contiene disponibilidad interpretativa (`available`, `partial`, `unknown`), estado histórico, contadores de importación nullable, timestamps de recientes/rango, cantidades de filas en la ventana consultada e `intervalCoverage: "unproven"`.

- `completed` → historial **disponible** importado; exhaustividad no acreditada.
- `running` → importación en curso; muestra parcial.
- `failed` → importación interrumpida, conservando registros disponibles.
- `not_started` → importación pendiente.
- Temporada de backfill diferente → contexto desconocido y contadores NULL, no cero.
- Contadores processed/discovered/unavailable son **del jugador y todas las colas importadas**, no de SoloQ/Flex ni total de temporada. Se indica ese alcance expresamente.
- Cantidad de filas seleccionadas no significa cantidad de partidas recuperables en Riot. No se muestra porcentaje ni se afirma que falten partidas concretas.
- lastSyncedAt y rankCheckedAt siguen siendo diagnósticos del jugador; no prueban cobertura de la cola/ventana evaluada y no autorizan un reconocimiento.

Las lecturas no usan una transacción repeatable-read: un backfill concurrente podría cambiar filas o contexto entre SELECT. Los dos evaluadores de partidas sí comparten exactamente el mismo conjunto normalizado. Las conclusiones son observaciones provisionales con corte temporal, no una fotografía certificada ni concesiones. Antes de persistir/conceder se necesitará un contrato de cobertura y consistencia verificable (lectura coherente/revisión de evidencia), no otro lock de sincronización.

## DTO e interfaz aislada

`AchievementPresentation` conserva estado de lectura, modo, temporada, límites, procedencia, cobertura y lista de resultados. Los errores no muestran mediciones ficticias ni «no conseguido». Cada `AchievementDisplay` lleva código, nombre, descripción, estado y texto, medición opcional, límites, versión y parámetros de regla, y flags explícitos de no concesión/no certificación.

La proyección no pasa objetos de base de datos ni IDs personales. Resurrección muestra rango y A/B/C, caída, fechas y número de observaciones intermedias. Imparable muestra longitud, fechas, cantidad de partidas, hasta 20 IDs de evidencia y número de remakes. OTP muestra campeón, C/N, porcentaje **de muestra**, fracción exacta y condición aplicada. Los snapshots/IDs íntegros se conservan en el resultado interno; el DTO acota la lista que llega a la vista. El porcentaje redondeado es texto descriptivo, nunca umbral de evaluación.

Se muestra «OTP · muestra importada», conservando el código y catálogo provisional «OTP certificado» sin dar a entender que ya está certificado. El nombre visible definitivo requiere decisión de producto.

| Componente                | Función                                                                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AchievementPanel`        | Contexto, cobertura, lista compacta y estado de lectura. Acepta conceptos futuros explícitos, sin agregarlos al catálogo ni fingir progreso.                                           |
| `AchievementItem`         | Insignia decorativa, nombre, estado textual, medición y detalle nativo de criterio/evidencia.                                                                                          |
| `AchievementBadge`        | Marcador discreto; no rareza ni señal única de estado.                                                                                                                                 |
| `AchievementTitlePreview` | Título conceptual siempre ficticio; no selección, botones, preferencias, concesión ni sustitución del Riot ID.                                                                         |
| `achievements.module.css` | Estilos aislados con tokens existentes, tipografía ≥14 px, foco visible, controles ≥44 px y detalles en una columna móvil. Sin animación, hover obligatorio, glow ni grid de tarjetas. |

`useId` enlaza encabezados únicos incluso al representar dos paneles. `<details>/<summary>` funcionan sin JavaScript; todas las distinciones tienen texto además de color. No se añadió infraestructura Storybook ni librerías. No hay imports desde perfil, leaderboard o metrics, comprobado por regresión.

Demo se decide **antes** de importar db/queries: el lector dedicado usa un ID interno ficticio fijo y registros deterministas, con el mismo motor y límites temporales. No se reutilizan/modifican los fixtures públicos existentes. Origen `fictitious` y aviso visible permanente. Cambiar el corte puede producir insuficiencia si esas fechas ficticias quedan fuera; no se altera el reloj para mantener observaciones positivas.

## QA y rendimiento

Las pruebas de `achievements-integration.test.ts` ejecutan las consultas Drizzle reales sobre PGlite efímero, aplicando allí el historial SQL existente. No cargan `.env.local`, no conectan a Neon y no ejecutan migraciones remotas. Verifican aislamiento, JOIN/PK, orden, límites regionales, tres SELECT, más de 40/500 partidas, más de 30 snapshots, remakes true/false/null, reset/tier/instantes ambiguos, contextos parciales/completados, error SQL real, ausencia de writes y separación Demo. Los campos NOT NULL no pueden simular NULL válidos en SQL; entradas incompletas y timestamps mal formados se cubren en el motor/fixtures. PGlite no reproduce red, pooling, RLS bajo roles de despliegue ni latencias Neon.

Las pruebas de presentación comprueban semántica SSR, los tres logros y cuatro estados, modos, cobertura, regla, exactitud de medición, sanitización/acotación, títulos futuros y aislamiento público. Las regresiones previas de temporada, LP, Firma, premios, perfil, historial y sincronización siguen ejecutándose sin modificación.

Validación final local: lint y typecheck correctos, build Next.js 16.3.8 correcto, **605 pruebas aprobadas y 4 omitidas** (38 archivos aprobados y uno omitido). 1.1.B añade 70 pruebas. Las cuatro omitidas son las pruebas anteriores opcionales de fencing del lease contra PostgreSQL local; no se conectó un servidor remoto para suplirlas. El build no añadió rutas y sus scripts prebuild únicamente publicaron assets locales ya existentes, sin diff en los manifests. No se generó un informe de cobertura de líneas: estos resultados son de escenarios/regresiones ejecutados.

QA local ficticia: Chrome, seis anchos 1440/1024/768/390/375/320 px, sin desbordamiento horizontal con evidencia abierta; controles de al menos 44 px; Enter y Espacio abren detalles, Tab avanza al siguiente summary, foco visible. Axe ya instalado: cero infracciones automáticas WCAG A/AA en la muestra cerrada, 12 reglas aprobadas, contraste marcado como revisión manual. Ratios sobre `#0e1528`: texto 16,24:1, muted 8,36:1, verde 12,28:1, warning 9,64:1, foco 11,62:1. No equivale a una auditoría integral con lector de pantalla. Zoom real 200 % queda pendiente: el atajo no cambió el viewport efectivo del navegador automatizado; no se simuló con CSS ni se afirma aprobación. Capturas/HTML quedan fuera del repositorio.

Exportación opt-in (PowerShell, directorio temporal explícito fuera del repositorio):

```powershell
$env:ACHIEVEMENT_VISUAL_DIR = '<directorio-QA-local>'
npm run test -- tests/achievements-visual.test.tsx
# Sirve únicamente esos HTML ficticios en localhost, sin arrancar Next/DB/Riot.
```

Sin esa variable las pruebas no escriben archivos de visualización. Si `axe-core` está disponible como herramienta transitoria ya instalada, la exportación genera también accessibility.html; no se añade dependencia ni se carga axe en la aplicación.

Complejidad: lectura/memoria O(n+s); dos validaciones puras independientes sobre el mismo arreglo normalizado de partidas, deduplicación/orden O(n log n) por evaluador; rachas y OTP O(n). Resurrección O(s*k), peor O(s²). No se introduce un límite arbitrario que convierta un recorte en ausencia de logros. Antes de activar grandes historiales medir presupuesto real y considerar evaluación fuera de la respuesta crítica, caché por versión/revisión de evidencia o resúmenes derivados.

Benchmark opcional, Node 25.8.2, una ejecución local, datos invertidos y 10 % de duplicados idénticos:

```sh
node --conditions=react-server --import tsx tests/achievements-integration-benchmark.ts
```

| Partidas únicas | Filas de entrada | Snapshots | Normalización | Evaluación conjunta | DTO     | Δ heap aproximado |
| --------------- | ---------------- | --------- | ------------- | ------------------- | ------- | ----------------- |
| 50              | 55               | 30        | 0,07 ms       | 11,73 ms            | 3,50 ms | 0,00 MiB          |
| 500             | 550              | 30        | 0,55 ms       | 6,55 ms             | 0,22 ms | 4,02 MiB          |
| 5.000           | 5.500            | 300       | 5,01 ms       | 44,58 ms            | 0,22 ms | −0,89 MiB         |
| 50.000          | 55.000           | 3.000     | 51,52 ms      | 383,38 ms           | 0,22 ms | 60,52 MiB         |

DTO 3.572–3.595 bytes en esos casos. Heap es diferencia antes/después con GC no controlado (puede ser negativa), no memoria pico; primera muestra incluye calentamiento. No se mide SQL/Neon y no se extrapola a Vercel. Node 25.8.2 está fuera de engines `^22.12.0 || ^24.0.0 || >=26.0.0`: repetir verificaciones en una versión soportada antes de publicación. Los benchmarks no tienen asserts de tiempo en la suite normal.

## Persistencia propuesta, todavía no implementada

Una futura tabla de concesiones necesita campos concretos: ID, player_id, achievement_code, rule_version, identidad/huella estable de parámetros aprobados, season_id, cola única, contexto de campeón nullable, estado, evidencia versionada acotada, detected_at, observed_from/observed_to, observed_at nullable, granted_at nullable, invalidated_at nullable y motivo/revisión de invalidación. Incluir revisión de cobertura y referencia a la evidencia confiable. No guardar PUUID, secretos ni respuestas Riot completas en ella.

Unicidad propuesta: jugador + código + versión/variante aprobada + temporada + cola + contexto. Tratar NULL de campeón explícitamente con NULLS NOT DISTINCT o una clave de contexto no nullable; no confiar en unicidad SQL ordinaria con NULL. Decidir antes si una variante/versionado puede conceder otra insignia equivalente; la clave técnica no sustituye esa decisión.

Estados futuros: candidato observado, pendiente de cobertura/revisión, concedido, invalidado. Recalcular idempotentemente por ámbito tras backfill/cambio de evidencia; actualizar o invalidar candidatos sin duplicarlos. Un resultado posterior no observado no borra automáticamente una concesión permanente: aplicar política aprobada, trazabilidad y versión. Guardar fechas de detección y concesión reales del proceso autorizado; observación exacta solo si se acredita, conservando intervalos cuando no se conoce el instante del evento.

Las escrituras futuras deben vivir en otro servicio autorizado de servidor, con transacción, unicidad, revisión de evidencia/cobertura, auditoría y control de identidad. Nunca aceptar un DTO/evaluación del navegador como grant. Cambios de regla necesitan versión soportada, plan de recálculo y transición explícita; no ejecutar concesiones durante lecturas del perfil ni aprovechar un lease ajeno como bloqueo de concesión. No se añade SQL ni repositorio de escritura en 1.1.B.

## Activación posterior y pendientes

1. Aprobar umbrales, nombre OTP, carácter provisional/permanente, alcance por temporada/cola y política de revisión/invalidation. Títulos requieren autorización y elegibilidad independientes.
2. Revisar esta implementación/QA y repetir en Node admitido, zoom real 200 % y lector de pantalla. Una publicación solo a staging podría incluir el código desconectado, previa autorización; no activa sección ni concede.
3. En staging autorizado medir consulta/plan y memoria reales con muestra apropiada y sin exponer identidad o secretos. No ejecutar una evaluación por cada perfil para un leaderboard: usar consultas agrupadas de evidencia/resúmenes por IDs y ámbito, o materialización/caché revisada. No se implementa esa carga masiva ahora.
4. Definir evidencia persistente de cobertura por cola/intervalo, IDs sin detalle, remakes legado y límites de recuperación. Backfill completed o counters rank no bastan por sí solos.
5. Conectar en una tarea aprobada un Server Component del perfil al servicio y mapper, usando el catálogo local ya cargado, conservando aislamiento Demo, ventana explícita y estados de indisponibilidad. Evitar añadir el trabajo a la ruta crítica sin medición; conservar identidad y Firma diferenciada. No usar el componente conceptual de título como título concedido.
6. Diseñar/revisar/probar por separado la migración y servicio de concesiones. No crear campos preventivos ni materializar certificados antes de cobertura/política aprobadas.

Este trabajo no requiere modificar Neon, Vercel, Riot, migraciones, esquema, fixtures públicos ni planificación de sincronización. No hay concesiones permanentes ni sección pública experimental.
