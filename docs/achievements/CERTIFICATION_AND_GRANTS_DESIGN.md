# 1.2.A — Certificación, concesión y ciclo de vida de insignias

Fecha de inspección: 11 de octubre de 2026. Base local y remota verificada: `2190a34d22d4690a56670abb8e78eb3fd64a9072`, rama `staging`, sin commits divergentes.

**Estado: diseño para aprobación, no habilitación.** Este documento no cambia contratos, reglas, flags, esquema, sincronización ni interfaces. No autoriza conceder insignias. En el sistema activo siguen siendo obligatorios `certification: "not_established"` y `grantAuthorized: false`.

Leyenda: **HECHO VERIFICADO** procede de la inspección del código o de Git; **PROPUESTA** es una recomendación no implementada; **RIESGO** identifica una limitación; **DECISIÓN PENDIENTE** requiere aprobación del propietario. Las políticas propuestas no son reglas vigentes.

## 1. Resumen ejecutivo

**PROPUESTA.** Separar cuatro operaciones: observar una condición, verificar su evidencia bajo una política limitada, decidir una concesión y permitir su equipamiento. Un resultado positivo del motor nunca debe funcionar como permiso de escritura.

Recomendación para la escala actual: concesiones con estado actual y un historial de eventos inmutable, evidencia de decisión conservada y versiones explícitas de criterio y política. No crear una plataforma de event sourcing, colas externas ni siete tablas por cada concepto. Mantener el motor puro y la UI experimental actuales.

Recomendación de producto: reconocimientos históricos de acontecimientos verificables para Resurrección y Racha imparable; señal OTP dinámica durante la temporada y posible reconocimiento histórico al cierre, condicionado a reconciliación documentada. Ninguna insignia será irrevocable ante evidencia contradictoria o defectos demostrados.

**DECISIÓN PENDIENTE.** Adoptar este modelo híbrido restringido y su terminología. Es una elección por la distinta naturaleza de los criterios, no una garantía de exhaustividad ni una decisión ya aprobada.

**Bloqueadores de concesión actual:** reglas provisionales; ausencia de autorización de grants; ausencia de prueba persistente por intervalo/cola para rachas y temporada para OTP; ausencia de control de cambios de fuentes para una decisión concurrente; política de eliminación y conservación todavía sin definir. Completar un backfill no resuelve estos bloqueadores.

## 2. Arquitectura actual verificada

### Fuentes y responsabilidades

| HECHO VERIFICADO | Fuente / función | Consecuencia para el diseño |
| --- | --- | --- |
| El motor recibe entradas explícitas, valida, deduplica y evalúa sin IO. | `src/lib/achievements/{types,catalog,validation,result,matches,resurrection,unstoppable,otp}.ts` | Su resultado es una observación; validar forma no autentica procedencia. |
| Las tres reglas solo admiten observaciones. | `catalog.ts`, `types.ts`, `result.ts` | No convertir `observed` en grant ni ampliar estos literales en esta fase. |
| El servicio distingue lectura disponible, ausencia, inelegibilidad, entrada inválida e indisponibilidad. | `src/server/achievements/{service,evaluate,errors}.ts` | Un error SQL no es una condición incumplida. `available` no significa logro positivo. |
| Contexto, snapshots y partidas se materializan en `REPEATABLE READ READ ONLY`; CPU y presentación ocurren después. | `queries.ts:consistentAchievementReader`, `evaluate.ts:evaluateStoredAchievements` | Fotografía coherente del almacenamiento, que puede contener un avance parcial legítimo. No acredita cobertura ni actualidad al conceder. |
| Se realizan tres SELECT, con filtros por jugador, cola, ventana y plataforma de MATCH-V5; orden por timestamp/ID. | `queries.ts:achievementReader` | Sin N+1 ni límite visual de 40; se transfiere toda la muestra almacenada relevante. |
| Solo se acepta la temporada actual del calendario regional. | `evaluate.ts:parseAchievementRequest`, `src/lib/season.ts` | El cierre regional sigue sin fecha definida (`endAt: null`); evaluar temporadas archivadas necesitará un calendario explícito. |
| `intervalCoverage` permanece `unproven`, incluso con contadores reconciliados. | `contracts.ts`, `evaluate.ts:coverageContext`, `matches.ts:prepareMatches` | Los contadores son de todas las colas del jugador, no el denominador del logro. |
| El flag exige `ACHIEVEMENTS_EXPERIMENTAL === "true"`, desarrollo local identificado o Vercel Preview; Production y entorno ambiguo se rechazan. | `feature.ts:achievementsExperimentalEnabled` | No admite cookies, URL ni cabeceras. El código comprueba entorno, no por sí solo la rama Git `staging`; el alcance de rama requiere configuración operacional autorizada. |
| Perfil y distintivo OTP comparten un loader, con gate y Suspense. Demo usa fixtures antes de DB; 5v5 se omite. | `profile.ts`, `profile-achievements.tsx`, `src/app/player/[id]/page.tsx` | Conservar observación, distintivo provisional y presentación Bento. No añadir grants al render. |
| No hay tablas de concesiones, evaluaciones duraderas, equipamiento o evidencia de cobertura. | `src/db/schema.ts` | El diseño requiere persistencia futura autorizada; nada de ella existe hoy. |

### Reglas vigentes: se preservan

| Código | Nombre individual | Condición vigente | Versión |
| --- | --- | --- | --- |
| `resurrection` | Resurrección | R1: caída observada ≥50 LP, recuperación hasta A en ≤30 días desde A, mismo tier/división, huecos ≤7 días, contadores coherentes. | `1.1.A-observed-v1` |
| `unstoppable` | Racha imparable | I1: ≥5 victorias consecutivas registradas; remakes confirmados ignorados; derrotas y desconocidos interrumpen la evidencia. | `1.1.A-observed-v1` |
| `otp-specialist` | OTP · muestra importada en la UI | ≥50 partidas válidas, `20*C >= 13*N`; comparación exacta con BigInt, sin redondeo previo. | `1.1-otp-observed-v2` |

`catalog.ts` aún denomina a OTP «OTP certificado» como concepto provisional, pero `presentation.ts` utiliza el nombre limitado de muestra importada. Es una deuda de nomenclatura, no una certificación implementada; no se cambia aquí.

### Sincronización y premios comunitarios

**HECHO VERIFICADO.** `syncPlayer` consulta LEAGUE-V4, actualiza `rankCheckedAt` tras éxito e inserta snapshot si falta, cambia el estado ranked o empieza otra temporada. El timestamp del snapshot se asigna al persistir; representa una observación de SoloQ, no el instante exacto de una promoción o partida. No se crea un snapshot por cada verificación sin cambios.

`importHistory` conserva límites de escaneo, offset e IDs pendientes. Participación y avance del cursor se confirman atómicamente mediante `syncWrite`; PK y `onConflictDoNothing` deduplican. Un detalle 404 se contabiliza como no disponible y el escaneo puede finalizar. `importRecent` también puede continuar tras 404. `lastSyncedAt` indica cobertura reciente bajo esa política de importación, no una prueba de inexistencia de partidas omitidas.

