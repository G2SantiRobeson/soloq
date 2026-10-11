# 1.2.B.1 — Contratos internos y simulación de verificación

Base: `3a780ecf7135f1ec8f1510ddf91b9d0a13825e7b`, `staging`. El diseño 1.2.A permanece como registro de recomendaciones iniciales; la instrucción posterior del propietario acuerda D01–D18 como política de producto, **sin autorizar concesiones**. D06 (calendario/plazo de cierre) y la titularidad para equipamiento siguen pendientes operativos.

## Alcance implementado

`src/server/achievements/verification/` añade exclusivamente contratos, validación runtime y `simulateBadgeVerification(submission, context)`. Los tres módulos importan `server-only`. No están conectados al perfil, servicio de lectura, sincronizador, rutas, Server Actions ni jobs. No hay I/O, reloj implícito, variables de entorno, caché, firmas de procedencia, SQL, persistencia o permiso de concesión. No se exportan a través del motor público de `src/lib/achievements`.

Los evaluadores existentes se reutilizan sin cambiarlos, con sus parámetros predeterminados y versiones actuales. La evidencia presentada se compara con la evidencia íntegra recalculada, no con el DTO visual truncado. Campos adicionales, incluido un marcador de interpolación en snapshots, no se proyectan silenciosamente como evidencia oficial. Las claves de objetos pueden cambiar de orden sin cambiar el resultado; arrays de evidencia deben corresponder al orden del motor.

Todos los resultados, incluso positivos o inválidos, conservan:

- `mode: "internal_dry_run"`.
- `certification: "not_established"`.
- `grantAuthorized: false`.
- `writes: "none"`.
- `provenanceAuthentication: "not_performed"`.

`requirements_satisfied` significa únicamente que los requisitos **de la simulación** se satisfacen suponiendo confiable el contexto interno suministrado. No significa certificado, concedido, equipado ni autorizado para escribir. Un objeto fabricado con campos coherentes puede superar comprobaciones estructurales: esta función no autentica que el contexto venga de Riot. No usarla como validación de peticiones HTTP ni aceptar contexto, procedencia o autorización desde un navegador. No existe aquí una factoría que acredite datos o un endpoint para llamarla.

## Contratos y estados

| Contrato | Contenido / significado |
| --- | --- |
| `Knowledge<T>` | `known` con valor, `unknown` o `not_applicable`. Ausencia y no aplicabilidad nunca equivalen a cobertura positiva. |
| `VerificationContext` | Entorno explícito, Player ID interno, plataforma, cola y temporada; fecha de evaluación; fuente declarada; materialización con IDs completos, corte y fecha de lectura. Solo un futuro materializador confiable puede construirlo en uso real. Sin PUUID. |
| `sourceRevision` | Conocimiento de una revisión opaca para futura concurrencia. No se consulta ni valida transaccionalmente; siempre se declara esa limitación. No implica que ya exista una columna de revisión. |
| `VerificationSubmission` | Código, versión de evaluador y política, entrada/evidencia completa o indisponibilidad; recibo y cierre estacional como conocimientos explícitos. La entrada es `unknown` en esta frontera y se valida con los parsers actuales por código. |
| `ReconciliationReceipt` | Identidad, origen interno declarado, versión draft, trace ID, fecha, intervalo objetivo semiabierto, límites de consulta en segundos, agotamiento conocido, IDs ordenados y detalles resueltos/desconocidos/404. Alcance: datos recuperables, no historial absoluto Riot. |
| `seasonClosure` | Temporada, plataforma, fin y fecha de confirmación, base de calendario regional aprobado. Es un contrato, no calendario nuevo ni evidencia de que la temporada real haya terminado. |
| `VerificationDryRun` | Resultado discriminado: `requirements_satisfied`, `blocked`, `invalid_input` o `unavailable`; observación original cuando fue evaluable, razones estables y limitaciones. Solo uso interno, no DTO público nuevo. |

Errores de estructura devuelven `invalid_input`, sin payload/excepción del cliente. Una entrada observacional inválida queda bloqueada; una lectura indisponible devuelve `unavailable`, sin sustituirla por `not_observed`. La función no ejecuta servicios ni atrapa fallos de programación para simular éxito.

## Políticas draft, sin activación

Identificadores mínimos de simulación:

- Resurrección: `1.2.B.1-resurrection-draft-v1`.
- Racha: `1.2.B.1-unstoppable-draft-v1`.
- OTP: `1.2.B.1-otp-draft-v1`.
- Recibo: `1.2.B.1-receipt-draft-v1`.

No son versiones nuevas del motor ni políticas de concesión activadas. La autorización de entrada distingue `not_authorized` de `simulation_only` ligada a una versión exacta. La falta de autorización o versión desconocida bloquea; no hay estado `grants_enabled` ni registro activo, default global, lectura de entorno o permiso persistente. Los tests construyen autorizaciones sintéticas de simulación. En ejecución futura el estado debe provenir del servidor; no se confía en la declaración del cliente.

`production`, entorno desconocido, fuente cliente/Demo/desconocida o procedencia ausente bloquean requisitos positivos. Esto modela el fallo cerrado, pero no sustituye la identificación operacional real del entorno: no hay integración que derive esos campos del runtime. Demo y Production existentes no importan este módulo ni adquieren capacidad de grants.

## Política por señal

### Resurrección

Recalcula R1 íntegro: 50 LP, 30 días desde A, misma división/tier, huecos máximos de siete días y contadores vigentes. Exige identidad/cola/temporada/corte concordantes, IDs para todos los snapshots de la entrada y concordancia con el conjunto declarado por la materialización, evidencia A/B/C y segmento exactos. No admite snapshots interpolados como campos adicionales; tampoco puede detectar falsificación numérica no marcada por alguien que controle el contexto interno, por lo que la frontera del materializador es indispensable.

