# Logros 1.1.C — integración experimental apagada

Este documento registra C. D añade [hardening y mediciones](HARDENING.md) y [checklist de release](RELEASE_CHECKLIST.md). D prueba además MVCC con dos conexiones PostgreSQL 17 locales; Neon/Preview y permisos/latencia siguen pendientes. Política por defecto y contratos restrictivos sin cambios.

No hay concesiones, certificación, títulos equipados, tablas, migraciones ni escrituras de logros. Se integra un módulo de **señales sobre registros disponibles**, no un sistema de premios permanentes. Los contratos del motor y del DTO conservan `certification: "not_established"` y `grantAuthorized: false`; ninguna transición de UI puede autorizar concesiones.

## Auditoría de A y B

Se preservan reglas `1.1.A-observed-v1`, mínimos, scores, evidencias y elección determinista. Resurrección sigue exigiendo snapshots oficiales comparables con sus barreras; Imparable evalúa secuencias registradas y distingue remakes confirmados de desconocidos; OTP compara proporciones racionales de la muestra importada. Permanecen el oráculo exhaustivo y las propiedades adversariales del motor. No se modifican LP, Firma, premios, estadísticas, fixtures públicos, leaderboard ni sincronización.

Defectos/fronteras confirmados y corregidos:

- Los tres SELECT de B podían observar versiones diferentes. El servicio real ahora los materializa en una transacción coherente.
- El fixture dedicado de B solo reconocía un UUID interno; el perfil Demo usa `demo-N`. El adaptador de perfil valida la existencia en los fixtures públicos antes de usar el UUID dedicado, sin consultar DB ni cambiar los datos de la demo. Las señales son **ejemplos ficticios independientes** y pueden ser iguales en varios perfiles; no se presentan como derivadas de su rank público. Un corte anterior a las fechas de los ejemplos produce insuficiencia, sin alterar el reloj.
- Los catch de B devolvían indisponibilidad sin diagnóstico. Ahora existen códigos sanitizados de fase/tipo; datos mal normalizados se distinguen de indisponibilidad. Los defectos inesperados siguen siendo visibles como `unexpected` en pruebas y diagnóstico.
- `completed` con detalles no disponibles conserva disponibilidad parcial; ni `completed` sin faltantes ni los contadores prueban exhaustividad.

## Fotografía de lectura

`consistentAchievementReader` configura Drizzle 0.45.3 / postgres-js con:

```ts
{ isolationLevel: "repeatable read", accessMode: "read only" }
```

La API instalada abre la transacción, ejecuta `SET TRANSACTION` **antes del primer SELECT** y cierra mediante commit/rollback. PostgreSQL documenta que [Repeatable Read conserva la fotografía del primer SELECT](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-REPEATABLE-READ), a diferencia de READ COMMITTED. Se seleccionan contexto validado, snapshots y partidas de una cola/plataforma/temporada y corte explícito. Orden timestamp/ID determinista, columnas mínimas, sin N+1 ni límite del perfil de 40 partidas. El ámbito de plataforma procede del jugador interno; nunca de evidencia enviada por el navegador.

El callback solo materializa datos. Evaluación, proyección y render ocurren **después de cerrar la transacción**. No hay llamadas externas, evaluadores costosos, escrituras ni bloqueos explícitos dentro. Los dos conjuntos de evidencia se solicitan mediante Promise.all sobre **la misma conexión**; eso no crea concurrencia adicional hacia Riot. Solo se ocupa una conexión del pool actual (máximo 3).

Garantía acotada: la fotografía MVCC es coherente entre estas lecturas, pero puede contener un avance parcial legítimo de sincronización. Las escrituras del sincronizador no son una sola transacción de temporada. La fotografía tampoco convierte tres consultas en cobertura completa ni hace atómico **todo** el perfil: sus métricas esenciales se obtienen por su camino existente. Los timestamps de cobertura/rango son diagnósticos independientes, no certificados.