`withSyncLease` coordina operaciones Riot globales/individuales. `syncWrite` comprueba propietario, vencimiento y revisión del checkpoint antes de escribir. `sync_locks.run_progress` conserva latest/previous, no un archivo permanente de pruebas por cola o temporada. El lease no autoriza una insignia ni coordina actualmente una capa de concesiones inexistente.

`computeAwards` y `getAwardMatchStats` calculan reconocimientos relativos entre jugadores elegibles por período. El Salón de Honor conserva **Imparable**, mayor racha del período con criterios comparativos propios. Su SQL trata remakes antiguos desconocidos con `coalesce(..., false)`, a diferencia de las barreras conservadoras del motor individual. No reutilizar ese agregado como prueba de concesión; no cambiar su comportamiento en 1.2.A.

**HECHO VERIFICADO.** La eliminación administrativa borra al jugador y, por FK con cascada, sus participaciones y snapshots; además elimina partidas sin participaciones. La futura evidencia no puede depender únicamente de referencias que desaparecen con esa operación.

**Contexto aportado por el propietario, no reconsultado en esta tarea:** 20 jugadores activos, 20 backfills completados, 5.084 IDs acumulados por jugador y cero unavailable/pending al corte comunicado. No representa 5.084 partidas únicas ni cobertura absoluta. Los recuentos anteriores de `RULE_REVIEW_RESURRECTION_UNSTOPPABLE.md` pertenecen a otro corte; no se combinan como una fotografía actual. No se consultó Neon ni Riot.

## 3. Problemas de evidencia

| RIESGO | Lo que existe | Lo que falta para una decisión más fuerte |
| --- | --- | --- |
| Procedencia | Ingesta de servidor, comprobación de match ID y participante por PUUID, fuentes normalizadas. | Las filas no contienen una firma Riot ni un registro inmutable de revisiones/recepción. La etiqueta interna `stored_official` no es autenticación criptográfica. |
| Cobertura | Cursores y contadores acumulados de trabajo; timestamps recientes/rango separados. | Manifestación persistente de IDs recuperables, límites, exclusiones y detalles por cola/intervalo. No se puede reconstruir completa desde los contadores. |
| Datos tardíos | Se pueden importar partidas anteriores al corte. | Un `asOf` fija fechas de eventos, no congela qué filas se conocían. Guardar también fecha de lectura, huella y revisión de fuentes. |
| Correcciones | Los motores detectan contradicciones en entradas; la ingesta habitual inserta sin sobrescribir conflictos. | Auditoría de futuras correcciones y señal de reevaluación. No afirmar que el sincronizador actual repara automáticamente filas contradictorias. |
| Consistencia | Fotografía transaccional para las tres lecturas. | Una decisión calculada fuera puede quedar obsoleta antes de persistirse. `updatedAt`, `rankCheckedAt` y revisión de run no son revisión de toda la evidencia. |
| Evidencia pública | DTO breve; en rachas hasta 20 IDs visibles; OTP tiene recuentos agregados. | Conservar internamente el conjunto de decisión completo; el DTO truncado no basta para reproducir una concesión. |
| Justicia | Reglas deterministas. | Jugadores con menor observabilidad pueden quedar sin reconocimiento por falta de pruebas. No interpretar eso como menor mérito ni compensarlo cambiando umbrales. |

**PROPUESTA.** Hablar de evidencia verificable **respecto de los registros y una política**, sin prometer todo el historial de Riot. Ningún hash demuestra que Riot entregó todos los datos; sirve para detectar cambios y reproducir la decisión.

## 4. Terminología propuesta

| Concepto | Definición formal propuesta | Etiqueta pública recomendada |
| --- | --- | --- |
| Condición observada | Un evaluador y versión encuentran la condición en una entrada concreta, con sus límites. No hay permiso de concesión. | «Condición observada · muestra importada» |
| Evidencia verificable | Identidad/ámbito, fuentes y parámetros pueden comprobarse y reproducirse; constan límites y datos desconocidos. | «Evidencia revisada» + alcance |
| Certificación bajo política | Decisión interna de que una evidencia satisface una política aprobada y versionada. No implica autoridad Riot ni cobertura universal. | «Verificado por SoloQ sobre registros disponibles» |
| Insignia concedida | Decisión autorizada persistida atómicamente, ligada a evidencia, política y motivo; existe un grant ID. | «Insignia concedida por SoloQ» |
| Insignia equipada | Selección de presentación sobre una concesión elegible del propietario autenticado. | «Insignia destacada» |
| Insignia suspendida | La concesión permanece registrada, pero una duda concreta bloquea equiparla o presentarla como vigente. | «En revisión» |
| Insignia revocada / invalidada | Decisión registrada que retira validez por contradicción o defecto, sin borrar la concesión ni su motivo. | «Reconocimiento invalidado» |
| Insignia histórica | Concesión que acredita un evento o período pasado bajo su versión; no afirma condición competitiva actual. | «Temporada 2026 · reconocimiento histórico» |

**PROPUESTA.** Usar «certificación» solo en contratos internos con `policyVersion` y alcance explícito; evitar «certificado» aislado en UI, especialmente OTP. Si el propietario elige esa palabra pública, debe acompañarse de «por SoloQ, sobre registros disponibles; no certificado por Riot».

Ejemplos: I1 puede estar observado y no ser certificable por falta de reconciliación del intervalo; R1 verificable puede seguir sin grant por política no aprobada; una concesión puede pasar a revisión por derrota tardía; un grant antiguo conserva su regla original; un OTP histórico no prueba especialización vigente. Ninguno de estos casos modifica los cuatro estados del motor actual.

## 5. Políticas específicas por logro

### 5.1 Resurrección: acontecimiento entre observaciones

**PROPUESTA.** Admitir eventualmente un reconocimiento histórico de **recuperación observada**, no de trayectoria completa. No necesita demostrar todas las partidas de temporada porque la afirmación se limita a snapshots; sí necesita todas las observaciones almacenadas del segmento elegido, sin omitir barreras conocidas.

Requisitos de verificación propuesta:

1. Regla R1 y política de concesión expresamente aprobadas; versiones y parámetros exactos conservados.
2. Player ID y vinculación Riot internos verificados; plataforma/cola/temporada únicas. Fuentes de ingesta real, sin Demo ni evidencia de cliente.
3. IDs y valores oficiales A/B/C, todo el segmento A→C, timestamps originales, fecha de lectura y huella de esos datos. Sin interpolación ni LP desde MATCH-V5.
4. Caída ≥50, C ≥ A, plazo ≤30 días desde A; mismo tier/división en el segmento, huecos ≤7 días, sin Unranked, fechas ambiguas ni reset. Aumento de derrotas A→B y de victorias B→C conforme al evaluador.
5. Revalidación de fuente/identidad antes de conceder y conservación de limitación «trayectoria intermedia no observada». Los contadores son respaldo de actividad, no LP por partida ni causalidad acreditada.

