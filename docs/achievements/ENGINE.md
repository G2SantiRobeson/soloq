# Motor de logros personales — 1.1.A

## Alcance y hallazgos

El módulo `src/lib/achievements` detecta condiciones observadas en entradas explícitas. No tiene IO, persistencia, endpoints, React, reloj implícito ni acceso a entornos. No concede logros, títulos ni certificados. No está integrado en rutas públicas. Los umbrales son provisionales.

Los Salones de Premios (`computeAwards`, `getAwardMatchStats`) comparan jugadores elegibles dentro de una cola y período. Su premio Imparable ya existe y sigue intacto. `longestStreaks` acepta solo resultados booleanos: no conserva IDs, barreras de incertidumbre ni evidencia temporal. Por eso el evaluador nuevo recorre registros normalizados en lugar de reutilizar esa función de forma insegura. Firma competitiva describe métricas y referencias; un logro personal representará un acontecimiento con evidencia y, posteriormente, una decisión de concesión.

Datos actuales relevantes:

- `ranked_snapshots` conserva ID, cola, timestamp de observación de SoloQ, tier, división, LP y contadores oficiales. No proporciona la trayectoria entre consultas.
- `matches` y `player_matches` identifican partidas y participaciones. `is_remake = NULL` significa clasificación antigua desconocida.
- `getProfile` carga hasta 40 partidas recientes; no es una entrada anual exhaustiva para OTP.
- `backfillStatus = completed` significa importación del historial disponible, no totalidad original de Riot. Los contadores son por jugador, no certificados por cola/intervalo.
- `importRecent` puede continuar tras detalles 404. `lastSyncedAt` no prueba ausencia de partidas intermedias perdidas.
- El progreso persistente describe ejecuciones y checkpoints, no un registro duradero de pruebas de cobertura.
- Los límites regionales de temporada se reutilizan mediante `seasonStart`. Las colas son SoloQ/420 y Flex/440; 5v5 no es una cola ranked única.

## Estructura y API

| Archivo           | Responsabilidad                                                 |
| ----------------- | --------------------------------------------------------------- |
| `types.ts`        | Ámbito, entradas, reglas, evidencia y evaluación discriminada   |
| `catalog.ts`      | Tres definiciones y parámetros provisionales inmutables         |
| `validation.ts`   | Validación runtime con Zod existente, fechas, reglas y orden    |
| `result.ts`       | Normalización de códigos y motivos, concesión siempre bloqueada |
| `reasons.ts`      | Interpretaciones en español separadas de la lógica              |
| `matches.ts`      | Deduplicación y selección por cola y límites temporales         |
| `resurrection.ts` | Recuperación observada y discontinuidades                       |
| `unstoppable.ts`  | Racha registrada, barreras y remakes                            |
| `otp.ts`          | Concentración exacta del campeón en la muestra importada        |
| `adapters.ts`     | Proyección pura desde contratos existentes                      |
| `index.ts`        | API del módulo                                                  |

Entradas sin validar pueden pasar por los evaluadores, que reciben `unknown` y validan su forma antes de operar. Los tipos exportados permiten construir entradas tipadas desde un futuro servicio confiable. Validar forma no demuestra autenticidad: una futura integración de servidor debe obtener las observaciones de la fuente autorizada y comprobar pertenencia al jugador. Cada entrada debe corresponder a un único jugador y plataforma; el motor no consulta ni verifica esas identidades contra una base de datos. No aceptar resultados o evidencia enviados por un navegador como autoridad para conceder.

```ts
import {
  evaluateResurrection,
  evaluateUnstoppable,
  evaluateOtpSpecialist,
} from "@/lib/achievements";
const rankResult = evaluateResurrection({ scope, snapshots });
const streakResult = evaluateUnstoppable({ scope, matches, coverage });
const otpResult = evaluateOtpSpecialist({ scope, matches, coverage });
```

`scope` contiene `view`, `platform`, temporada con ID y límites, y `asOf` explícito. La selección usa `[season.startAt, min(season.endAt, asOf))`, con final de temporada nullable. Las fechas son ISO con zona y calendario válido. Se preservan sus cadenas originales; el orden compara instantes UTC. No se usa `Date.now()` ni se inventan fechas de desbloqueo.

El motor acepta límites históricos explícitos; quien los construye es responsable de usar el calendario regional de esa temporada. `currentAchievementScope(view, platform, asOf)` reutiliza el calendario actual del repositorio, sin reloj implícito. Una futura temporada requerirá actualizar ese calendario o suministrar otro ámbito aprobado.

