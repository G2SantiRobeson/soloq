# 1.1.F — Revisión de Resurrección e Imparable

Fecha: 11 de octubre de 2026. Base auditada: `c1978cee21ef44287f25dbe2819d3894c4a2326d`, rama `staging`.

**Este documento propone decisiones; no aprueba ni activa ninguna regla.** OTP permanece en 50 partidas válidas, 13/20 (65 %), versión `1.1-otp-observed-v2`. No se modificaron evaluadores, consultas de negocio, premios, feature flag, esquema ni migraciones.

Las etiquetas **HECHO VERIFICADO**, **HIPÓTESIS**, **RECOMENDACIÓN** y **DECISIÓN PENDIENTE** separan evidencia de propuestas. Las secciones 1–15 y los apéndices conservan la auditoría histórica de 1.1.F; la siguiente sección registra las aprobaciones posteriores de 1.1.G.

## 1.1.G — Decisiones aprobadas el 11 de octubre de 2026

El propietario aprobó conservar **Resurrección R1** y **Racha imparable I1** sin cambios semánticos ni de versión. R1 mantiene caída observada ≥50 LP, recuperación hasta alcanzar o superar A en ≤30 días desde la observación previa a la caída (no desde B), mismo tier/división, huecos ≤7 días y las condiciones existentes de validez y contadores. I1 mantiene ≥5 victorias consecutivas registradas, remakes confirmados ignorados y el tratamiento existente de derrotas, desconocidos, ambigüedad y cobertura parcial.

Nombre visible individual: **Racha imparable**; código interno `unstoppable`, versión `1.1.A-observed-v1`. Nombre del premio comunitario: **Imparable**, sin cambios de identificador, elegibilidad, ranking ni desempates. Resurrección conserva `1.1.A-observed-v1`. OTP permanece íntegro: mínimo 50 partidas, ≥65 % (13/20), versión `1.1-otp-observed-v2`.

Alcance de 1.1.G: catálogo visible, textos de presentación, documentación y pruebas. Los textos aclaran el reloj de R1, que los snapshots no acreditan una trayectoria completa, y que una racha importada puede cambiar con nuevos registros. `observed`, `not_observed`, `insufficient_evidence` e `invalid_input` conservan sus condiciones; `certification: "not_established"` y `grantAuthorized: false` siguen vigentes.

Las conclusiones, alternativas y simulaciones de 1.1.F se conservan como antecedentes históricos. R2/R3 e I2/I3/I4 **no fueron aprobadas ni implementadas**. Quedan pendientes certificación, concesión permanente, persistencia, política de reevaluación histórica, equipamiento de insignias, niveles de racha y posibles cruces de división. Aprobar R1/I1 para observaciones no autoriza premios permanentes ni títulos equipados.

No se modifican el feature flag, los evaluadores, OTP, consultas, sincronización, LP, Bento, Pool de campeones ni el Salón de Honor. No se añaden iconos, imágenes, rarezas ni funcionalidades. No se realizó push, deployment, migración ni acceso a Neon o Riot en esta etapa.

Validación de 1.1.G con Node 24.19.0: lint, typecheck y build correctos; 787 pruebas aprobadas (10 nuevas) y 10 omitidas. Las omisiones siguen siendo seis pruebas opt-in de logros y cuatro de lease/progreso con sesiones PostgreSQL locales independientes. Las regresiones verifican versiones y parámetros intactos, reloj desde A, estados, nombres, modalidad, evidencia y ausencia de concesiones; las pruebas existentes cubren flag apagado, 5v5 y Demo. Dos expectativas antiguas de presentación se actualizaron al nombre aprobado y a la ausencia de una medición inventada, sin cambiar resultados del motor.

QA: se exportaron HTML ficticios del panel y perfil mediante los tests existentes, sin activar el feature flag. La política de seguridad del navegador bloqueó el acceso de inspección; no se afirma validación visual ni lectura real a 320/390 px. Los componentes y estilos no cambian: conservan detalles nativos, etiquetas accesibles y ajuste de texto sin truncamiento por CSS. La comprobación visual y de teclado en navegador queda pendiente. `git diff --check` pasa para el alcance de 1.1.G; la comprobación global detecta únicamente un espacio final preexistente en el archivo protegido CLAUDE.md, que se preserva.

## 1. Resumen ejecutivo

**HECHO VERIFICADO.** Resurrección exige una caída observada de al menos 50 LP y alcanzar o superar el nivel inicial, en la misma división y tier. Los 30 días comienzan en el snapshot anterior a la caída, no en el mínimo. Imparable reconoce la mayor racha histórica registrada de al menos cinco victorias en una cola; un historial parcial no impide una observación positiva.

Ambas reglas producen `certification: "not_established"` y `grantAuthorized: false`. Una observación no es una concesión, un título equipado ni una certificación de Riot.

**RECOMENDACIÓN.** Conservar provisionalmente R1 e I1; explicar mejor el reloj de Resurrección y la calidad de la secuencia de Imparable. No elevar o rebajar umbrales para compensar datos incompletos. Estudiar cruces de división como una recuperación de rango con magnitudes ordinales explícitas, no como LP históricos sumados. Reservar una exigencia de cobertura del intervalo para futuras concesiones persistentes.

**HECHO VERIFICADO.** Se ejecutaron 45 escenarios controlados y SELECT agregados sobre Neon staging. La muestra de rango empieza el 6 de octubre: no permite estimar la frecuencia de recuperaciones a 30 días ni tasas reales de falsos positivos o negativos.

## 2. Estado inicial y fuentes de código

Rama local y remota: `staging`, mismo SHA auditado, cero commits por delante y cero por detrás. Se confirmó la publicación con `git ls-remote origin refs/heads/staging`. La primera consulta Git falló por la restricción de red del sandbox; la consulta autorizada posterior tuvo éxito.

Working tree inicial: `CLAUDE.md` modificado y `.claude/` sin seguimiento, ambos ajenos a esta tarea. Se preservaron también los bytes de `.env.local`.

| Responsabilidad                       | Archivo y función                                                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reglas y versiones                    | `src/lib/achievements/catalog.ts`: `RESURRECTION_RULE`, `UNSTOPPABLE_RULE`                                                                                                                              |
| Recuperación                          | `src/lib/achievements/resurrection.ts`: `evaluateResurrection`, `boundary`, `searchableSegments`, `compareCandidate`                                                                                    |
| Racha individual                      | `src/lib/achievements/unstoppable.ts`: `evaluateUnstoppable`                                                                                                                                            |
| Orden, filtros, duplicados, cobertura | `src/lib/achievements/matches.ts`: `prepareMatches`; `validation.ts`: parsers y `scopeBounds`                                                                                                           |
| Comparabilidad oficial                | `src/lib/rank-trajectory.ts`: `validRankObservation`, `comparableRankInterval`                                                                                                                          |
| Contratos no concedidos               | `src/lib/achievements/result.ts`, `types.ts`, `presentation.ts`                                                                                                                                         |
| Materialización coherente             | `src/server/achievements/queries.ts`: `consistentAchievementReader`; `evaluate.ts`: `evaluateStoredAchievements`, `coverageContext`                                                                     |
| Evidencia y criterios visibles        | `src/server/achievements/presentation.ts`: `display`                                                                                                                                                    |
| Frecuencia real de snapshots          | `src/server/sync/service.ts`: `syncPlayer`                                                                                                                                                              |
| Premio comunitario                    | `src/lib/awards.ts`: `computeAwards`; `src/server/award-queries.ts`: `getAwardMatchStats`                                                                                                               |
| Regresiones existentes                | `tests/achievements-resurrection.test.ts`, `achievements-matches.test.ts`, `achievements-resurrection-equivalence.test.ts`, `achievements-consistency.test.ts` y suites SQL, perfil, Demo, LP y premios |

Se leyeron AGENTS.md, CLAUDE.md y la documentación de `docs/achievements/`. No se escribió código Next.js. La documentación previa conserva notas históricas de etapas A/B; la integración experimental actual sí existe y no debe confundirse con aquellas notas.

## 3. Resurrección: regla actual verificada