No reconstruir snapshots sin cambios a partir de `rankCheckedAt`: solo conocemos la última verificación, no un archivo de todas ellas. Un hueco >7 días sigue siendo barrera R1 aunque haya habido consultas sin snapshot. El instante de recuperación acreditable es **C observado**; el instante real en que se alcanzó el rango puede ser anterior y es desconocido.

Una corrección o un snapshot tardío dentro del segmento obliga a revisar. Un cambio de rango posterior a C no revoca por sí solo el evento histórico. Nuevos datos fuera de A→C no lo contradicen automáticamente. La política no permite cruzar divisiones ni sustituye R1 por R2/R3.

### 5.2 Racha imparable: intervalo recuperable reconciliado

**HECHO VERIFICADO.** Cinco victorias importadas permiten I1 `observed`, incluso con historial parcial. No prueban ausencia de una derrota no importada.

**PROPUESTA.** Para un futuro grant histórico, exigir evidencia adicional del intervalo primera→quinta victoria elegible: lista obtenida por el servidor de IDs recuperables en esa cola y plataforma, páginas agotadas dentro de límites congelados, cada detalle resuelto o exclusión justificada, resultados y pertenencia al jugador, clasificación de remakes y orden sin ambigüedad. La quinta victoria sería el instante observado del umbral; no la fecha de evaluación ni concesión.

Conservar recibo de reconciliación: límites precisos, semántica de fechas de consulta, fecha de verificación, parámetros de filtrado/paginación, IDs ordenados/deduplicados, clasificación de cada ID y referencia a detalles. Verificar límites inclusivos/exclusivos y precisión temporal de la API antes de aprobar el recibo; usar margen de consulta y filtrar el intervalo preciso después. Comparar sets, no solo cantidades. IDs pendientes, 404, remake/resultados desconocidos o secuencias ambiguas impiden conceder; no convertirlos en derrota ni descartarlos silenciosamente.

Este recibo **no existe hoy** y no se puede inferir de `completed`, `scanOffset`, `lastSyncedAt`, cero unavailable o un run final. Dos escaneos coincidentes tampoco prueban exhaustividad absoluta; se debe definir una política limitada a lo recuperable, su demora de estabilización y sus reservas. No inventar aquí un número de horas ni un SLA Riot.

No aumentar llamadas durante sincronización habitual ni consultar Riot desde el render para certificar. Primero estudiar si un escaneo autorizado existente puede conservar recibos; cualquier instrumentación futura de ingesta requiere aprobación y presupuesto separados. Si no se acepta el alcance recuperable o no hay recibo, mantener solo la observación experimental, **sin grant**.

Una derrota recuperada posteriormente entre las victorias suspende y, si rompe la prueba del umbral, invalida el grant. Una derrota posterior al evento no lo revoca. Si la racha restante todavía contiene cinco victorias verificadas, registrar la revisión de evidencia y conservar una sola concesión; no premiar de nuevo automáticamente.

### 5.3 OTP: señal vigente y reconocimiento estacional

**Respuesta expresa:** no conviene conceder ahora una insignia permanente que afirme «OTP de la temporada» mientras el denominador sigue creciendo. Podría concederse un hecho limitado «65 % en la muestra al corte X», pero sería otra promesa de producto, no OTP estacional; **se desaconseja** por confusión y acumulación de premios de muestras.

**PROPUESTA.** Durante temporada: conservar la señal dinámica «OTP · muestra importada», ≥50 y 13/20, sin grant permanente. Puede aparecer/desaparecer al cambiar C/N o el campeón dominante sin revocación, porque no era una concesión.

Al cerrar una temporada regional con fecha oficialmente definida y aprobada: evaluar un reconocimiento histórico por campeón, cola y temporada sobre el conjunto recuperable reconciliado. Conservar manifestación completa del denominador válido, exclusiones de remakes confirmados, desconocidos, conteos C/N exactos, límites de temporada/corte, versiones y fecha de reconciliación. El recibo debe abarcar la temporada, no solo las partidas del campeón. Si hay detalles desconocidos, cobertura no documentada o temporada sin cierre, no conceder.

No fijar ahora un plazo de cierre o conservación. Una espera temporal aislada no certifica el denominador. Datos tardíos o remake reclasificado obligan a recomputar todo C/N; puede haber suspensión o invalidación de un reconocimiento ya concedido. Pasar a otro campeón en una temporada nueva no invalida el reconocimiento antiguo; cambiar la muestra del mismo período sí requiere revisión.

El motor actual elige un campeón dominante determinista. Con ≥65 % no pueden cumplir dos campeones simultáneamente en el mismo denominador. No sumar grants de campeones alternantes mediante cortes parciales ni conceder otro al modificar versión. Mantener exactamente 50 partidas y comparación `20*C >= 13*N`, nunca porcentaje redondeado.

## 6. Comparación de modelos de permanencia

| Dimensión | A — Permanente sin estado vigente separado | B — Dinámica | C — Histórica + vigente separados |
| --- | --- | --- | --- |
| Claridad | Simple para hechos pasados; engañosa si OTP parece actual. | Describe situación actual; sorprende al desaparecer tras una derrota o nueva muestra. | Requiere fecha/temporada y explicar dos capas. |
| Justicia | Reconoce episodios pasados; necesita corregir errores reales. | Puede retirar una hazaña histórica por cambios normales. | Conserva hechos válidos y limita afirmaciones actuales. |
| UX | Catálogo estable, riesgo de saturación repetitiva. | Volátil; puede parecer pérdida de un premio. | Archivo compacto y una insignia destacada, con más estados. |
| Falsos reconocimientos | Alto si se confunde permanencia con irrevocabilidad. | Puede corregirse rápido, pero actualización tardía deja vigencia falsa. | No resuelve pruebas insuficientes; revisión explícita sigue necesaria. |
| Reevaluación | Revisar evidencia histórica afectada, no todo por cada partida. | Recalcular condición vigente con cada cambio relevante. | Histórico por impacto; señal actual reutiliza cálculo existente. |
| Mantenimiento | Menor estado normal, auditoría de correcciones necesaria. | Menos archivo visible, mayor coordinación de cambios. | Mayor complejidad semántica; limitarlo a dos capas, no múltiples rarezas. |
| Temporadas | Compatible si versión y temporada permanecen explícitas. | Necesita reset y archivo si se quieren logros antiguos. | Históricos de cada temporada y condición de temporada actual. |

**PROPUESTA.** Elegir C de forma restringida: concesiones históricas de R1/racha y eventual OTP cerrado, junto con señales actuales no concedidas. Equipar un histórico no lo convierte en vigente. No persistir cada fluctuación experimental ni crear un segundo sistema completo de badges dinámicos. Si se prefiere máxima simplicidad, A limitado a acontecimientos y sin OTP concedido durante temporada es una alternativa válida. B no encaja bien con una recuperación ya realizada.

## 7. Estados y transiciones

**PROPUESTA.** Tres ejes distintos; no un enum que mezcle premios, consultas y presentación:

| Eje | Estados conceptuales | Transiciones |
| --- | --- | --- |
| Evaluación actual | Los cuatro estados existentes; fallo de servicio separado. | Cada lectura genera otro resultado, nunca una concesión. |
| Decisión bajo política | `pending_review`, `verified`, `blocked` | Una observación crea candidata interna solo en un proceso autorizado. Verificar exige prueba y política. `blocked` conserva razones. |
| Concesión | `granted`, `suspended`, `revoked` | `verified` + permiso vigente → `granted`; contradicción concreta → `suspended`; revisión negativa → `revoked`; revisión positiva → `granted`. |

«Histórica» describe el período/acontecimiento de una concesión, no reemplaza su validez. «Equipada» es una relación de presentación. No habrá grant ficticio con estado `pending`: una candidata no es una insignia concedida.

Una falla de infraestructura mantiene el último registro y muestra «Revisión temporalmente no disponible»; no produce `not_observed`, éxito ni revocación. Evidencia insuficiente inicial bloquea concesión. Si aparece incertidumbre material sobre una concesión previa, suspender con motivo; si solo falla la conexión y no hay cambio conocido, conservarla con fecha de última verificación, sin afirmar revisión reciente. Reinstalar una concesión revocada requiere decisión explícita y evento; no inserción nueva ni regrant silencioso.

## 8. Política de reevaluación

**PROPUESTA.** Reevaluar por cambio de evidencia relevante, no en cada render ni automáticamente por finalizar cualquier run. Antes de automatizar, usar una operación interna autorizada de revisión, acotada por jugador/cola/temporada y con simulación sin escritura.

| Disparador | Acción propuesta | Efecto posible |
| --- | --- | --- |
| Nuevas partidas | Recalcular OTP vigente; revisar rachas cuyo intervalo contiene las fechas incorporadas. | Otra señal, candidato bloqueado, suspensión si contradice el grant. |
| Remake antiguo reclasificado | Revisar denominador OTP y rachas afectadas con la clasificación real. | Medición revisada; mismo grant válido o invalidación. |
| Derrota entre victorias | Revisar prueba completa del episodio, incluidos desconocidos y recibo. | Suspensión inmediata por cambio conocido, luego conservar o revocar con motivo. |
| Snapshot corregido o tardío | Revalidar R1 en el segmento completo A→C, no solo tres valores. | Nueva evidencia o invalidación; no inferir LP intermedios. |
| Riot ID cambia | Actualizar nombre visible; mantener identidad interna vinculada al mismo PUUID. | Ningún grant nuevo por renombre. |
| Plataforma o vinculación Riot cambia | Detener concesión y revisar alcance/identidad. No asumir continuidad sin evidencia. | Revisión explícita; sin traslado automático entre cuentas. |
| Jugador pausado | Impedir nuevas concesiones automáticas; conservar historial existente. | No revocar por pausa; señales pueden quedar desactualizadas. |
| Temporada termina | Confirmar calendario regional y reconciliación; evaluar OTP cerrado solo si aprobados. | Archivo histórico, no concesión por `completed`. |
| Nueva regla | Mantener reglas antiguas para reproducibilidad; aplicar nueva a futuras candidatas. | Reevaluación retroactiva solo por plan aprobado, sin premios duplicados. |
| Defecto del cálculo | Bloquear nuevas concesiones de la versión afectada e identificar grants impactados. | Suspender los afectados, reevaluar con versión corregida y registrar reparación. |
| Evidencia insuficiente posterior | Identificar si hay contradicción o pérdida de verificabilidad. | Suspensión si duda material; no revocación por simple indisponibilidad. |

Conservar cada decisión que cambia validez/evidencia, su huella anterior/nueva, actor interno, versión, timestamp del servidor y motivo estable. Un cambio normal fuera del alcance no dispara revocación. No guardar una evaluación por cada visita del perfil.

Un marcador de cambios pendiente debe persistir si la revisión automática se interrumpe; no depender de `finally`, memoria o latest/previous del run. Recuperar por lotes con reintentos idempotentes. Esta recuperación futura no consume llamadas Riot ni altera Fair Scheduling.

## 9. Política de revocación y conservación

**PROPUESTA.** Permanencia significa conservar una decisión histórica válida; no inmunidad ante errores. Revocar solo cuando una revisión determina incumplimiento de la política original o evidencia/identidad incorrecta. Documentar motivo público breve y detalle interno sanitizado. El jugador debe poder entender la causa y la fecha.

Suspensión es reversible y bloquea equipamiento; revocación conserva el registro original y añade evento. Revisión positiva conserva el grant ID y puede añadir evidencia corregida. Si el defecto era de producto y se decide cambiar un criterio, no invalidar retroactivamente sin una política de transición aprobada.

**DECISIÓN PENDIENTE.** Visibilidad pública de revocados: recomendar motivo mínimo en el detalle histórico del propio perfil, sin destacarlos en leaderboard; no convertirlos en sanciones o acusaciones. No inventar plazos de apelación ni conservación. No existe todavía autenticación de jugadores para un historial privado: definirla antes de prometer controles personales.

El borrado real de un jugador es distinto de una revocación. Hace falta decidir conservación, anonimización o eliminación de evidencia asociada y quién lo autoriza. No añadir FKs con cascada a grants ni retención indefinida por defecto; tampoco hacer RESTRICT sin adaptar la eliminación, porque rompería el control actual. Resolver esto antes de migraciones o concesiones. El archivo histórico no justifica conservar datos personales contra una política futura de eliminación.

## 10. Identidad y prevención de duplicados

**PROPUESTA.** Identidad lógica: jugador interno estable, vinculación Riot interna, plataforma del ámbito, cola ranked, temporada, código y sujeto/episodio normalizado. No usar Riot ID mutable ni publicar PUUID. Los registros existentes enlazan PUUID único a Player ID; eliminar/recrear genera otro Player ID, por lo que una futura política de continuidad de identidad necesita resolver ese caso, no otorgar nuevamente por accidente.

Recomendación inicial: **una concesión por código/jugador/cola/temporada**; OTP guarda además el Champion ID del reconocimiento cerrado. Conservar evidencia de otros episodios como revisiones solo cuando aporte diagnóstico; no conceder repeticiones en el primer incremento.

| Pregunta | PROPUESTA para primera versión |
| --- | --- |
| ¿Varias Resurrecciones? | Posibles como episodios reales, pero un solo reconocimiento estacional por cola inicialmente. Repetición y límites pendientes; el evaluador actual devuelve una recuperación elegida, no todos los episodios. |
| ¿Racha en SoloQ y Flex? | Sí, ámbitos independientes. No mezclar partidas, criterios o grant IDs. |
| ¿OTP por campeón/temporada? | Sí como contexto de la concesión histórica, con máximo uno por cola/temporada; si una corrección cambia campeón, revisar el mismo grant y conservar la decisión anterior. |
| ¿Cambio de campeón principal? | Durante temporada cambia la señal, no concede. En otra temporada puede haber otro reconocimiento; el anterior no afirma especialización actual. |
| ¿Temporadas antiguas? | Visibles como históricas con sus versiones, si conservación autorizada. No reevaluarlas usando automáticamente el calendario actual. |
| ¿5v5? | Excluido de estos tres reconocimientos ranked; no combinar SoloQ/Flex para conceder. |