`AchievementCoverage` describe origen (`imported_history` o `profile_recent_window`), estado histórico y cantidad conocida de detalles no disponibles. Solo admite `intervalCoverage: 'unproven'`. No existe una bandera con la que el cliente pueda convertir `completed` en certificado.

## Estados y evidencia

Todos los resultados son JSON serializable y llevan código, versión, ámbito sanitizado, motivos ordenados sin duplicados, `certification: 'not_established'` y **`grantAuthorized: false`**.

| Estado                  | Significado                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `observed`              | La condición se encontró en los registros utilizados; tiene evidencia                                |
| `not_observed`          | La condición no se encontró en los datos examinados; no niega acontecimientos ausentes de esos datos |
| `insufficient_evidence` | Muestra corta o incertidumbre impide una evaluación concluyente del conjunto examinado               |
| `invalid_input`         | Entrada/configuración no válida o identificadores contradictorios; sin evidencia                     |

En rachas y OTP, un resultado no positivo puede incluir una medición parcial (`evidence`) útil para explicar la muestra. Su presencia no significa que se haya cumplido el umbral. En Resurrección, los resultados no positivos no contienen una recuperación inventada.

Motivos como `unknown_remake`, `counter_reset`, `snapshot_gap`, `ambiguous_timestamp`, `unavailable_matches`, `insufficient_sample` o `no_matching_event` son códigos de máquina. Los mensajes separados describen observaciones, no una temporada completa.

Se proyectan campos conocidos mediante esquemas Zod. No se devuelven PUUID, nombres de jugador, credenciales, errores runtime completos ni campos extra. Un ID de evidencia debe provenir de la entrada confiable: el motor no genera IDs ni acredita su procedencia por sí solo.

## Catálogo y reglas provisionales

Las definiciones incluyen código, versión `1.1.A-observed-v1`, nombre, categoría, vistas, tipo de evidencia, disponibilidad `observation_only` y limitaciones. No hay rarezas. La configuración concreta utilizada forma parte de la evidencia; cambiar parámetros exige revisar el significado del resultado. Una regla futura estable o incompatible necesitará una nueva versión explícitamente soportada.

### Resurrección (`resurrection`)

Regla predeterminada: caída de al menos 50 LP, recuperación en un máximo de 30 días y huecos entre observaciones de un máximo de siete días. `maxGapMs` puede hacerse más estricto, pero no superar el límite existente de `rank-trajectory`.

Se busca A (nivel anterior), B (mínimo observado posterior a A y anterior a C) y C (recuperación):

- `LP_A - LP_B >= minDropLp` y `LP_C >= LP_A`.
- `t_C - t_A <= maxRecoveryMs`.
- Todos los puntos intermedios son válidos, de la misma cola, temporada, tier y división.
- Contadores no decrecientes; `losses_B > losses_A` y `wins_C > wins_B`.
- Se reutilizan `validRankObservation` y `comparableRankInterval`. Unranked, cambios de división/tier, resets, puntos inválidos o instantes ambiguos cortan el segmento.
- La representación de división apex se conserva sin reinterpretarla; un cambio de su valor también corta el segmento de manera conservadora.

Política determinista: recuperación C más antigua; entre candidatos de ese C, mayor caída, A más antiguo, B más antiguo e IDs suministrados en orden ordinal. Si varios mínimos iguales existen, se elige el primero con aumento de derrotas desde A. Se consideran también anclas menores posteriores: una ancla antigua expirada no oculta una recuperación válida más reciente.

Duplicados exactamente iguales con el mismo ID, o puntos anónimos exactamente iguales, se ignoran. Un mismo ID con contenido distinto invalida la entrada. IDs distintos con el mismo instante crean una barrera. Una fecha inválida invalida la entrada entera: no es seguro colocar su barrera temporal. Valores de rango inválidos con fecha válida cortan el segmento y permiten examinar un segmento limpio posterior.

La evidencia devuelve A/B/C completos, cola, temporada, LP, caída, fechas, configuración y **todas** las observaciones del segmento. Los IDs ausentes permanecen ausentes. No usa interpolación, coordenadas gráficas ni MATCH-V5 para LP. No atribuye causalidad o LP por partida a las victorias/derrotas de los contadores.

### Imparable (`unstoppable`)