**HECHO VERIFICADO.** Versión `1.1.A-observed-v1`, caída mínima 50 LP, recuperación máxima 30 × 24 horas y hueco máximo 7 × 24 horas.

Sean A el nivel previo observado, B el mínimo observado posterior y C la recuperación:

- `LP_A - LP_B >= 50`.
- `LP_C >= LP_A`: la igualdad basta; no es obligatorio superar A.
- `timestamp_C - timestamp_A <= 30 días`, inclusive.
- A, B y C son observaciones distintas, dentro de la cola y temporada elegidas y antes de `asOf`.
- B incluye el mínimo de todas las observaciones intermedias A…C, no el mínimo real desconocido entre ellas.
- `losses_B > losses_A` y `wins_C > wins_B`. Los contadores no pueden retroceder entre observaciones.
- Todos los puntos del segmento deben ser válidos, del mismo tier y división, con intervalos adyacentes positivos de hasta siete días.

Los aumentos de derrotas y victorias corroboran actividad en esas fases; **no demuestran que cada derrota causó la caída o que cada victoria causó la recuperación**. Decay y ajustes pueden coexistir.

Un cambio de tier/división corta el segmento, incluso si el jugador vuelve después al rango inicial. La resta de LP se restringe a magnitudes comparables. Unranked, contadores reiniciados, rangos inválidos, timestamps ambiguos o huecos superiores al máximo cortan también. Un reset estacional no se atraviesa: el filtro usa el inicio regional de temporada, además de las barreras de contadores.

Los timestamps se comparan como instantes UTC sin alterar los originales de la evidencia. Dos IDs distintos en un mismo instante hacen ambiguo ese grupo, aunque tengan los mismos valores. Un duplicado idéntico del mismo ID se ignora; un duplicado contradictorio invalida la entrada. Un timestamp mal formado invalida la entrada antes de la búsqueda.

Ante varias candidatas se elige la **primera recuperación cronológica**; en ese instante, la mayor caída, luego A/B más antiguos e IDs como desempate. No se selecciona necesariamente la mayor caída de toda la temporada. Para mínimos empatados se prefiere el primero con un incremento de derrotas que permita cumplir la condición.

Sin candidata: menos de tres observaciones válidas o alguna interrupción llevan a `insufficient_evidence`; un conjunto limpio suficiente sin evento lleva a `not_observed`. Una candidata posterior limpia puede producir `observed` aunque exista incertidumbre en un segmento anterior.

**RECOMENDACIÓN.** Llamarlo “recuperación del nivel previamente observado”. No describir una trayectoria continua probada, una fecha exacta de desbloqueo o una recuperación causada exclusivamente por partidas.

## 4. Imparable: regla actual verificada

**HECHO VERIFICADO.** Versión `1.1.A-observed-v1`, mínimo cinco victorias; SoloQ y Flex se evalúan por separado, por temporada y plataforma en la integración de servidor.

Se ordena por instante e ID, se deduplican registros idénticos y se rechazan duplicados contradictorios. Los remakes confirmados se excluyen **antes** de buscar ambigüedad temporal; no cortan la racha. La evidencia conserva los IDs de remakes intercalados entre las victorias extremas.

Una derrota corta la secuencia. Un resultado desconocido, remake desconocido o grupo de partidas competitivas con el mismo instante corta y añade incertidumbre. Otras colas se filtran: una derrota de Flex no corta una racha SoloQ. Partidas anteriores a la temporada no se usan para completar cinco victorias.

Se evalúa la **racha histórica máxima importada**, no la racha activa. Una derrota posterior no elimina una racha anterior. En empates se conserva la primera cronológicamente.

- Máxima registrada ≥5: `observed`, incluso con backfill parcial, detalles no disponibles o incertidumbre fuera de esa racha.
- Sin racha suficiente y con incertidumbre o menos de cinco partidas competitivas conocidas: `insufficient_evidence`.
- Sin racha suficiente, al menos cinco partidas conocidas y sin interrupciones inciertas: `not_observed`, aunque la temporada importada sea parcial.

Cuatro victorias como única muestra **no** producen `not_observed`: producen evidencia insuficiente. El estado no observado significa “no aparece en estos registros”, nunca “no ocurrió en la temporada”.

Una partida ausente sin fila no genera automáticamente una barrera: cinco victorias disponibles pueden parecer consecutivas. Importar después una derrota intercalada puede cambiar el resultado. Elevar el mínimo a siete o diez no resuelve ese problema.

**RECOMENDACIÓN.** Mantener la señal positiva provisional acompañada de la limitación explícita del intervalo; no exigir una muestra adicional arbitraria de 50 partidas para una racha individual. Para permanencia sería necesaria una política de evidencia independiente, no solo una muestra mayor.

## 5. Calidad de datos, estados y hallazgos

| Clasificación    | Hallazgo                                                                                                                                                         | Consecuencia / propuesta                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| HECHO VERIFICADO | Los criterios visibles de Resurrección dicen “recuperación ≤30 días”, sin indicar que el reloj empieza en A.                                                     | Ambigüedad de redacción confirmada; aclararla requiere autorización para cambiar código.                |
| HECHO VERIFICADO | `intervalCoverage` solo admite `unproven`; `completed` y contadores reconciliados no prueban ausencia de partidas desconocidas.                                  | Mantener límites; no convertir I4 en una regla activa sin un contrato y fuente verificables.            |
| HECHO VERIFICADO | Imparable puede ser positivo con importación parcial y negativo limitado con muestra suficiente pero parcial.                                                    | Contrato consistente con observación, peligro si se presenta como resultado definitivo.                 |
| HECHO VERIFICADO | R1 corta cualquier cambio de división.                                                                                                                           | Excluye recuperaciones entre divisiones por diseño, no por una resta errónea de LP.                     |
| HECHO VERIFICADO | `rankCheckedAt` se actualiza tras una verificación satisfactoria; solo se inserta snapshot si cambia el estado ranked, falta una fila o comienza otra temporada. | Un hueco entre snapshots no equivale a un hueco sin verificaciones de Riot.                             |
| HECHO VERIFICADO | Comparabilidad comparte el máximo de siete días con la trayectoria de rango.                                                                                     | Cambiar ese límite no es un ajuste aislado de producto; estudiar contratos y regresiones, sin tocar LP. |
| HECHO VERIFICADO | Resurrección conserva búsqueda cuadrática en el peor caso, con descarte previo seguro de segmentos imposibles.                                                   | No rehacer el motor en una auditoría de reglas.                                                         |
| HIPÓTESIS        | Mayor densidad de snapshots aumenta oportunidades de capturar caídas/recuperaciones.                                                                             | Sesgo de observabilidad plausible; no se midió una tasa causal en staging.                              |
| HIPÓTESIS        | Un nombre compartido puede confundir premio relativo y señal individual.                                                                                         | Proponer subtítulos distintos; no se realizó investigación con usuarios.                                |

La lectura del módulo ya materializa contexto, snapshots y partidas en una transacción PostgreSQL `REPEATABLE READ READ ONLY`; la evaluación sucede después. Esto evita mezclar snapshots de consultas relacionadas, pero no demuestra integridad histórica ni sincroniza atómicamente todo el perfil.

Más observaciones pueden detectar mínimos antes invisibles, pero también incorporar barreras o evidencia contradictoria. Los resultados no son necesariamente monotónicos al añadir información.

Una entrada corrupta se distingue de información insuficiente. Un fallo de infraestructura produce disponibilidad neutral del servicio, no `not_observed`. La validación precede al filtrado del motor: un registro corrupto también puede invalidar un conjunto, en lugar de omitirse silenciosamente.

**No se confirmó un defecto numérico en los evaluadores actuales.** Sí se confirmaron límites de observación, una ambigüedad de texto y diferencias de semántica con el premio comunitario.

## 6. Alternativas de Resurrección

### R1 — Conservar la regla actual

50 LP; misma división/tier; recuperación al menos hasta A en 30 días desde A; huecos ≤7 días; contadores coherentes y actividad de derrota/victoria.