Claves conceptuales recomendadas:

- Concesión única inicial: `(identity, platformScope, queue, season, code)`, componentes no nulos; campeón y versión son evidencia/contexto, no vías para duplicar ese mismo reconocimiento.
- Decisión/reintento: `(grantId, decisionKey)`, donde decisionKey incluye operación, revisión de fuentes, versión de política y huella canónica. Repetirla devuelve la decisión ya confirmada.
- Si se aprueban episodios repetibles: sustituir la unicidad inicial mediante migración revisada por una que incluya `episodeKey`. La clave necesita política para intervalos solapados; no derivarla simplemente de A/B/C ni de todos los IDs porque un nuevo mínimo, extensión de racha o versión podría generar otra clave para el mismo hecho.
- Una actualización de versión revisa el mismo reconocimiento equivalente; **la versión no forma parte de su clave única** por defecto. Reconocimientos semánticamente nuevos requieren aprobación específica, no cambio de string.

Evitar claves opcionales NULL que permitan duplicados: contexto obligatorio normalizado o unicidad separada expresamente validada. Restricciones de BD, no un SELECT previo, arbitran carreras. [PostgreSQL documenta la unicidad y su tratamiento de NULL](https://www.postgresql.org/docs/current/ddl-constraints.html).

## 11. Modelo de datos conceptual

**PROPUESTA, sin SQL ni esquema generado.** Separar semánticamente las entidades; no exige una tabla para cada una.

| Concepto | Información mínima | Ubicación recomendada |
| --- | --- | --- |
| Definición de insignia | Código, nombre público, colas admitidas, naturaleza evento/estacional. | Catálogo versionado en código, con manifestación de definición en la decisión. |
| Versión de regla y política | Parámetros, versión evaluador, versión política, estado de aprobación, alcance y evidencia exigida. | Manifestaciones inmutables del servidor; persistir copia exacta/hash en cada decisión. No inventar versiones aprobadas ahora. |
| Evaluación/candidata | Estado observado, corte, fecha de lectura, revisión de fuentes, motivo de bloqueo. | En memoria para señales; persistir solo al entrar en revisión autorizada. No histórico de cada visita. |
| Evidencia de decisión | Fuentes mínimas normalizadas, IDs y valores, ámbito, C/N, recibo de reconciliación cuando exigible, límites, huella y versión del formato. | Payload inmutable de evento; fuente de reproducción. No usar DTO público truncado. |
| Concesión | Grant ID opaco, identidad, código/cola/temporada, contexto campeón, estado, revisión, evento vigente y fechas. | Registro de estado actual para lecturas eficientes. |
| Evento | ID, grant ID, tipo, revisión anterior/nueva, decisión idempotente, actor/proceso, fecha del servidor, motivo y evidencia cuando cambia. | Historial append-only; insertado junto con el cambio de estado. |
| Equipamiento | Propietario autenticado, grant ID, slot y fecha de selección. | Relación separada en fase posterior; no columna preventiva ahora. |
| Cambio de fuentes | Revisión monotónica por jugador que cubre fuentes y elegibilidad; revisión evaluada del grant. | Requisito futuro de concurrencia, descrito en §12; no reutilizar campos actuales. |

Distinguir `eventObservedAt` o intervalo observado, `evaluatedAt`, `verifiedAt` y `grantedAt`. Nunca rellenar fechas anteriores por migración ni denominar a `grantedAt` fecha real del acontecimiento. Las decisiones antiguas conservarán su política aunque cambie el catálogo.

Comparación de alternativas:

| Alternativa | Integridad / auditoría / idempotencia | Rendimiento y complejidad | Evolución y duplicación |
| --- | --- | --- | --- |
| 1. Solo concesiones con estado/referencias | Unicidad sencilla; sobreescribir evidencia pierde razones anteriores. Referencias vivas no bastan tras borrados. | Menor complejidad; lecturas directas. | Difícil reconstruir correcciones; habrá que añadir eventos al crecer. |
| 2. Concesiones + eventos | Unicidad, FK evento→grant y actualización/evento en una transacción; historial auditable. | Dos entidades principales, lecturas del estado sin replay. | Copia deliberada de estado/proyección; revisión y evento vigente evitan divergencias. Evidencia de decisión duplica solo campos necesarios. |
| 3. Eventos con proyección | Excelente trazabilidad si el orden/replay están bien definidos. Requiere deduplicación, versiones de eventos y reconstrucción. | Mayor complejidad operacional y manejo de proyecciones retrasadas. | Migraciones de formatos y tooling de replay; innecesario para la comunidad actual. |

**PROPUESTA.** Elegir 2. No guardar payloads Riot completos, PUUID duplicados o todas las evaluaciones negativas. Para OTP, el manifiesto puede ser voluminoso: conservar un conjunto canónico completo de IDs/clasificaciones/campos necesarios para reproducir C/N y recibo, no solo conteo/hash; acotar tamaño de decisión y posponer si excede presupuesto, nunca truncar prueba para conceder. Al crecer, evaluar tabla de evidencia separada por medición, no añadir almacenamiento externo ahora.

No inventar evidencia retroactiva a partir de un estado `completed`. Migración futura aditiva crea estructuras vacías; los jugadores existentes no reciben grants ni timestamps por defecto. FK a fuentes puede ser referencia opcional de navegación, nunca única evidencia ni cascada destructiva sobre decisiones. Política de eliminación pendiente bloquea fijar DDL definitivo.

## 12. Seguridad y concurrencia

### Frontera de confianza y fallo cerrado

**PROPUESTA.** Proceso interno de concesión separado del servicio de observaciones. Debe comprobar política aprobada, entorno autorizado, modo real, identidad/cola/temporada, evidencia verificable y permiso del proceso. Un usuario no puede enviar evaluaciones, `verified`, hashes o `grantAuthorized` para obtener premios. No crear rutas públicas de concesión ni otorgar durante un GET del perfil.

El flag experimental actual controla presentación; no es permiso suficiente para escribir. Un futuro permiso de grants independiente estará apagado por defecto y exigirá también el gate experimental autorizado. Ambos desactivados o cualquier entorno ambiguo: cero concesiones. Production Demo rechaza siempre y no abre PostgreSQL. No habilitar grants en todo Preview por inferir que `VERCEL_ENV=preview` implica `staging`: validar identidad de entorno/base y rama configuradas por servidor confiable. Los primeros grants de prueba, si se aprueban, vivirán únicamente en staging y nunca se copiarán a Production Demo.

Separar capacidades de lectura, concesión, revocación y equipamiento. En una fase futura validar roles PostgreSQL/RLS reales: lector sin escritura en grants; proceso autorizado con permisos mínimos sobre concesiones/eventos; ninguna credencial cliente. `.enableRLS()` en Drizzle no demuestra que el rol desplegado esté restringido; eso sigue pendiente de inspección autorizada. No registrar secretos, PUUID, SQL, stacks o payloads de pruebas. Logs con IDs opacos de operación, códigos de motivo y versiones; diagnóstico detallado autenticado.

### Evitar la decisión obsoleta

**HECHO VERIFICADO.** La transacción de lectura actual acaba antes de evaluar y no evita escrituras posteriores. [PostgreSQL distingue la fotografía estable de Repeatable Read de las garantías de Serializable, que pueden exigir reintentar toda la transacción](https://www.postgresql.org/docs/current/transaction-iso.html). Ninguno de esos niveles prueba autenticidad o cobertura. Una segunda lectura de hash sin coordinación tampoco elimina la carrera entre esa lectura y el grant.

**PROPUESTA.** Antes de concesión automática, introducir una revisión monotónica de datos por jugador, incrementada **en la misma transacción** por todo escritor de partidas/participaciones, snapshots, clasificación de remake, correcciones, identidad/eligibilidad o pruebas de cobertura que afecten al ámbito. Es un cambio futuro de persistencia y escritores que necesita autorización; hoy no existe. No usar `updatedAt`, contadores, timestamps ni revisión de `run_progress` como sustituto.

Secuencia futura:

1. Materializar en el lector consistente fuentes, ámbito y revisión R; cerrar transacción.
2. Evaluar y verificar fuera, sin red en transacciones; construir prueba canónica y decisión limitada a R.
3. En transacción corta de escritura, comprobar y proteger condicionalmente la fila de revisión del jugador contra R y elegibilidad vigente. Todas las escrituras de fuente deberán actualizar esa misma fila dentro de su transacción. Si R cambió, no conceder: repetir desde materialización con límite de intentos.
4. Insertar/actualizar la concesión con unicidad y revisión esperada; insertar evento idempotente y actualizar referencia vigente atómicamente. Error o conflicto no recuperable: rollback entero.
5. Un cambio que se confirma después incrementa la revisión. El grant queda limitado a R: consulta/reevaluación detecta revisión posterior y trata el resultado como pendiente de revisión hasta comprobar impacto. Usar revisión por jugador puede provocar revisiones conservadoras de otra cola, pero es sencillo; optimizar por ámbito solo si se mide necesidad.

El arbitraje corto usa la coordinación transaccional normal de la fila, no otro lease global ni llamadas Riot dentro de un lock. **Condición crítica:** todos los escritores deben cumplir el protocolo, incluidos scripts de remake y futuras correcciones. Sin eso no prometer ausencia de carreras ni activar grants. El lease Riot se conserva; ni pausarlo ni reutilizar sus checkpoints como registro de concesiones.

El marcador pendiente se deriva de revisión actual > revisión comprobada, por lo que sobrevive interrupciones sin una cola externa. Un reconciliador interno autorizado trabaja en lotes y confirma revisión incluso si el cambio era irrelevante. No afirmar vigencia recién verificada cuando está pendiente. No necesita guardar una evaluación cada vez que llega una partida.

Alternativas: calcular todo dentro de una transacción de escritura prolonga locks/CPU y no se recomienda; serializable por sí solo no coordina la certeza de estar al día con escritores ajenos al protocolo; comprobar que el lease está libre sin adquirir coordinación tiene una carrera. Para una primera concesión manual limitada podría aprobarse una ventana operacional sin escritores, pero no presentarla como garantía automática ni activar esa pausa ahora.

### Reintentos y atomicidad

Dos procesos con la misma evidencia pueden competir: restricción única y clave de decisión devuelven el grant/evento confirmado, no duplican. Otro proceso con revisión distinta debe recomprobar antes de cambiar validez. Reintentos acotados solo para conflictos recuperables; nunca reintentar indefinidamente ni tratar timeout de cliente como escritura fallida. Tras respuesta incierta, consultar por clave de decisión. Revocación/equipamiento también comprueban revisión y estado dentro de la misma transacción.

Manifestaciones de política inmutables y lista de versiones autorizadas evitan que un proceso antiguo use silenciosamente una regla retirada. La revocación de autorización de una versión debe ser comprobable por el escritor, no depender solo de haber desplegado otra UI. Definir ese control antes de activar varios despliegues con capacidad de concesión.

## 13. Experiencia de usuario y equipamiento

**PROPUESTA.** Conservar Señales competitivas experimental como observación. Cuando exista una concesión aprobada, distinguirla en un bloque compacto de reconocimientos dentro del perfil Bento, sin otra portada o diez tarjetas. No reemplazar Firma ni premios comunitarios.

Cada reconocimiento: nombre, cola, temporada, estado textual, fecha/intervalo observado y fecha concedida. Detalle accesible: regla/política de la decisión, fuentes resumidas, evidencia consultable, limitaciones, última revisión y motivo de suspensión/invalidez. Mantener el texto de insuficiencia y el estado neutro de infraestructura; no mostrar «Nunca conseguido» por falta de datos.

Jerarquía: identidad/rango primero; una insignia destacada discreta después; archivo histórico plegado; señales experimentales con etiqueta propia. Color acompañado de texto/icono, controles táctiles ≥44 px, foco visible y desplegables semánticos. Un badge no añade rareza, nivel o título automáticamente.

Equipamiento propuesto inicialmente: **un slot en perfil**, solo sobre grant propio válido. Históricos equipables con año/cola siempre visibles. No imponer temporada actual si el objetivo es conservar hitos, pero no presentarlos como condición vigente. Varias insignias u orden manual se posponen por saturación. Leaderboard y títulos se posponen a una decisión separada; no usar el distintivo OTP experimental como insignia permanente.

Si se suspende/revoca un grant equipado, desactivar su presentación en la misma transacción de decisión o mediante consulta que exija grant válido; conservar evento y selección anterior para auditoría, sin sustituirlo por otro automáticamente. No restaurar selección sin permiso si el usuario eligió después otra insignia. Equipar no afecta cálculos, ranking ni evidencia.

**RIESGO.** SoloQ tiene autenticación administrativa, no una prueba actual de propiedad de cada cuenta para equipar. Se necesitará un flujo de identidad aprobado antes de controles personales. Un administrador podría gestionar presentación solo bajo autorización y auditoría explícitas; no asumir que cualquiera que conoce un Player ID es propietario. Definir visibilidad pública y controles de privacidad, sin inventar consentimiento ni obligaciones legales.

## 14. Recursos gráficos futuros para 1.2.C

**PROPUESTA de inventario, sin generar assets:**

| Recurso | Uso | Restricción |
| --- | --- | --- |
| Tres iconos vectoriales originales, tamaños 16/24/32 | Recuperación, racha y especialización. | Oscuros/competitivos, legibles sin glow; no sello oficial Riot ni alas de elo nuevas. |
| Variante monocroma y estados neutros | Contraste y revisión/invalidación. | No representar validez solo por color. |
| Icono de campeón local existente | Contexto OTP. | Mapping central y fallback «Campeón #ID»; no inventar identidad faltante. |
| Etiquetas de año/cola y estado | Distinguir histórico de vigente. | Texto accesible; no rarezas, niveles ni nuevas insignias por iniciativa técnica. |

No crear un sello «certificado por Riot», assets raster, página nueva ni medallas gigantes. Aprobar primero nomenclatura y estados; diseñar después usando tokens existentes.

## 15. Plan incremental de implementación futura

Todos los incrementos necesitan una autorización posterior. Ninguno se ejecuta en 1.2.A.

| Incremento | Objetivo / dependencias | Riesgos y pruebas | Aceptación / rollback / aprobación |
| --- | --- | --- | --- |
| **1.2.B.1 Contratos de verificación** | Políticas y definiciones aprobadas; tipos separados de observación/grant; recibos conceptuales convertidos en contratos internos versionados. | Pruebas de frontera, falsos certificados, Demo, 5v5, reglas antiguas y discrepancias de muestra. | Motor actual conserva resultados/literales. Proceso de decisión solo dry-run, sin persistencia. Revertir código. Aprobar D01–D05 primero. |
| **1.2.B.2 Evidencia y revisión de fuentes** | Definir manifestaciones por cola/intervalo, ámbito estacional, identidad y revisión monotónica; instrumentar escritores solo con aprobación. | Datos tardíos, 404, remakes, scripts antiguos, límites temporales, dos sesiones PG, interrupciones. | Ninguna revisión perdida ni falso porcentaje; impacto en ingesta acotado y sin cambios de presupuestos. Migración aditiva revisada/local, respaldo y aplicación staging autorizada aparte. Rollback del lector manteniendo columnas; retirar instrumentación solo con grants apagados. |
| **1.2.B.3 Persistencia mínima** | Concesiones + eventos, evidencia y unicidad; política de borrado resuelta. | Duplicados, NULL, cascadas, auditoría, compatibilidad con filas existentes. | Estructuras vacías; cero grants retroactivos. Probar PostgreSQL local/efímero y migración antes de staging. Migración antes del código; rollback de código con datos conservados, no DROP. Aprobar modelo/DDL y aplicación por separado. |
| **1.2.B.4 Decisión autorizada en servidor** | Verificador + datos + autorización de versiones/entorno, sin grant desde perfil. Empezar por R1 limitado. | Carreras, revisión obsoleta, timeout después de commit, políticas retiradas, Demo y aislamiento de entornos. | Concesión/evento atómicos, idempotentes, evidencia reproducible. Default off; apagar escritor revierte activación sin borrar decisiones. Autorización expresa de grants de prueba solo staging. |
| **1.2.B.5 Reevaluación y reparación** | Revisión de fuentes y lifecycle aprobado; revisar cambios relevantes por lotes, racha solo con recibo; OTP histórico solo tras cierre. | Derrota tardía, remakes, corrección R1, versión defectuosa, errores de infraestructura, reanudación. | Pendientes verificables, sin borrados silenciosos ni grants duplicados; si escritor cambia, no afirmar vigencia sin revisión. Apagar revisiones automáticas conserva dudas visibles; no hacer pasar grants dudosos por válidos. Aprobar revocación y política de replay. |
| **1.2.C.1 Presentación de insignias** | Contrato de lectura y concesiones válidas; gráficos aprobados. | Confusión con señales/Firma/Salón, responsive, foco, fechas y estado. | Una sección compacta; evidencia y limitaciones visibles, sin cambiar cálculos. Feature de lectura off permite rollback UI. QA Preview y aprobación visual antes de exposición. |
| **1.2.C.2 Equipamiento y títulos** | Autenticación/propiedad aprobadas; decidir slots y privacidad. | IDOR, grant revocado, carreras de selección, saturación. | Un slot inicialmente, solo grant propio válido, sin títulos implícitos. Desactivar presentación sin borrar catálogo. Títulos/leaderboard requieren autorización separada. |
| **QA y activación progresiva** | Todos los gates pertinentes, calendario, presupuesto y permisos medidos. | Carga, conexiones, errores, bypass cliente, falsos reconocimientos. | Suite completa Node compatible; pruebas con dos sesiones PG locales; Preview protegido validado; activar observación, dry-run y grants por etapas autorizadas. Production Demo permanece aislada; cualquier futura Production real exige otro proyecto de seguridad/datos aprobado. |

Archivos previsiblemente implicados después de aprobación: nuevos contratos/servicios de política, concesión y revisión en `src/server/achievements`; catálogo de políticas aparte del evaluador en `src/lib/achievements`; `src/db/schema.ts` y migraciones exclusivamente en B2/B3; escritores afectados de `src/server/sync` y scripts de corrección para revisión de fuentes; lectura/presentación de grants y componentes existentes en C; pruebas de seguridad/concurrencia/identidad y documentación. No autoriza tocarlos hoy ni cambiar reglas de LP, Firma o premios.

### Pruebas de regresión propuestas

- Congelar equivalencia de R1/I1/OTP y sus versiones; límites 49/50 LP, 30 días desde A, 7 días, counters/resets, cinco victorias y remakes, 32/50, 33/50, 65/100, 64/100 y 13/20 insuficiente por muestra.
- Observado sin autorización no concede; evidencia insuficiente/entrada inválida/error SQL no se convierten en grant. Dos colas/temporadas/jugadores nunca se mezclan.
- Recibos con IDs omitidos, duplicados, detalles ausentes y límites ambiguos bloquean; contadores iguales y backfill completed solos no certifican.
- Dos conexiones PostgreSQL reales: fuente cambia tras lectura, dos grants iguales, corrección concurrente, revisión/grant/equipamiento simultáneos; comprobar todo el protocolo, no solo simulaciones PGlite.
- Atomicidad evento/estado, claves idempotentes, recuperación tras respuesta perdida y ausencia de escrituras parciales. Reintentos agotados mantienen pendiente, no éxito ficticio.
- Fuente eliminada y jugador recreado: política explícita, evidencia/identidad no reasignadas. Cambio Riot ID no duplica. Cambio versión no regrant automático.
- Denominador OTP tardío, derrota intercalada y snapshot corregido: revisión, conservación de motivo y estado público coherente; error de red solo disponibilidad neutra.
- Flag ausente/false/entorno desconocido/Production/Demo: grants imposibles, cero PG en Demo. Browser evidence/cookies/URL no habilitan ni equipan por ID ajeno.
- Perfil B1–B5, Bento, LP, Firma, Salón, season stats y sincronización permanecen invariantes; QA visual 1440/768/390/320, teclado, lector de pantalla/zoom cuando disponibles.

## 16. Riesgos y limitaciones

**Críticos:** confundir importación completada con cobertura; conceder desde datos Demo o cliente; decidir con revisión obsoleta; perder evidencia por cascada; equipar sin propiedad acreditada; copiar grants de staging a Production; usar políticas provisionales como aprobadas.

**Importantes:** ventanas Riot recuperables y cambios tardíos; desconocidos en remakes; costo de manifestaciones OTP; sesgo por densidad de snapshots; vigencia durante reevaluación; versiones antiguas ejecutadas por despliegues coexistentes; identidad tras borrado/recreación; fin de temporada y retención sin definir.

**Rendimiento:** lecturas cargan la temporada; rachas/OTP preparan muestras separadas; Resurrección sigue siendo cuadrática en el peor caso. No ejecutar un motor completo dentro de un lock de ingesta ni evaluar todos los jugadores en cada perfil. Medir y acotar trabajos internos por lotes; ningún benchmark local acredita latencia Neon.

Los tests MVCC locales descritos en `HARDENING.md` no prueban red, pooling ni rol RLS desplegado. No se repitieron ni se conectó Neon en esta tarea. No se verificó deployment de este diseño, no hay tasas medidas de falsos positivos ni un protocolo actual de certificación. Los datos operacionales suministrados no reemplazan esas pruebas.

## 17. Recomendación de arquitectura y alcance de esta entrega

**PROPUESTA.** Mantener las observaciones actuales intactas; añadir posteriormente un verificador separado con política explícita, evidencia inmutable y concesiones + eventos. Autorizar primero R1 con afirmación limitada a snapshots; posponer grants de racha hasta tener recibo de intervalo y OTP histórico hasta cierre/reconciliación de temporada. Usar una revisión transaccional de fuentes antes de cualquier automatización, con permisos/entornos cerrados y reintentos idempotentes. Equipamiento es presentación posterior, no otra forma de conceder.

**HECHO VERIFICADO de esta entrega.** Solo se añade este documento. Se leyeron el código y las guías del motor, hardening, revisión de reglas, integración y perfil experimental. Se contrastaron conceptos de aislamiento/constraints con documentación primaria de PostgreSQL; [la guía oficial Riot](https://developer.riotgames.com/docs/lol) es referencia de integración, no una garantía asumida de cobertura exhaustiva. No se ejecutó SQL, Riot, sincronización, migración ni cambio de flag. `main`/Production y archivos protegidos no forman parte del cambio.

Validación documental: revisión del archivo nuevo y del alcance Git; `git diff --no-index --check -- NUL docs/achievements/CERTIFICATION_AND_GRANTS_DESIGN.md` sin errores de whitespace. `git diff --check` global señala únicamente whitespace preexistente en `CLAUDE.md:2`, que se preserva fuera del commit. Se comprueba también el diff staged antes de registrar el documento. No se ejecutan lint/typecheck/test/build por documentación sola; no se afirma una nueva ejecución de esas suites.

## 18. Decisiones pendientes de aprobación

Todas las filas están **pendientes**. El documento y su commit no aprueban ninguna.

| ID | Pregunta | Alternativas | Recomendación | Impacto | Estado |
| --- | --- | --- | --- | --- | --- |
| D01 | ¿Terminología pública de certificación? | Certificado sin matiz / verificado por SoloQ con alcance / solo observado | Verificado por SoloQ sobre registros disponibles; no Riot. | Contratos y confianza del usuario. | pendiente |
| D02 | ¿Modelo de permanencia? | A permanente / B dinámico / C híbrido restringido | C para hechos históricos y señales actuales separadas. | Lifecycle y presentación. | pendiente |
| D03 | ¿Qué concede R1? | Trayectoria real / recuperación observada / no conceder | Recuperación observada bajo R1 aprobado, sin trayectoria inferida. | Alcance acreditable y prueba. | pendiente |
| D04 | ¿Prueba mínima de racha? | Cinco importadas / intervalo recuperable reconciliado / exhaustividad absoluta | Recibo del intervalo recuperable y reservas; sin recibo, solo observación. | Instrumentación, presupuesto y datos. | pendiente |
| D05 | ¿OTP permanente durante temporada? | Corte parcial permanente / señal dinámica / solo temporada cerrada | Señal dinámica; histórico solo al cierre reconciliado. | Denominador, justicia y archivo. | pendiente |
| D06 | ¿Cerrar cuándo y con qué reservas? | Espera fija / reconciliación y plazo aprobado / sin grants históricos OTP | Reconciliación y calendario/plazo expresamente aprobados; no inventarlos. | Operación y alcance recuperable. | pendiente |
| D07 | ¿Repetir episodios en una temporada? | Uno por código/cola / episodios ilimitados / límite aprobado | Uno inicialmente; estudiar solapamientos antes de ampliar. | Claves únicas, saturación y evaluador. | pendiente |
| D08 | ¿OTP de varios campeones por misma cola/temporada? | Grants por cada corte / uno con contexto campeón | Uno, revisable por corrección; otra temporada independiente. | Prevención de duplicados. | pendiente |
| D09 | ¿Correcciones y revocación? | Irrevocable / borrado / suspensión y eventos de invalidación | Suspensión por duda material, revocación por prueba y motivo conservado. | Recuperación y confianza. | pendiente |
| D10 | ¿Cambios retroactivos de criterio? | Regrant automático / mantener versión / migración aprobada | Mantener versión; transición/reparación explícitas. | Compatibilidad histórica. | pendiente |
| D11 | ¿Persistencia mínima? | Solo grants / grants + eventos / event sourcing | Grants + eventos y evidencia de decisión mínima reproducible. | DDL, auditoría y costo. | pendiente |
| D12 | ¿Coordinación de fuentes? | Timestamps / ventana manual / revisión monotónica transaccional | Revisión antes de automatizar, con todos los escritores incluidos. | Cambio futuro de esquema/escritores, pruebas de carreras. | pendiente |
| D13 | ¿Eliminación/recreación y conservación? | Cascada / anonimización / conservación autorizada y limitada | Definir política y continuidad de identidad antes de grants/FKs. Sin plazo inventado. | Datos personales, borrado y auditoría. | pendiente |
| D14 | ¿Equipamiento y titularidad? | Admin / cuenta acreditada / ninguno | Posponer a identidad aprobada; un slot de perfil inicialmente. | Autenticación y prevención de IDOR. | pendiente |
| D15 | ¿Históricos equipables y leaderboard? | Solo vigente / histórico con año / múltiples/leaderboard | Históricos con año/cola en perfil; leaderboard/títulos separados. | Saturación y promesa pública. | pendiente |
| D16 | ¿Concesión automática o revisión inicial? | Automática inmediata / dry-run + revisión / no grants | Dry-run, revisión y autorización separada, primero R1. | Seguridad y exposición del rollout. | pendiente |
| D17 | ¿Quién retira una política autorizada? | Solo nuevo deploy / registro comprobable por escritor | Control de autorización versionado verificable antes del commit de decisión. | Despliegues coexistentes y reparaciones. | pendiente |
| D18 | ¿Exposición de suspendidas/revocadas? | Borrar / publicar todas / detalle mínimo contextual | Motivo mínimo, sin destacado; privacidad por definir. | UX y exposición pública. | pendiente |

Siguiente paso recomendado: aprobar o corregir D01–D05 y D07–D13; autorizar después **1.2.B.1, contratos y verificación sin escritura**, como tarea independiente. No comenzar persistencia, equipamiento, nuevos gráficos ni concesiones sin sus autorizaciones.