Umbral predeterminado: cinco victorias. Devuelve la racha máxima registrada, IDs de victorias, remakes confirmados intercalados e intervalo de la racha. Una derrota corta la racha. Remakes confirmados se ignoran sin cortarla. Resultado desconocido, remake desconocido e instantes simultáneos ambiguos cortan la secuencia; se pueden encontrar rachas limpias posteriores.

Empates de longitud: racha más antigua. No cuenta remakes antes de la primera victoria ni después de la última como parte del intervalo. Un candidato positivo sigue siendo solo `recorded_sequence_not_exhaustive_riot_history`. `completed`, unavailable=0 o lastSyncedAt no certifican la ausencia de derrotas intermedias que no se recuperaron.

### OTP certificado (`otp-specialist`)

El nombre del catálogo es provisional; el resultado significa **especialización observada en la muestra importada**. Umbrales predeterminados: `N >= 50`, `10*C >= 7*N`.

Se cuentan partidas con remake confirmado falso, resultado conocido y Champion ID válido. Los remakes confirmados se excluyen. Una partida relevante con remake, campeón o resultado desconocido produce insuficiencia, porque descartarla podría sesgar el denominador. Un Champion ID mal formado invalida la entrada. Los empates entre campeones se resuelven por menor ID numérico.

La proporción es racional (`numerator=C`, `denominator=N`), nunca un porcentaje redondeado para decidir. La comparación utiliza multiplicación BigInt internamente; no devuelve BigInt ni valores no serializables. No hay división por cero ni puntos de maestría inferidos.

La evidencia devuelve Champion ID, C, N, proporción exacta, cola, temporada, fechas de las partidas válidas utilizadas, configuración y límites de cobertura. El ámbito temporal completo examinado permanece en `scope`. Añadir partidas antiguas de otros campeones puede invalidar una concentración antes observada. No se persiste automáticamente ninguna conclusión.

## Escenarios ficticios reproducibles

`tests/achievements-fixtures.ts` define únicamente datos ficticios. Los tests contienen estos escenarios y verifican los contratos completos. Extractos de mediciones esperadas:

| Escenario                                      | Estado     | Evidencia principal                                 | Qué no permite afirmar                            |
| ---------------------------------------------- | ---------- | --------------------------------------------------- | ------------------------------------------------- |
| Diamond I 80 →25 →80 LP, contadores coherentes | `observed` | caída 55 LP, tres snapshots, A/B/C y fechas exactas | trayectoria continua, LP individuales o concesión |
| Cinco victorias y remake intercalado           | `observed` | cinco IDs de victorias, ID del remake e intervalo   | inexistencia de partidas desconocidas             |
| 35 partidas con campeón 157 de 50 válidas      | `observed` | `share: {numerator:35, denominator:50}`             | especialización de toda la temporada              |

En los tres casos: `certification='not_established'`, `grantAuthorized=false`. No se generan `earnedAt`, `detectedAt` ni `grantedAt`.

## Adaptadores y pérdidas de información

- `snapshotInput`: proyecta un RankSnapshot. Conserva cola e ID cuando existen; la cola de respaldo debe suministrarse explícitamente y representa la procedencia declarada por el futuro servicio. No reemplaza una cola existente por otra.
- `matchInput`: proyecta RecentMatch. Un isRemake ausente se convierte en desconocido (`null`), no falso. No transporta el resto de estadísticas ni identidad personal.
- `historyCoverage`: recibe temporada y origen explícitos. Un resumen de otra temporada se representa como desconocido. Nunca acredita cobertura.
- No hay un adaptador que transforme las 40 partidas del perfil en una temporada íntegra.

## Complejidad y rendimiento

Normalizar, deduplicar y ordenar cuesta O(n log n), con memoria O(n). Rachas y concentración agregan recorridos O(n). No se copia una racha creciente en cada victoria, ni se hace una búsqueda por ID repetida por cada remake.

Resurrección mantiene anclas activas solo en el segmento comparable y ventana de recuperación. Su búsqueda cuesta O(n*k), k=anclas activas, **O(n²) en el peor caso** de snapshots densos sin recuperación. No enumera triples ni reordena el historial repetidamente; guarda tiempos normalizados una vez y termina al encontrar el C más antiguo. La evidencia copia solo el segmento elegido. Esta decisión prioriza una búsqueda simple y comprobable que no pierde anclas tras expiraciones. No es un algoritmo adecuado sin medición para millones de snapshots densos. No hay llamadas N+1, SQL ni Riot en el motor.