PGlite efímero ejecuta SQL real con los ajustes, comprueba `transaction_isolation=repeatable read`, `transaction_read_only=on`, rechazo de UPDATE y recuperación tras fallar la segunda/tercera lectura. Otra prueba verifica que la evaluación empieza fuera de la transacción. Las carreras de nuevas partidas/snapshots, contexto y backfill se prueban con una **simulación de fotografía capturada**, no con dos conexiones PostgreSQL independientes. PGlite no demuestra el MVCC entre sesiones independientes de Neon, red, pooling de Neon, RLS del rol desplegado ni latencia real. No se conecta Neon; esa comprobación queda pendiente antes de activación remota.

El lector básico `achievementReader` sigue siendo un adaptador interno útil en tests; por sí solo no ofrece esa fotografía. El servicio de datos reales usa siempre el lector coherente. Demo usa memoria determinista.

## Política del flag

`ACHIEVEMENTS_EXPERIMENTAL` es exclusivamente de servidor. Solo el valor exacto `true` activa la política; ausente, vacío, `false`, `FALSE`, `TRUE`, espacios y texto inesperado quedan apagados. No existe versión `NEXT_PUBLIC`, endpoint, cookie, URL, cabecera ni control de administración que lo cambie.

| Entorno                                                      | Condición adicional con `true`                                            | Resultado                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------ |
| Local                                                        | `NODE_ENV=development`, sin `VERCEL`, `VERCEL_ENV` ni `VERCEL_TARGET_ENV` | Permitido                                  |
| Vercel Preview                                               | `VERCEL=1`, `VERCEL_ENV=preview`; target ausente o `preview`              | Permitido, incluso con NODE_ENV production |
| Production                                                   | VERCEL_ENV o VERCEL_TARGET_ENV `production`                               | Siempre apagado                            |
| Local build/start production, tests o entorno ambiguo/custom | No cumple las condiciones anteriores                                      | Apagado                                    |