La afirmación positiva permanece limitada a recuperación observada. Nunca acredita trayectoria real, LP por partida ni certificación Riot. Una revisión conocida tampoco elimina la limitación de concurrencia.

### Racha imparable

Recalcula I1 y conserva la observación incluso si la verificación queda bloqueada. Cinco victorias, `completed` y cero unavailable no fabrican un recibo.

Un recibo sintético puede satisfacer la simulación solo si tiene identidad correcta, ventana que cubre la racha completa elegida, consulta agotada explícitamente, margen coherente, fechas no futuras, IDs únicos y detalle para cada ID. Los registros del intervalo deben coincidir exactamente con los almacenados declarados, sin omisiones conocidas; orden timestamp/ID determinista, sin partidas competitivas simultáneas ambiguas. Remakes confirmados se ignoran como en I1; remake desconocido, resultado desconocido o 404 bloquean. Se comparan conjuntos y valores, no solo recuentos.

El agotamiento y la procedencia del recibo son declaraciones del futuro productor confiable, no hechos autenticados por la función. La semántica real de límites/paginación y la exhaustividad recuperable se deberán demostrar antes de generar recibos operacionales. Ningún campo actual de backfill se convierte en esa prueba.

### OTP

La condición dinámica de temporada sigue siendo la observación existente (`OtpEvidence`: campeón, C/N exacto, cola, temporada y cobertura). El dry-run de un reconocimiento histórico la conserva, pero bloquea si falta cierre confirmado. No concede por un corte provisional.

Para simular un histórico, el fin de temporada debe coincidir con el cierre declarado para la misma plataforma/temporada, estar confirmado antes de evaluar y haber sido alcanzado por el corte. El recibo debe cubrir la temporada completa, con denominador e IDs reconciliados y datos válidos. Se mantiene `N >= 50` y `20*C >= 13*N`, sin redondear. Los fixtures con cierre usan una fecha inventada **exclusivamente de prueba**; no modifican `CURRENT_SEASON.endAt`, que sigue nullable.

## Decisiones acordadas y pendientes

Se recoge D13 según la instrucción nueva: **borrar concesiones e información personal asociada al eliminar el jugador**; cualquier retención mínima requerirá finalidad y plazo justificados. No implementar retención indefinida, cascadas o cambio del endpoint en B.1. D18: motivos sensibles no públicos; consulta privada pendiente de autenticación. Una observación/resultado interno de simulación no se publica como diagnóstico privado de un usuario.

Conservar versiones originales sin regrant automático; un reconocimiento por código/jugador/cola/temporada inicialmente; OTP histórico con contexto campeón; modelo híbrido restringido; grants/eventos/evidencia futuros; revisión monotónica antes de automatizar; un slot condicionado a titularidad; títulos/leaderboard pospuestos. Estas decisiones no crean permisos, esquema ni equipamiento.

## Pruebas y siguientes requisitos

Regresiones nuevas: límites R1 49/50 LP, 30 días desde A y siete días; evidencia truncada/corrupta/interpolada; racha sin recibo/completed; recibos incompletos, 404, desconocidos, contradicciones, duplicados, orden y endpoints; remakes; cinco límites racionales OTP; temporada abierta/cierre incoherente/denominador parcial; identidad/cola/temporada/plataforma; versiones/autorización; procedencia ausente, cliente y Demo; Production; indisponibilidad; inmutabilidad y determinismo. Todos verifican permisos de escritura negativos.

Son pruebas puras con fixtures, no concurrencia PostgreSQL ni autenticación real Riot. El contrato admite una revisión futura y preserva incertidumbre, sin fingir que el control transaccional existe. Las pruebas de código-fuente comprueban `server-only` y ausencia de primitivas IO; no reemplazan una auditoría completa del compilador o de futuras rutas.

Antes de 1.2.B.2: aprobar y construir un materializador confiable sin evidencia de navegador; establecer semántica/versiones del recibo, límites y cierre regional; definir revisión monotónica y todos sus escritores, con presupuesto e invariancia del sincronizador; implementar control real de autorización versionada; diseñar eliminación D13 y privacidad D18; probar concurrencia con dos conexiones PostgreSQL locales. Instrumentación, persistencia y migraciones requieren autorización nueva. No comenzar B.2/B.3 ni conectar este dry-run al perfil en esta tarea.

## Validación local de B.1

Node `24.19.0`: lint y typecheck correctos; suite completa con **906 aprobadas, 10 omitidas**, incluidas **53 regresiones nuevas**. Las diez omisiones son opt-in de PostgreSQL local con conexiones independientes, no pruebas nuevas deshabilitadas. Se ejecutó `npm run test -- --maxWorkers=2 --hookTimeout=60000 --reporter=verbose`; no se cambiaron tests anteriores ni configuración. Los intentos anteriores se interrumpieron mientras inicializaban/ejecutaban la suite sin terminar; hubo además un bloqueo `spawn EPERM` del sandbox. La ejecución final terminó con código cero. Persisten avisos de React sobre claves de listas en exports visuales existentes del perfil, fuera del alcance de B.1.

`scripts/validate-production-demo.mjs` ejecutó `npm run build` y smoke HTTP en una copia temporal aislada, también con Node 24: resultado `PRODUCTION_DEMO_PASS`. Excluyó `.env*`, los cinco secretos y archivos protegidos; mantuvo el guard de red contra PostgreSQL y Riot autenticado. No se ejecutó un build con credenciales staging ni pruebas remotas. La validación estructural nueva no demuestra autenticidad Riot, recibos operacionales o revisión transaccional.