## Pruebas y benchmark opcional

```sh
npx vitest run tests/achievements-resurrection.test.ts tests/achievements-matches.test.ts tests/achievements-contracts.test.ts tests/achievements-properties.test.ts
npm run lint
npm run typecheck
npm run test
npm run build
# Opt-in; no límites temporales frágiles en la suite normal:
node --import tsx tests/achievements-benchmark.ts
```

Las propiedades usan semillas fijas, entradas congeladas, oráculos independientes de rachas/proporciones y enumeración exhaustiva de triples para pequeños segmentos de rango. Cubren determinismo, permutaciones, límites, duplicados, aislamiento, ausencia de datos inventados y evidencia posterior contradictoria. La suite existente verifica Firma, LP, premios, temporadas y modalidades; sus archivos no se modifican. Los tests opcionales de PostgreSQL local no se conectan automáticamente a Neon.

El benchmark examina 50/500/5.000/50.000 partidas y 30/300/3.000 snapshots ficticios. Imprime tiempos observados, no estimaciones ni mejoras porcentuales. Su reloj pertenece al benchmark, no al motor.

Medición de referencia local en Node 25.8.2 (una ejecución, sin afirmación estadística ni extrapolación a Vercel):

| Registros | Imparable | OTP      |
| --------- | --------- | -------- |
| 50        | 6,67 ms   | 1,36 ms  |
| 500       | 2,56 ms   | 1,73 ms  |
| 5.000     | 15,95 ms  | 9,77 ms  |
| 50.000    | 133,62 ms | 95,73 ms |

Resurrección con snapshots planos y ventana densa: 30 = 2,54 ms; 300 = 5,81 ms; 3.000 = 111,45 ms. El primer caso incluye calentamiento. Node 25 no pertenece al rango declarado por el proyecto (`^22.12.0 || ^24.0.0 || >=26.0.0`); repetir en una versión admitida antes de utilizar estas cifras como referencia operacional.

## Persistencia e integración futuras (no implementadas)

Una futura concesión necesitará jugador interno, código/versión, parámetros o su identidad estable, temporada, cola, contexto de campeón cuando corresponda, evidencia acotada, estado y motivo de invalidación. Deben distinguirse fecha del acontecimiento demostrable, fecha de detección y fecha de concesión. Si el acontecimiento no tiene fecha exacta acreditada, no inventarla; guardar intervalo observado.

La unicidad debe evitar concesiones duplicadas por reintento y tratar explícitamente valores NULL en contexto de campeón. Cambiar versión no debe otorgar automáticamente otra insignia equivalente: requiere política de transición. Concesión, actualización de evidencia e invalidación necesitan transacciones y trazabilidad; no borrar automáticamente reconocimientos contradictorios.

Para certificar rachas o especialización hacen falta pruebas persistentes de cobertura por cola/intervalo, tratamiento de IDs sin detalle, clasificación de remakes antiguos y reglas sobre límites de los datos recuperables de Riot. Comparar cantidades con contadores oficiales puede contribuir a la reconciliación, pero no constituye por sí solo una prueba exhaustiva. Ningún adaptador actual puede fabricar esos datos.

Integración propuesta: consultas dedicadas agrupadas en un servicio confiable, sin cargar perfiles completos por jugador; caché ligada a cambios de evidencia y versión. Evaluar solo datos confirmados, fuera de transacciones críticas de ingesta y sin consumir presupuesto Riot adicional. La eventual materialización debe tener su propio presupuesto y recuperación, sin reabrir ni alterar los leases actuales en esta fase. Demo tendrá un camino ficticio sin PostgreSQL ni Riot.

Presentación futura: sección compacta Logros diferenciada de Firma, un título subordinado al Riot ID y, posteriormente, una insignia discreta del leaderboard. Desplegable accesible para criterio/evidencia. Diferenciar logro permanente, condición actual observada, no observado y datos insuficientes. No añadir tarjetas o progreso anual con cobertura desconocida.

Pendientes de aprobación: umbrales y versión estable, significado del nombre OTP certificado, alcance de certificación, permanencia por temporada, política de invalidación, identidad de variantes por parámetros y selección/autorización de títulos. Se requieren tareas separadas para prueba de cobertura, persistencia/migración y UI. Este motor no autoriza ninguna de ellas.