Se consultó la [documentación oficial de variables de sistema de Vercel](https://vercel.com/docs/environment-variables/system-environment-variables): VERCEL identifica su ejecución y VERCEL_ENV distingue preview/production/development en build y runtime. Si no están expuestas, el despliegue falla cerrado. No se modifica esa configuración.

El wrapper y el adaptador comprueban el flag y la cola **antes de iniciar trabajo**. Apagado: no servicio/evaluadores/SELECT adicionales, espacio vacío ni fallback. 5v5 omite el módulo, aunque el flag permita activación: no mezcla SoloQ/Flex ni consulta. Perfil inexistente llama notFound antes de montar la sección. Metadata nunca evalúa logros. La protección de Production no depende solo de NODE_ENV.

## Perfil, estados y errores

El bloque nativo plegado **Señales competitivas · Experimental** aparece después de Firma dentro del resumen competitivo, antes de las gráficas. No reemplaza Firma, rangos ni pool. Sigue el lenguaje oscuro/denso, con símbolos pequeños decorativos, texto de estado y evidencias a demanda. No se integra el componente conceptual de títulos ni insignias del leaderboard.

Suspense transmite un fallback compacto y accesible solo cuando el módulo está permitido. La página retorna el encabezado y métricas esenciales sin esperar al servicio experimental. La lectura comienza al renderizar el hijo independiente; abrir el disclosure no es condición de carga: con el flag activo se evalúa también si el usuario lo deja plegado. Suspense no se utiliza como captura de excepciones: el adaptador de servidor aísla fallos de servicio/proyección y entrega un panel neutro. Los tests verifican fallos reales de la frontera de datos y un defecto inesperado simulado, además de un servicio pendiente que no bloquea el retorno del árbol esencial. El streaming real se revisa mediante Next local Demo, no se atribuye a Vitest soporte completo de RSC asíncronos.

- `observed`: condición observada, nunca desbloqueo ni premio concedido.
- `not_observed`: no observada en registros disponibles, nunca ausencia absoluta en Riot.
- `insufficient_evidence`: historial vacío/parcial, datos desconocidos o muestra insuficiente.
- `invalid_input` / contexto `invalid_data`: datos no válidos para una evaluación segura.
- `unavailable`: lectura/evaluación temporalmente indisponible; **no se evaluaron logros**. No significa no conseguido.

Resurrección muestra tier/división, LP extremos exactos, caída, intervalo, regla y límite de trayectoria. Imparable muestra máxima racha registrada, cola, temporada, partidas, fechas y límite de cobertura; solo 20 IDs llegan a la UI. OTP muestra campeón, C/N, porcentaje de muestra y regla mínima; no certificación anual. Demo avisa siempre que son datos simulados, y su servicio decide el camino de memoria antes de importar DB/queries.

Diagnóstico: `[achievements] fase:infrastructure|invalid_data|unexpected`; nunca mensajes de excepción, SQL, stack, IDs, PUUID, tokens o conexión. Se reconocen códigos conservadores de conectividad/indisponibilidad PostgreSQL; errores SQL/esquema no reconocidos quedan `unexpected` para investigar, no se esconden como progreso insuficiente. El público solo recibe mensajes fijos. No hay reintentos automáticos de DB dentro del render; otra petición puede reevaluar de forma segura.

## Coste y rendimiento

Apagado: cero consultas de logros. Activo: hasta tres SELECT de temporada por perfil/cola + BEGIN/SET/COMMIT o rollback. Jugador inexistente/pausado corta tras contexto. La cache de React es por request e identidad/cola/corte; no se comparten evidencias entre requests. Se reutiliza el catálogo de campeones ya cargado. Las ventanas reducidas del perfil no sirven para el historial de evidencia, por lo que no se reutilizan sus arrays recortados como si fueran temporada completa.

Lectura/memoria O(n+s), normalización O(n+s), validación/deduplicación/ordenación O(n log n) en los dos evaluadores de partidas, racha/OTP O(n). Resurrección O(s*k), peor O(s²). Una transacción con 50.000 filas puede mantener conexión y fotografía bastante más tiempo; no se afirma que tres SELECT sean baratos en Neon. Tampoco Suspense evita consumo de CPU en el event loop después de cerrar la transacción. No hay caché compartida ni consultas nuevas por cada ítem.

Benchmark opcional reproducible, Node 24.19.0, conjuntos invertidos y 10 % de duplicados idénticos; sin SQL, umbral de máquina ni estimación Neon:

```sh
node --conditions=react-server --import tsx tests/achievements-integration-benchmark.ts
```

| Partidas | Snapshots | Normalización ms | Evaluación ms | DTO ms | Serialización ms | Total ms | Δ heap MiB |
| -------- | --------- | ---------------- | ------------- | ------ | ---------------- | -------- | ---------- |
| 50       | 30        | 0,07             | 11,29         | 3,75   | 0,02             | 15,13    | 1,86       |
| 500      | 30        | 0,51             | 5,89          | 0,17   | 0,02             | 6,59     | 1,85       |
| 5.000    | 300       | 4,96             | 44,95         | 0,22   | 0,02             | 50,16    | 1,02       |
| 50.000   | 3.000     | 49,41            | 393,91        | 0,23   | 0,02             | 443,58   | 60,57      |

DTO 3.572–3.595 bytes. Heap es diferencia antes/después con GC no controlado, no pico. Primera muestra incluye calentamiento. El conjunto de snapshots planos caracteriza un caso sin recuperación temprana; no constituye un límite superior de todas las entradas. Se conserva Resurrección sin optimización de riesgo. Antes de abordar grandes volúmenes: medir por separado snapshots adversariales, estudiar una estructura para descartar anclas dominadas con expiraciones y mínimos empatados, comparar con el oráculo exhaustivo y añadir propiedades antes de cambiar el algoritmo.

## Validación y QA

Las pruebas nuevas cubren política por entorno, ausencia de trabajo al apagar/5v5/missing, Metadata, Demo real sin DB, los cuatro estados, fallos sanitizados, progreso parcial, lectura coherente, errores SQL y protección read-only. Continúa toda la suite de A/B, perfil B1–B5, LP, Firma, premios, temporada y sincronización. No se eliminan las cuatro pruebas opcionales de PostgreSQL local.

QA reproducible: `achievements-profile.test.tsx` incluye exportación **opt-in** de perfiles completos SSR ficticios (observado/insuficiente/indisponible), usando página/componentes reales y mocks de consultas locales. Sin `ACHIEVEMENT_VISUAL_DIR` no escribe artefactos. CSS/HTML/axe se guardan fuera del repo, nunca en rutas públicas ni en el commit. Next local Demo verifica por separado el perfil hidratado SoloQ/Flex y la omisión 5v5, con fetch externo bloqueado en el proceso de QA. No se visita Preview protegido.

Validación final con **Node 24.19.0**: lint, typecheck y build correctos; suite completa **664 aprobadas y 4 omitidas**, 59 pruebas nuevas respecto de B. Las omitidas son las cuatro anteriores de lease PostgreSQL local opcional. Después de ajustar solamente el reset CSS del export auxiliar, se repitieron sus 22 pruebas de perfil, todas correctas. El build se ejecutó con Demo ficticia y fetch externo bloqueado, flag ausente; no requirió Neon ni Riot. El build restauró automáticamente los imports generados de next-env.d.ts, sin cambios finales en ese archivo.

Chrome / perfil Next hidratado: anchos 1440, 1280, 1024, 768, 390, 375 y 320, sin overflow horizontal **tras estabilizar el resize de las gráficas**; las primeras mediciones inmediatas podían observar su ancho anterior. Enter y Espacio alternan evidencia, Tab avanza entre summaries, controles de al menos 44 px, sección plegada por defecto. SoloQ y Flex muestran tres señales ficticias; 5v5 omite el módulo. El build local en entorno Production simulado con flag true responde HTTP 200 en las tres colas sin sección experimental. No se probó Production remoto.

Fixtures SSR completos de insuficiencia e indisponibilidad: estados neutrales correctos y axe sin infracciones automáticas, 23–25 reglas aprobadas, color-contrast pendiente de revisión manual. No tienen hidratación Next ni las fuentes locales compiladas: son apoyo para estados, no sustituyen la matriz responsive del perfil hidratado. La captura full-page de estos auxiliares agotó el plazo del navegador; se conservaron capturas de viewport. Las capturas de desktop/tablet/móvil del perfil Next real sí se obtuvieron fuera del repositorio.

Contraste de tokens del módulo sobre su superficie #0e1528: texto 16,24:1, muted 8,36:1, verde 12,28:1, warning 9,64:1 y foco 11,62:1. Estado incluye texto y símbolo decorativo, no depende del color. La QA automática y estos ratios no equivalen a certificación completa de accesibilidad. Zoom real 200 %, lector de pantalla, IDs largos en navegador, rol de despliegue y latencia Neon requieren comprobación específica.

## Activación futura y reversión (no realizadas)

1. Revisar/publicar estos commits únicamente en staging **con autorización**; el valor por defecto seguirá apagado. No hay migración que aplicar.
2. Verificar Preview protegido y confirmar variables de sistema presentes, aislamiento Demo/DB, coste de consultas y garantías del rol Neon con autorización separada. Medir con datos sanitizados sin imprimir identidad/credenciales. No conceder premios.
3. Solo tras autorización explícita configurar `ACHIEVEMENTS_EXPERIMENTAL=true` limitado a **Preview/staging**, nunca Production ni variable pública. Validar SoloQ/Flex, 5v5, ausente, falta de datos y fallos, y confirmar que los resultados siguen no certificados y no concedidos. La configuración necesita un deployment posterior autorizado para entrar en vigor.
4. Reversión: quitar el flag o poner `false` en el ámbito autorizado y publicar/desplegar conforme al flujo aprobado. No borrar datos, deshacer migraciones ni invalidar concesiones: este módulo no las crea. Production permanece apagado incluso ante un valor accidental.

### Técnica terminada

Motor/evaluadores, adaptadores de lectura, orquestador, DTO, componentes, integración gated, transacción local read-only, errores sanitizados y fixtures/tests.

### Pendientes técnicos

Preview protegido, latencia/plan/consumo real Neon, aislamiento de sesiones independientes y RLS del rol desplegado, zoom 200 % y lector de pantalla reales, perfiles muy grandes/concurrencia de visitantes y posible optimización de Resurrección. La validación con Node admitido se realiza en esta fase (24.19.0).

### Pendientes de producto

Umbrales definitivos, certificación, permanencia, política de invalidación, títulos seleccionables, rarezas y presentación final en leaderboard. Ninguna de estas decisiones se implementa ni se presume aprobada.