Ventaja: caída expresada en LP oficiales comparables. Limitación: excluye una recuperación con descenso entre divisiones y depende de que el mínimo haya sido observado. Complejidad: implementación existente, peor caso cuadrático; no se cambia.

### R2 — Cruces con coordenada ordinal explícita, solo como hipótesis de análisis

Para Iron…Diamond y divisiones IV…I, probar:

`Q = 100 × (4 × índiceTier + índiceDivisión) + LP_oficial`

Índices de tier 0…6 y división IV=0, III=1, II=2, I=3. Exigir `Q_A-Q_B >=50` y `Q_C>=Q_A`, el plazo R1 y las mismas garantías de tiempo/contadores; rechazar LP fuera de [0,100) en este prototipo. Dentro de un mismo tier/división apex puede usarse su LP oficial; cualquier cruce hacia/entre apex se corta.

**HIPÓTESIS.** Q conserva una ordenación de posiciones ranked, pero su diferencia es una **magnitud ordinal convencional**, no LP realmente perdidos/ganados ni una trayectoria reconstruida. Solo usa extremos oficiales; no usa MATCH-V5 para rango. No reutiliza la coordenada no lineal del gráfico apex.

Riot describe promociones por 100 LP y transferencia de excedentes, pero también protección y reinicios de LP al descender de tier. Esto justifica estudiar un orden por divisiones, **no demuestra que Q sea una métrica oficial universal de LP**. Ver [promociones, descensos y decay](https://support.riotgames.com/en-us/league-of-legends/gameplay/placements-promotions-series-demotions-and-decay), [MMR, rango y LP](https://support.riotgames.com/en-us/league-of-legends/gameplay/mmr-rank-and-lp) y [tiers apex](https://support.riotgames.com/es-mx/league-of-legends/gameplay/master-grandmaster-and-challenger-the-apex-tiers/).

**RECOMENDACIÓN.** No adoptar R2 como “caída de 50 LP entre divisiones”. Una variante cualitativa futura podría exigir descenso de al menos una división y regreso al tier/división y LP iniciales, con etiqueta “recuperación de rango” y parámetros propios. Esa variante no se simuló ni está aprobada. Especialmente los cruces de tier necesitan una decisión independiente.

### R3 — Reloj desde B y caída acotada

Mantener 50 LP, misma división/tier, huecos ≤7 días y contadores. Probar recuperación en ≤30 días desde un mínimo B, exigiendo además caída A→B en ≤7 días. Episodio total acotado a 37 días.

**HIPÓTESIS.** Se parece más a “recuperarse en un mes desde tocar fondo”, pero no es un superconjunto de R1: acepta recuperaciones más tardías y rechaza caídas lentas. El modelo exhaustivo de análisis admite mínimos repetidos que satisfacen ambas ventanas; no define una nueva política de selección de evidencia. Antes de implementarlo habría que decidir si el reloj comienza en el primer mínimo elegible o puede reiniciarse con otro mínimo igual. No se debe permitir un reinicio indefinido por mínimos repetidos.

**RECOMENDACIÓN.** No cambiar silenciosamente el reloj. Elegir R3 solo si esa es la intención de producto, con una versión nueva y pruebas de mínimos empatados, plazos y anclas.

| Alternativa | Equidad / falsos negativos                            | Riesgo de falso positivo interpretativo             | Evidencia / comprensión                             | Complejidad y coste                                                                           |
| ----------- | ----------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| R1          | Penaliza huecos y cruces; observabilidad desigual     | Mínimo intermedio desconocido, ajustes posibles     | LP comparable; reloj A necesita explicación         | Existente; peor caso O(n²)                                                                    |
| R2          | Recupera cruces antes excluidos; depende de snapshots | Confundir unidades ordinales con LP, saltos de tier | Menos intuitiva; excluir apex y explicar orden      | Búsqueda similar + normalización; modelo exhaustivo de auditoría O(n⁴), no apto para integrar |
| R3          | Más margen tras B, menos ante caída lenta             | Ventanas y mínimos repetidos mal definidos          | “30 días desde el mínimo” requiere regla de anclaje | Algoritmo nuevo a diseñar; prototipo exhaustivo O(n⁴)                                         |

No hay datos para cuantificar falsos positivos/negativos respecto de la trayectoria real; son riesgos, no tasas medidas.

## 7. Alternativas de Imparable

| Alternativa | Condición propuesta                               | Beneficio                               | Limitación                                                            |
| ----------- | ------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------- |
| I1          | ≥5 victorias registradas                          | Señal accesible y fácil de entender     | No acredita partidas ausentes                                         |
| I2          | ≥7 victorias registradas                          | Exigencia deportiva mayor               | Menos señales; misma incertidumbre histórica                          |
| I3          | ≥10 victorias registradas                         | Evento más infrecuente en esta muestra  | No equivale a mejor evidencia; puede excluir muchas muestras pequeñas |
| I4          | ≥5 y prueba verificable del intervalo de la racha | Separa calidad de evidencia de longitud | Actualmente no existe esa prueba en el contrato; no puede activarse   |

Todos conservan colas y temporadas separadas, remakes confirmados excluidos, barreras de desconocidos, duplicados y determinismo. No proponen mezclar SoloQ/Flex ni exigir que la racha siga activa.

**DECISIÓN PENDIENTE.** Niveles futuros 5/7/10 podrían llamarse “destacada”, “excepcional” y “extraordinaria”; no son nuevos logros aprobados. Su rareza no debe inferirse de una comunidad pequeña ni de muestras incompletas.

Para I4, “prueba del intervalo” significaría reconciliar los IDs recuperables de esa cola/temporada entre primera y última victoria, resolver cada detalle y conservar límites/cursor/fecha de verificación y las exclusiones. Incluso eso acreditaría una política explícita de SoloQ sobre datos disponibles, **no una certificación oficial de Riot ni exhaustividad absoluta de su historial**. Un `backfillStatus=completed` global, disponibilidad de detalles o `lastSyncedAt` aislados no sustituyen esa evidencia.

El análisis I4 usa una marca de prueba puramente sintética para comparar estados; **no existe ni se incorporó un nuevo valor válido de `intervalCoverage`**. Sin prueba, una racha I1 positiva pasa a evidencia insuficiente en el modelo I4.

**RECOMENDACIÓN.** Mantener I1 para observaciones; estudiar I4 antes de autorizar concesiones permanentes. Siete y diez pueden servir para intensidad futura, no para ocultar problemas de cobertura.

## 8. Simulaciones controladas ejecutadas

Node 24.19.0, fixtures ficticios de `tests/achievements-fixtures.ts`. Se ejecutó por stdin con `node --import tsx --input-type=module`, sin añadir helpers a la aplicación. El apéndice A conserva el código reproducible. No se alteraron parámetros por defecto.

R1 usa el evaluador real. R2/R3 son modelos independientes y exhaustivos de **estado**, sin prometer equivalencia de toda la selección de evidencia. I1/I2/I3 usan configuraciones aisladas de la API pura existente; I4 es una hipótesis local de cobertura.

Leyenda: **O** observado; **N** no observado en los registros; **E** evidencia insuficiente; **X** entrada inválida. Cada fila es el resultado ejecutado de la alternativa descrita, no una regla aprobada.

### Resurrección: 25 escenarios

| Caso controlado                                      | R1  | R2  | R3  |
| ---------------------------------------------------- | --- | --- | --- |
| Caída exacta 80→30→80 LP                             | O   | O   | O   |
| Caída de 49 LP: 80→31→80                             | N   | N   | N   |
| Recuperación exacta: 80→25→80                        | O   | O   | O   |
| Recuperación incompleta: 80→30→79                    | N   | N   | N   |
| Recuperación a 30 días desde A                       | O   | O   | O   |
| 30 días +1 ms desde A, B al día 1                    | N   | N   | O   |
| Recuperación al día 37, B al día 7                   | N   | N   | O   |
| Día 37 +1 ms, B al día 7                             | N   | N   | N   |
| Diamond I 80→Diamond II 30→Diamond I 80              | E   | O   | E   |
| Gold IV 20→Silver I 60→Gold IV 20                    | E   | O   | E   |
| Diamond II 80→Diamond I 10→Diamond II 80             | E   | N   | E   |
| Cambio Master→Grandmaster→Master                     | E   | E   | E   |
| Hueco exacto de 7 días                               | O   | O   | O   |
| Hueco de 7 días +1 ms                                | E   | E   | E   |
| Reset de contadores                                  | E   | E   | E   |
| Solo dos snapshots                                   | E   | E   | E   |
| IDs distintos en el mismo instante                   | E   | E   | E   |
| Mismo ID con LP contradictorio                       | X   | X   | X   |
| Varias recuperaciones                                | O   | O   | O   |
| Solo 80→60→80 observado, sin mínimo oculto inventado | N   | N   | N   |
| Sin incremento de derrotas hasta B                   | N   | N   | N   |
| Sin incremento de victorias B→C                      | N   | N   | N   |
| A fuera de temporada, solo B/C dentro                | E   | E   | E   |
| Caída dura 14 días, recuperación al día 15           | O   | O   | N   |
| Unranked previo, después segmento limpio válido      | O   | O   | O   |

En los episodios largos se incluyeron observaciones intermedias para no introducir un hueco >7 días involuntario. En el caso multicaída, el motor seleccionó C al día 2 y caída de 60 LP, aunque después existe una caída de 70 LP.

### Imparable: 20 escenarios

| Caso controlado                                         | I1:5 | I2:7 | I3:10 | I4:5+calidad |
| ------------------------------------------------------- | ---- | ---- | ----- | ------------ |
| Cuatro victorias, única muestra                         | E    | E    | E     | E            |
| Cinco victorias                                         | O    | E    | E     | E            |
| Siete victorias                                         | O    | O    | E     | E            |
| Diez victorias                                          | O    | O    | O     | E            |
| 3 victorias, derrota, 2 victorias                       | N    | E    | E     | N            |
| 3 victorias, remake confirmado, 2 victorias             | O    | E    | E     | E            |
| Resultado desconocido intercalado                       | E    | E    | E     | E            |
| Remake desconocido intercalado                          | E    | E    | E     | E            |
| Historial parcial con diez victorias                    | O    | O    | O     | E            |
| Completed con diez victorias, sin prueba del intervalo  | O    | O    | O     | E            |
| Cinco victorias con una partida ausente no representada | O    | E    | E     | E            |
| Importar después la derrota que faltaba                 | N    | E    | E     | N            |
| Derrota de otra cola intercalada                        | O    | E    | E     | E            |
| Una victoria de temporada previa + cuatro actuales      | E    | E    | E     | E            |
| Timestamps competitivos coincidentes                    | E    | E    | E     | E            |
| Duplicado idéntico                                      | O    | E    | E     | E            |
| Duplicado contradictorio                                | X    | X    | X     | X            |
| Cinco victorias con marca de prueba local, solo fixture | O    | E    | E     | O            |
| Desconocido antes de cinco victorias limpias            | O    | E    | E     | E            |
| Racha histórica de cinco terminada en derrota           | O    | E    | E     | E            |

Se verificaron 25 equivalencias de estado entre el modelo R1 de análisis y el motor; 90 aserciones de ausencia de concesión/certificación sobre las 45 entradas; y dos aserciones de selección determinista. Las tablas de alternativas son resultados del experimento, **no 45 nuevos tests incorporados a CI ni una validación definitiva de R2/R3/I4**.

## 9. Evidencia agregada de Neon staging

**HECHO VERIFICADO.** Acceso mediante el conector Neon ya autorizado, proyecto `solo1`, rama verificada `staging` en estado Ready y base `neondb`. Exclusivamente SELECT agregados; no se obtuvieron credenciales nuevas, no se consultó la base Production y no se mostraron nombres, PUUID ni IDs de jugadores.

Cohorte: 19 jugadores habilitados, todos LA2. Temporada 2026 desde `2026-01-08T15:00:00Z`. Corte de eventos: `2026-10-11T11:50:08.350Z`. Las consultas fueron ejecutadas separadamente durante la auditoría, no en una fotografía transaccional conjunta. Los apéndices B/C conservan consultas reproducibles; sus resultados futuros pueden cambiar por importación concurrente de eventos anteriores al corte.

### Snapshots oficiales

| Medida                                                 | SoloQ   | Flex    |
| ------------------------------------------------------ | ------- | ------- |
| Snapshots almacenados en el corte                      | 63      | 46      |
| Jugadores con al menos uno                             | 19      | 19      |
| Jugadores con al menos tres                            | 10      | 6       |
| Media entre snapshots adyacentes                       | 25,73 h | 25,16 h |
| Mediana entre snapshots adyacentes                     | 16,04 h | 16,09 h |
| Huecos adyacentes >7 días                              | 0       | 0       |
| Transiciones adyacentes de tier/división               | 20      | 9       |
| Resets de contadores / filas con timestamp ambiguo     | 0 / 0   | 0 / 0   |
| Caídas de ≥50 LP entre extremos adyacentes comparables | 0       | 0       |

Primera observación: `2026-10-06T01:08:43.779Z`. Últimas: SoloQ `2026-10-11T11:40:31.700Z`, Flex `2026-10-11T11:39:35.814Z`.

**Limitación de frecuencia.** Se midieron intervalos entre **cambios ranked almacenados**, no frecuencia de verificaciones. La última `rankCheckedAt` no reconstruye el calendario de verificaciones anteriores. Tampoco cero caídas adyacentes demuestra cero caídas acumuladas o no observadas.

Una búsqueda SQL adicional de tríos A/B/C, mínimos intermedios y barreras produjo:

| Modelo agregado de R1                                           | SoloQ | Flex |
| --------------------------------------------------------------- | ----- | ---- |
| Jugadores con candidato observado                               | 0     | 0    |
| Menos de tres observaciones o barreras: evidencia limitada      | 17    | 16   |
| Al menos tres, sin barreras ni candidato: no observado limitado | 2     | 3    |

Estos recuentos son un modelo SQL de las condiciones auditadas, **no ejecuciones del DTO del perfil sobre datos brutos ni certificaciones de ausencia**. No se midió latencia del motor en Neon.

La consulta exploratoria R2 de tríos que cruzan rangos estándar, conservando contadores, mínimos y huecos, no encontró candidatos. Las 20/9 transiciones **no son 20/9 recuperaciones descartadas**. En este corte no se demuestra un caso real que R2 rescataría; los fixtures sí muestran esa diferencia semántica. La falta de evidencia se cuantifica con los 17/16 casos limitados, sin atribuirles una recuperación real que no conocemos.

### Partidas y rachas máximas registradas

| Medida                                                  | SoloQ | Flex  |
| ------------------------------------------------------- | ----- | ----- |
| Jugadores considerados, incluidos sin filas de esa cola | 19    | 19    |
| Participaciones importadas                              | 1.247 | 1.130 |
| Remakes confirmados                                     | 53    | 30    |
| Remakes desconocidos / resultados desconocidos          | 0 / 0 | 0 / 0 |
| Jugadores con racha ≥5                                  | 8     | 7     |
| Jugadores con racha ≥7                                  | 5     | 3     |
| Jugadores con racha ≥10                                 | 1     | 0     |
| Racha ≥5 con backfill no completado                     | 6     | 3     |

Distribución de máximos por jugador:

| Cola  | Longitud → jugadores                        |
| ----- | ------------------------------------------- |
| SoloQ | 1→3; 2→2; 3→2; 4→4; 5→2; 6→1; 8→4; 13→1     |
| Flex  | 0→2; 1→1; 2→2; 3→4; 4→3; 5→3; 6→1; 7→1; 9→2 |

Backfill de la cohorte: 10 completados y 9 en curso; cero detalles marcados no disponibles. En los completados, procesados y descubiertos coinciden; en los nueve en curso todavía difieren. Son contadores globales del jugador, no cobertura certificada de cada cola. Una comprobación agregada adicional confirmó que los 19 usan backfill de temporada 2026 y tienen una última verificación de rango registrada; esto no reconstruye sus verificaciones anteriores.

**Anomalía observada.** Dos consultas con el mismo corte de eventos contaron 1.246 y después 1.247 participaciones SoloQ. Un corte de timestamp no congela la inserción posterior de partidas históricas. La causa operacional concreta no se investigó; no se inició ninguna sincronización. Se conserva el último recuento para la tabla y se evita presentar el conjunto de consultas como atómico.

**RECOMENDACIÓN.** Repetir esta auditoría en una ventana más amplia y con cohortes comparables, agrupando frecuencia de observación, cola y cobertura. No usar estos recuentos como rareza definitiva ni como porcentajes de temporada completa.

## 10. Falsos positivos, falsos negativos y equidad

| Riesgo                        | Resurrección                                                                        | Imparable                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Falso positivo interpretativo | Presentar extremos y actividad como trayectoria o causalidad exclusiva por partidas | Presentar cinco victorias importadas como secuencia exhaustiva certificada             |
| Falso negativo observacional  | Mínimo no registrado, cambio de división, hueco, episodio fuera de ventana          | Derrota/resultado desconocido que corta; victoria aún no importada; cruce de temporada |
| Cambio por nuevos datos       | Un nuevo mínimo o barrera puede cambiar candidato/estado                            | Una derrota faltante puede deshacer la racha; nuevas victorias pueden ampliarla        |
| Sesgo de disponibilidad       | Sincronizaciones más densas capturan más eventos, sin garantía de mejora monotónica | Backfills avanzados ofrecen más oportunidades de observar rachas                       |
| Umbral más alto               | No corrige datos escasos y excluye recuperaciones menores                           | Reduce eventos observados, sin resolver partidas ausentes                              |

**HIPÓTESIS.** Los thresholds pueden expresar intensidad competitiva, pero no calidad de adquisición. No hay un ground truth completo para calcular sensibilidad, especificidad ni tasas reales de error.

**RECOMENDACIÓN.** Comparar jugadores con cobertura visible y evitar clasificaciones permanentes basadas en capacidad desigual de observación. No alterar Fair Scheduling en esta fase.

## 11. Premio comunitario y nomenclatura

**HECHO VERIFICADO.** El Salón de Honor selecciona el mayor `winStreak` entre jugadores con al menos 10 partidas válidas en la cola y período escogidos; requiere racha mínima de dos. Empates: más partidas, nombre e ID. Los períodos pueden ser temporada, 30d o 7d; la vista 5v5 es admisible en el premio, mientras el logro individual solo evalúa ranked independientes.

El SQL comunitario usa `coalesce(is_remake, false)`: un remake desconocido se trata como no remake, a diferencia del evaluador experimental que lo corta. Sus filtros de duración/estadísticas y orden timestamp/ID tampoco son idénticos. Por ello ni siquiera debe exigirse igualdad de resultados entre ambos sistemas ante datos inciertos. No se modifica el premio.

| Producto                                     | Naturaleza                                                       | Nombre propuesto, pendiente                |
| -------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| Salón de Honor                               | Comparativo, del período, puede cambiar de líder                 | **Imparable · líder de racha del período** |
| Señal experimental individual                | Condición absoluta ≥5 registrada; varias personas pueden cumplir | **Racha destacada · señal experimental**   |
| Si se conserva la marca individual Imparable | Mismo criterio individual, sin propiedad permanente              | **Imparable · señal individual**           |

El premio relativo debe permanecer en el Salón. La condición individual podría sustentar una insignia futura solo con política de concesión aprobada. No se concede ni equipa nada durante esta revisión.

## 12. Propuesta de textos de UX

Todas las propuestas requieren aprobación posterior; no están implementadas.

| Situación                                   | Texto propuesto                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resurrección observada                      | “Recuperaste el nivel de LP previamente observado: A → B → C. Son extremos oficiales; no conocemos toda la trayectoria.”                                      |
| Criterio R1                                 | “Caída observada ≥50 LP; vuelta al nivel inicial en ≤30 días desde la observación anterior a la caída. Mismo tier/división y huecos entre snapshots ≤7 días.” |
| Rango interrumpido                          | “No hay un tramo comparable suficiente: faltan observaciones o cambia el rango.”                                                                              |
| Imparable observado                         | “Racha de N victorias en la secuencia importada de esta cola.”                                                                                                |
| Cobertura parcial o intervalo no acreditado | “No podemos confirmar que no falten partidas entre estas victorias. Esta señal puede cambiar al importar más datos.”                                          |
| No observado                                | “La condición no aparece en los registros disponibles. Esto no demuestra que nunca haya ocurrido.”                                                            |
| Evidencia insuficiente                      | “Los datos disponibles no permiten comprobar la condición.”                                                                                                   |
| Entrada inválida                            | “No se pudo evaluar esta evidencia porque contiene datos incompatibles.”                                                                                      |
| Fallo de lectura                            | “Evaluación temporalmente no disponible. No se ha determinado el resultado.”                                                                                  |
| Señal y premio                              | “Evaluación individual experimental, independiente del premio comunitario del período.”                                                                       |

Mantener separados estado del criterio, estado de cobertura y disponibilidad del servicio. Una advertencia no debería convertir automáticamente una observación en concesión ni una ausencia de datos en derrota.

## 13. Recomendación y decisiones pendientes

**RECOMENDACIÓN para Resurrección:** conservar R1, explicitar que recuperar es alcanzar A, que el reloj empieza en A y que B es mínimo observado. No bajar 50 LP ni ampliar siete días por la escasez actual de snapshots. Si se busca inclusividad, diseñar después una recuperación cualitativa entre divisiones antes que reutilizar una falsa suma de LP.

**RECOMENDACIÓN para Imparable:** conservar I1 como racha histórica registrada, sin muestra adicional arbitraria; mostrar límites del intervalo. Estudiar I4 para permanencia, independientemente de posibles niveles 7/10. Separar su nombre del premio relativo.

**DECISIONES PENDIENTES:**

1. Confirmar si Resurrección expresa recuperación en 30 días desde A o desde B.
2. Confirmar 50 LP, siete días y recuperación por igualdad como criterios de producto.
3. Elegir si se admite cruce de división, de tier o ninguno; no agrupar estas decisiones con apex.
4. Si se elige R3, definir primer mínimo, mínimos empatados, duración de caída y selección determinista.
5. Confirmar racha histórica frente a activa y mínimo cinco; decidir si 7/10 serían niveles futuros.
6. Aprobar nomenclatura distinta para señal individual y premio comunitario.
7. Aprobar textos de incertidumbre, sin alterar OTP.
8. Definir alcance, prueba mínima, invalidación y permanencia antes de conceder insignias.

Primera tarea posterior recomendada: aprobar la semántica temporal y los textos R1/I1; implementar solo esa aclaración en catálogo/presentación y sus pruebas. Una redefinición R2/R3/I4 sería otra tarea, con versión y evidencia propias.

## 14. Versionado, reevaluación y persistencia futura

**HECHO VERIFICADO.** Resurrección e Imparable comparten actualmente `1.1.A-observed-v1`; OTP tiene versión independiente v2. Cualquier cambio semántico exige identificadores específicos, por ejemplo `1.1-resurrection-observed-v2` y `1.1-unstoppable-observed-v2`, **nombres propuestos, no registrados**. Actualizar también validadores, catálogo, evidencia y tests; no incrementar OTP incidentalmente.

**RECOMENDACIÓN.** Reevaluar observaciones al consultar nuevos datos, conservando en una futura auditoría el alcance jugador/cola/plataforma/temporada, versión, parámetros exactos, corte de lectura, evidencia usada, exclusiones y razones. No declarar “obtenido el día X” a partir de una importación tardía.

Si una nueva derrota o snapshot contradictorio invalida una observación previa, mostrar su revisión como tal. Para concesiones persistentes sería necesario decidir previamente si revocar, revisar o conservar un evento histórico acreditado: no borrar ni conceder automáticamente por esta propuesta.

Evidencia mínima propuesta para una concesión futura:

- Resurrección: A/B/C oficiales, originales y trazables; todas las observaciones comparables del intervalo; barreras/counters verificables; semántica aprobada que siga limitada a extremos observados.
- Imparable: IDs y resultados de todas las partidas del tramo según una política de reconciliación explícita; remakes resueltos; orden, cola, temporada, plataforma y límites acreditados. Completed global no basta.
- Ambas: regla aprobada, versión y parámetros inmutables, evaluación reproducible e identidad idempotente del evento. Evaluación y concesión serían acciones separadas y auditables.
- Equipamiento de título sería otra capa y otra autorización. Ninguna propuesta implica certificación de Riot.

No se propone todavía una tabla, migración ni mecanismo de persistencia. La documentación delimita requisitos para una decisión posterior.

## 15. Validación y límites de esta entrega

**HECHO VERIFICADO.** Runtime utilizado: Node **24.19.0**, compatible con `package.json`. El Node por defecto 25.8.2 sigue fuera del rango; se eligió el runtime ya instalado mediante PATH solo del proceso. No se modificó instalación, PATH global ni archivos de entorno.

| Comprobación                                                | Resultado                                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| `npm run lint`                                              | Correcto                                                                   |
| `npm run typecheck`                                         | Correcto                                                                   |
| `npm run test`                                              | 45 archivos aprobados; 2 omitidos; **777 pruebas aprobadas y 10 omitidas** |
| `npm run build`                                             | Correcto; Next.js 16.3.8                                                   |
| Simulación local independiente                              | 25 casos R + 20 casos I; equivalencia y restricciones verificadas          |
| SQL staging                                                 | SELECT agregados; no escrituras                                            |
| Código, consultas de negocio, reglas y fixtures modificados | Ninguno                                                                    |

Las diez omisiones son opt-in de PostgreSQL local con sesiones independientes: seis de logros y cuatro del lease/progreso. No se aprovisionó una base para esta auditoría. Las pruebas PGlite y simulaciones controladas incluidas en las 777 sí pasaron; no sustituyen todos los escenarios de sesiones PostgreSQL reales. No se añadieron tests rutinarios ni benchmarks nuevos. El análisis exhaustivo solo se usó con fixtures pequeños; no se debe integrar como evaluador.

No se midió rendimiento remoto, no se inspeccionó Preview visualmente, no se verificó exhaustividad de Riot y no se cuantificaron tasas reales de error. Esta tarea no requiere un deployment.

Entrega exclusivamente documental, con un único commit local autorizado si la revisión final confirma el alcance. Sin push, deployment, cambio de flag, llamadas Riot, sincronización, migración ni cambios de Production/main. Los archivos protegidos y cambios ajenos permanecen intactos.

## Apéndice A — Simulación local reproducible, no lógica activa

Ejecutar desde la raíz auditada con Node 24 y las dependencias instaladas. En PowerShell, pegar el bloque JavaScript siguiente en un here-string y pasarlo por stdin:

```powershell
@'
# Sustituir esta línea por el bloque JavaScript siguiente.
'@ | node --import tsx --input-type=module
```

No requiere base de datos ni variables de activación. El modelo R2/R3 es intencionalmente exhaustivo y solo apropiado para estos fixtures pequeños; no concede nada ni introduce versiones nuevas en el motor.

```javascript
import assert from "node:assert/strict";
import {
  evaluateResurrection,
  evaluateUnstoppable,
  UNSTOPPABLE_RULE,
} from "./src/lib/achievements/index.ts";
import { parseRankInput, scopeBounds, scopeQueue } from "./src/lib/achievements/validation.ts";
import { validRankObservation } from "./src/lib/rank-trajectory.ts";
import { DAY, rankInput, snapshot, matchContext, match } from "./tests/achievements-fixtures.ts";
const tiers = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND"];
const divs = ["IV", "III", "II", "I"];
// Audit-only exhaustive model. Its coordinate is an ordinal convention, never historical LP.
function analyzeRank(input, policy = "R1") {
  const p = parseRankInput(input);
  if (!p.ok) return "invalid_input";
  const { scope, snapshots } = p.value;
  const bounds = scopeBounds(scope),
    ids = new Map(),
    anon = new Set(),
    unique = [];
  for (const x of snapshots) {
    const key = JSON.stringify(x);
    const prev = x.id ? ids.get(x.id) : null;
    if (prev && prev !== key) return "invalid_input";
    if (prev || (!x.id && anon.has(key))) continue;
    if (x.id) ids.set(x.id, key);
    else anon.add(key);
    unique.push(x);
  }
  const points = unique
    .filter(
      (x) =>
        x.queue === scopeQueue(scope) &&
        Date.parse(x.timestamp) >= bounds.start &&
        Date.parse(x.timestamp) < bounds.end,
    )
    .sort(
      (a, b) =>
        Date.parse(a.timestamp) - Date.parse(b.timestamp) || (a.id ?? "").localeCompare(b.id ?? ""),
    );
  const value = (x) =>
    policy === "R2" && tiers.includes(x.tier)
      ? 100 * (4 * tiers.indexOf(x.tier) + divs.indexOf(x.division)) + x.leaguePoints
      : x.leaguePoints;
  const comparable = (a, b) =>
    policy === "R2" && tiers.includes(a.tier) && tiers.includes(b.tier)
      ? true
      : a.tier === b.tier && a.division === b.division;
  const segments = [];
  let current = [],
    previous = null,
    interrupted = false,
    validCount = 0;
  const finish = () => {
    if (current.length) segments.push(current);
    current = [];
  };
  for (let i = 0; i < points.length;) {
    let j = i + 1;
    while (j < points.length && Date.parse(points[j].timestamp) === Date.parse(points[i].timestamp))
      j++;
    const x = points[i];
    if (
      j - i > 1 ||
      !validRankObservation(x) ||
      (policy === "R2" && tiers.includes(x.tier) && x.leaguePoints >= 100)
    ) {
      interrupted = true;
      finish();
      previous = null;
      i = j;
      continue;
    }
    validCount++;
    if (
      previous &&
      (!comparable(previous, x) ||
        x.wins < previous.wins ||
        x.losses < previous.losses ||
        Date.parse(x.timestamp) - Date.parse(previous.timestamp) > 7 * DAY)
    ) {
      interrupted = true;
      finish();
    }
    current.push(x);
    previous = x;
    i = j;
  }
  finish();
  for (const s of segments)
    for (let c = 2; c < s.length; c++)
      for (let a = 0; a < c - 1; a++)
        for (let b = a + 1; b < c; b++) {
          const A = s[a],
            B = s[b],
            C = s[c];
          const time =
            policy === "R3"
              ? Date.parse(C.timestamp) - Date.parse(B.timestamp) <= 30 * DAY &&
                Date.parse(B.timestamp) - Date.parse(A.timestamp) <= 7 * DAY
              : Date.parse(C.timestamp) - Date.parse(A.timestamp) <= 30 * DAY;
          if (
            time &&
            value(A) - value(B) >= 50 &&
            value(C) >= value(A) &&
            B.losses > A.losses &&
            C.wins > B.wins &&
            s.slice(a, c + 1).every((x) => value(x) >= value(B))
          )
            return "observed";
        }
  return interrupted || validCount < 3 ? "insufficient_evidence" : "not_observed";
}
const long = (end, b = 1) => [
  snapshot(80, 0),
  snapshot(30, b),
  ...Array.from({ length: Math.floor((end - b) / 7) }, (_, i) =>
    snapshot(30, b + 7 * (i + 1)),
  ).filter((x) => Date.parse(x.timestamp) < Date.parse(snapshot(80, end).timestamp)),
  snapshot(80, end),
];
const rcases = [
  ["50 LP exactos", [snapshot(80, 0), snapshot(30, 1), snapshot(80, 2)]],
  ["49 LP", [snapshot(80, 0), snapshot(31, 1), snapshot(80, 2)]],
  ["Recuperación exacta", [snapshot(80, 0), snapshot(25, 1), snapshot(80, 2)]],
  ["Recuperación incompleta", [snapshot(80, 0), snapshot(30, 1), snapshot(79, 2)]],
  ["30 días desde A", long(30)],
  ["30 días + 1 ms desde A", long(30 + 1 / DAY)],
  ["30 días desde B (caída 7 días)", long(37, 7)],
  ["30 días + 1 ms desde B", long(37 + 1 / DAY, 7)],
  [
    "Descenso y regreso de división",
    [snapshot(80, 0), snapshot(30, 1, { division: "II" }), snapshot(80, 2)],
  ],
  [
    "Descenso y regreso de tier",
    [
      snapshot(20, 0, { tier: "GOLD", division: "IV" }),
      snapshot(60, 1, { tier: "SILVER", division: "I" }),
      snapshot(20, 2, { tier: "GOLD", division: "IV" }),
    ],
  ],
  [
    "Promoción y regreso (sin caída ordinal)",
    [snapshot(80, 0, { division: "II" }), snapshot(10, 1), snapshot(80, 2, { division: "II" })],
  ],
  [
    "Cambio apex",
    [
      snapshot(180, 0, { tier: "MASTER" }),
      snapshot(125, 1, { tier: "GRANDMASTER" }),
      snapshot(180, 2, { tier: "MASTER" }),
    ],
  ],
  ["Hueco 7 días", [snapshot(80, 0), snapshot(30, 7), snapshot(80, 8)]],
  ["Hueco 7 días + 1 ms", [snapshot(80, 0), snapshot(30, 7 + 1 / DAY), snapshot(80, 8)]],
  [
    "Reset de contadores",
    [snapshot(80, 0), snapshot(30, 1, { wins: 1, losses: 1 }), snapshot(80, 2)],
  ],
  ["Dos snapshots", [snapshot(80, 0), snapshot(30, 1)]],
  [
    "Fechas coincidentes",
    [snapshot(80, 0), snapshot(30, 1), snapshot(30, 1, { id: "other" }), snapshot(80, 2)],
  ],
  [
    "Duplicado contradictorio",
    [snapshot(80, 0), snapshot(30, 1), snapshot(31, 1), snapshot(80, 2)],
  ],
  [
    "Varias recuperaciones",
    [snapshot(80, 0), snapshot(20, 1), snapshot(80, 2), snapshot(10, 3), snapshot(99, 4)],
  ],
  ["Sin mínimo oculto en los registros", [snapshot(80, 0), snapshot(60, 1), snapshot(80, 2)]],
  ["Sin aumento de derrotas", [snapshot(80, 0), snapshot(30, 1, { losses: 10 }), snapshot(80, 2)]],
  ["Sin aumento de victorias", [snapshot(80, 0), snapshot(30, 1), snapshot(80, 2, { wins: 21 })]],
  [
    "Cruce de temporada",
    [snapshot(80, 0, { timestamp: "2025-12-31T23:00:00Z" }), snapshot(30, 1), snapshot(80, 2)],
  ],
  ["Caída dura 14 días", [snapshot(80, 0), snapshot(60, 7), snapshot(30, 14), snapshot(80, 15)]],
  [
    "Unranked y segmento limpio posterior",
    [
      snapshot(80, 0),
      snapshot(30, 1, { tier: "UNRANKED" }),
      snapshot(80, 2),
      snapshot(30, 3),
      snapshot(80, 4),
    ],
  ],
];
const routput = rcases.map(([name, rows]) => {
  const input = rankInput(rows),
    R1 = evaluateResurrection(input).status;
  assert.equal(analyzeRank(input), R1, name);
  return { name, R1, R2: analyzeRank(input, "R2"), R3: analyzeRank(input, "R3") };
});
const wins = (n) => Array.from({ length: n }, (_, i) => match(i));
const icases = [
  ...[4, 5, 7, 10].map((n) => [n + " victorias", wins(n)]),
  ["Derrota intercalada", [...wins(3), match(3, { win: false }), match(4), match(5)]],
  [
    "Remake intercalado",
    [...wins(3), match(3, { isRemake: true, win: false }), match(4), match(5)],
  ],
  ["Resultado desconocido", [...wins(3), match(3, { win: null }), match(4), match(5)]],
  ["Remake desconocido", [...wins(3), match(3, { isRemake: null }), match(4), match(5)]],
  ["Historial parcial", wins(10)],
  ["Completed sin prueba de intervalo", wins(10), "completed"],
  ["Partida ausente no representada", Array.from({ length: 5 }, (_, i) => match(i * 2))],
  [
    "Después de importar la derrota ausente",
    [...Array.from({ length: 5 }, (_, i) => match(i * 2)), match(3, { win: false })],
  ],
  [
    "Otra cola intercalada",
    [...wins(3), match(3, { queueId: 440, win: false }), match(4), match(5)],
  ],
  ["Cambio de temporada", [match(-1, { timestamp: "2025-12-31T23:00:00Z" }), ...wins(4)]],
  [
    "Fechas coincidentes",
    [...wins(3), match(3, { timestamp: match(2).timestamp }), match(4), match(5), match(6)],
  ],
  ["Duplicado idéntico", [...wins(5), match(1)]],
  ["Duplicado contradictorio", [...wins(5), match(1, { win: false })]],
  ["Prueba local de intervalo (solo fixture)", wins(5), "completed", true],
  ["Incertidumbre antes de racha limpia", [match(-1, { win: null }), ...wins(5)]],
  ["Racha histórica terminada en derrota", [...wins(5), match(5, { win: false })]],
];
const ioutput = icases.map(([name, rows, historyStatus = "running", proof = false]) => {
  const input = matchContext(rows);
  input.coverage = { ...input.coverage, historyStatus };
  const results = [5, 7, 10].map((minWins) =>
    evaluateUnstoppable(input, { ...UNSTOPPABLE_RULE, minWins }),
  );
  const base = results[0];
  return {
    name,
    I1: base.status,
    I2: results[1].status,
    I3: results[2].status,
    I4:
      base.status === "invalid_input"
        ? base.status
        : base.status === "observed"
          ? proof
            ? "observed"
            : "insufficient_evidence"
          : base.status,
  };
});
const selected = evaluateResurrection(
  rankInput(rcases.find(([name]) => name === "Varias recuperaciones")[1]),
);
assert.equal(selected.evidence.dropLp, 60);
assert.equal(selected.evidence.recovered.timestamp, snapshot(80, 2).timestamp);
for (const [name, rows] of rcases) {
  const result = evaluateResurrection(rankInput(rows));
  assert.equal(result.grantAuthorized, false, name);
  assert.equal(result.certification, "not_established", name);
}
for (const [name, rows] of icases) {
  const result = evaluateUnstoppable(matchContext(rows));
  assert.equal(result.grantAuthorized, false, name);
  assert.equal(result.certification, "not_established", name);
}
console.log(
  JSON.stringify(
    {
      node: process.version,
      resurrection: routput,
      unstoppable: ioutput,
      assertions:
        "25 equivalencias R1 y 90 restricciones de no concesión/certificación; selección determinista verificada",
    },
    null,
    2,
  ),
);
```

## Apéndice B — Consulta agregada de rachas ejecutada

Solo ejecutar con acceso de lectura autorizado a **staging**. No sustituir la rama del conector por su default. Esta consulta no expone identidades; cuenta participaciones, no partidas únicas de toda la comunidad.

```sql
WITH filtered AS (
 SELECT p.id AS player_id,p.backfill_status,m.queue_id,m.timestamp,m.id,pm.win,m.is_remake
 FROM players p JOIN player_matches pm ON pm.player_id=p.id JOIN matches m ON m.id=pm.match_id
 WHERE p.enabled AND m.queue_id IN(420,440) AND m.id LIKE p.platform || '\_%'
 AND m.timestamp >= '2026-01-08T15:00:00Z' AND m.timestamp < '2026-10-11T11:50:08.350Z'
), competitive AS (
 SELECT *,count(*) OVER(PARTITION BY player_id,queue_id,timestamp) AS same_time FROM filtered WHERE is_remake IS DISTINCT FROM true
), ordered AS (
 SELECT *,sum(CASE WHEN win IS DISTINCT FROM true OR is_remake IS NULL OR same_time>1 THEN 1 ELSE 0 END)
 OVER(PARTITION BY player_id,queue_id ORDER BY timestamp,id) AS barrier FROM competitive
), runs AS (
 SELECT player_id,queue_id,barrier,count(*) AS length FROM ordered WHERE win=true AND is_remake=false AND same_time=1 GROUP BY player_id,queue_id,barrier
), by_player AS (
 SELECT p.id AS player_id,q.queue_id,p.backfill_status,coalesce(max(r.length),0) AS max_streak
 FROM players p CROSS JOIN (VALUES(420),(440)) q(queue_id) LEFT JOIN runs r ON r.player_id=p.id AND r.queue_id=q.queue_id
 WHERE p.enabled GROUP BY p.id,q.queue_id,p.backfill_status
)
SELECT q.queue_id, count(*) AS eligible_players,count(*) FILTER(WHERE max_streak>=5) AS players_ge5,
 count(*) FILTER(WHERE max_streak>=7) AS players_ge7,count(*) FILTER(WHERE max_streak>=10) AS players_ge10,
 count(*) FILTER(WHERE max_streak>=5 AND backfill_status<>'completed') AS observed5_partial,
 count(*) FILTER(WHERE max_streak<5) AS below5,
 (SELECT count(*) FROM filtered f WHERE f.queue_id=q.queue_id) AS participation_rows,
 (SELECT count(*) FROM filtered f WHERE f.queue_id=q.queue_id AND f.is_remake IS NULL) AS unknown_remake,
 (SELECT count(*) FROM filtered f WHERE f.queue_id=q.queue_id AND f.win IS NULL) AS unknown_result,
 (SELECT count(*) FROM filtered f WHERE f.queue_id=q.queue_id AND f.is_remake=true) AS confirmed_remakes,
 (SELECT jsonb_object_agg(h.max_streak,h.players ORDER BY h.max_streak) FROM
(SELECT max_streak,count(*) AS players FROM by_player b WHERE b.queue_id=q.queue_id GROUP BY max_streak) h) AS histogram
 FROM by_player q GROUP BY q.queue_id ORDER BY q.queue_id
```

## Apéndice C — Consultas exploratorias de recuperación ejecutadas

### Modelo agregado de R1

La consulta distingue falta de observaciones y barreras. No sustituye la validación completa del motor ni ofrece diagnósticos individuales certificados. En la muestra no coexistieron candidatos positivos con barreras; en otros conjuntos las columnas de “observado” y “barrera” podrían solaparse.

```sql
WITH raw AS (
 SELECT s.*,count(*) OVER(PARTITION BY s.player_id,s.queue,s.timestamp) AS same_time,
 row_number() OVER(PARTITION BY s.player_id,s.queue ORDER BY s.timestamp,s.id) AS n
 FROM ranked_snapshots s JOIN players p ON p.id=s.player_id
 WHERE p.enabled AND s.timestamp >= '2026-01-08T15:00:00Z' AND s.timestamp < '2026-10-11T11:50:08.350Z'
), ordered AS (
 SELECT *,lag(timestamp) OVER w AS pt,lag(tier) OVER w AS pr,lag(division) OVER w AS pd,
 lag(wins) OVER w AS pw,lag(losses) OVER w AS pl FROM raw WINDOW w AS(PARTITION BY player_id,queue ORDER BY n)
), marked AS (
 SELECT *,same_time<>1 OR tier NOT IN('IRON','BRONZE','SILVER','GOLD','PLATINUM','EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER')
 OR (tier NOT IN('MASTER','GRANDMASTER','CHALLENGER') AND division NOT IN('I','II','III','IV'))
 OR league_points<0 OR wins<0 OR losses<0 AS invalid,
 pt IS NOT NULL AND (timestamp-pt>interval '7 days' OR tier<>pr OR division<>pd OR wins<pw OR losses<pl) AS cut
 FROM ordered
), triples AS (
 SELECT a.player_id,a.queue FROM marked a JOIN marked b ON a.player_id=b.player_id AND a.queue=b.queue AND a.n<b.n
 JOIN marked c ON c.player_id=a.player_id AND c.queue=a.queue AND b.n<c.n
 WHERE a.league_points-b.league_points>=50 AND c.league_points>=a.league_points
 AND b.losses>a.losses AND c.wins>b.wins AND c.timestamp-a.timestamp<=interval '30 days'
 AND NOT EXISTS(SELECT 1 FROM marked m WHERE m.player_id=a.player_id AND m.queue=a.queue AND m.n BETWEEN a.n AND c.n
 AND (m.invalid OR (m.n>a.n AND m.cut) OR m.league_points<b.league_points))
), measurements AS (
 SELECT player_id,queue,count(*) FILTER(WHERE NOT invalid) AS valid_snapshots,bool_or(invalid OR cut) AS interrupted FROM marked GROUP BY player_id,queue
)
SELECT queue,count(*) AS players,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM triples t WHERE t.player_id=m.player_id AND t.queue=m.queue)) AS observed_players,
 count(*) FILTER(WHERE valid_snapshots<3 OR interrupted) AS players_with_insufficient_or_barrier,
 count(*) FILTER(WHERE valid_snapshots>=3 AND NOT interrupted AND NOT EXISTS(SELECT 1 FROM triples t WHERE t.player_id=m.player_id AND t.queue=m.queue)) AS clean_not_observed
 FROM measurements m GROUP BY queue ORDER BY queue
```

### Candidatas exploratorias R2 con cruce de rango estándar

Diferencias en una coordenada ordinal convencional, nunca LP históricos reconstruidos. Un resultado vacío significa cero jugadores con candidatas bajo esta hipótesis y corte, no cero recuperaciones reales.

```sql
WITH raw AS (
 SELECT s.*, count(*) OVER(PARTITION BY s.player_id,s.queue,s.timestamp) AS same_time,
 row_number() OVER(PARTITION BY s.player_id,s.queue ORDER BY s.timestamp,s.id) AS n,
 100*(4*CASE tier WHEN 'IRON' THEN 0 WHEN 'BRONZE' THEN 1 WHEN 'SILVER' THEN 2 WHEN 'GOLD' THEN 3 WHEN 'PLATINUM' THEN 4 WHEN 'EMERALD' THEN 5 WHEN 'DIAMOND' THEN 6 END
 +CASE division WHEN 'IV' THEN 0 WHEN 'III' THEN 1 WHEN 'II' THEN 2 WHEN 'I' THEN 3 END)+league_points AS ordinal
 FROM ranked_snapshots s JOIN players p ON p.id=s.player_id
 WHERE p.enabled AND s.timestamp>='2026-01-08T15:00:00Z' AND s.timestamp<'2026-10-11T11:50:08.350Z'
), ordered AS (
 SELECT *,lag(timestamp) OVER w pt,lag(wins) OVER w pw,lag(losses) OVER w pl FROM raw
 WINDOW w AS(PARTITION BY player_id,queue ORDER BY n)
), marked AS (
 SELECT *,same_time<>1 OR ordinal IS NULL OR league_points<0 OR league_points>=100 OR wins<0 OR losses<0 AS invalid,
 pt IS NOT NULL AND(timestamp-pt>interval '7 days' OR wins<pw OR losses<pl) AS cut FROM ordered
), candidates AS (
 SELECT DISTINCT a.player_id,a.queue FROM marked a JOIN marked b ON a.player_id=b.player_id AND a.queue=b.queue AND a.n<b.n
 JOIN marked c ON c.player_id=a.player_id AND c.queue=a.queue AND b.n<c.n
 WHERE a.ordinal-b.ordinal>=50 AND c.ordinal>=a.ordinal AND b.losses>a.losses AND c.wins>b.wins
 AND c.timestamp-a.timestamp<=interval '30 days'
 AND NOT EXISTS(SELECT 1 FROM marked m WHERE m.player_id=a.player_id AND m.queue=a.queue AND m.n BETWEEN a.n AND c.n
 AND(m.invalid OR(m.n>a.n AND m.cut) OR m.ordinal<b.ordinal))
 AND EXISTS(SELECT 1 FROM marked m WHERE m.player_id=a.player_id AND m.queue=a.queue AND m.n BETWEEN a.n AND c.n
 AND(m.tier<>a.tier OR m.division<>a.division))
)
SELECT queue,count(*) AS players_with_cross_rank_R2_candidates FROM candidates GROUP BY queue ORDER BY queue
```
