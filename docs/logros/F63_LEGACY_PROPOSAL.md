# F6.3 — Contratos de legado, todavía sin acreditación activa

La galería experimental F6.2 sigue intacta. `/salon-de-la-fama` es una experiencia distinta: catálogo conceptual, escenarios Demo independientes y estado real sin datos. No consulta base de datos, evalúa reglas ni concede premios. El modo real muestra propuestas y ausencia de acreditaciones; no recibe los fixtures Demo. No hay endpoints, migraciones, cron, triggers ni workers.

## Catálogo propuesto

- `intocable / concept-v1`: El Intocable, legendario. Quince victorias seguidas es un umbral conceptual, no aprobado. Las cinco victorias de Racha imparable no equivalen a esta hazaña. Faltan continuidad/exhaustividad verificadas y acreditación persistente.
- `primero-de-su-nombre / concept-v1`: El Primero de su Nombre, pionero. Primera acreditación válida de una hazaña después de una activación formal; no primera importación ni primera observación. Ámbito, activación y tratamiento de empates requieren aprobación.
- `monarca / concept-v1`: El Monarca, permanente. Liderazgo sostenido en un período documentado; duración, población, cadencia, tolerancia y empates están pendientes. Snapshots aislados no prueban liderazgo continuo.

Requisitos, evidencia, límites, verificabilidad actual e infraestructura se mantienen explícitos en `src/lib/hall-of-fame/proposals.ts`. No se incorporaron al catálogo ni al motor experimental.

## Contratos futuros, no implementación

`src/lib/hall-of-fame/contracts.ts` propone:

- Identidad interna PUUID canónica, plataforma, comunidad, SoloQ/Flex, temporada e identificador/versionado de regla. Nunca inferir identidad desde Riot ID visible; nunca exponer PUUID en esta UI pública.
- Concesión con fecha de acreditación autoritativa, fecha exacta de obtención solo si la evidencia la establece, intervalo observado o UNKNOWN en caso contrario, activación aprobada y referencias de evidencia inmutable con digest/cobertura.
- Clave idempotente derivada de identidad/ámbito/regla y ocurrencia aprobados. Una futura restricción única y transacción evitarían duplicados; no es una concatenación pública de secretos ni existe una escritura ahora.
- Revisión append-only autorizada: confirmar, invalidar o corregir, con razón, responsable y referencia a reemplazo. Permanencia no significa conservar para siempre un premio incorrecto: debe distinguirse historial válido, revisión e invalidación.
- Pionero basado en las primeras acreditaciones válidas y política de empates versionada; no en el orden de una consulta, carga de backfill o carrera de workers.
- Historial de poseedores de récord con métrica/versionado/ámbito/evidencia y períodos de vigencia. Perder el récord cierra la vigencia, sin revocar automáticamente una hazaña histórica válida. En ausencia de evidencia no se reconstruyen antiguos poseedores.
- Rareza calculada únicamente con titulares únicos válidos, denominador de elegibles definido y reproducible, mismo ámbito/versionado, fecha de corte y población histórica verificable. El denominador debe ser positivo y el numerador no mayor; sin cobertura suficiente corresponde `insufficient_evidence`, nunca 0 %, exclusividad o un máximo arbitrario de premiados. `demo` no es `calculated`.

Esos invariantes deberán validarse en el futuro servidor/almacenamiento. Los tipos no constituyen autorización ni prueba de cumplimiento. La evolución de reglas conserva la versión de cada concesión; nuevas temporadas no reinterpretan silenciosamente el historial.

## Privacidad, D13 e infraestructura

Antes de persistir: aprobar reglas y ámbitos, verificación de cobertura, ledger de concesiones/activaciones/revisiones, integridad de evidencia, transacciones y permisos mínimos de un escritor confiable. El visitante nunca concede, modifica o equipa premios. No hay autenticación/equipamiento nuevo en esta fase.

La integración requiere un diseño y aprobación separados de esquema/migraciones y seguridad P4.4.D. No se autoriza ahora ninguna migración o ACL. Reutilizar receipts/evidencia existentes requerirá comprobar su semántica, retención y capacidad; no se presume que sean un ledger de premios listo.

La permanencia histórica no anula privacidad ni DELETE D13. Debe definirse borrado de PUUID/datos personales y evidencia asociada, tratamiento de publicaciones, anonimización permitida o retirada de referencias y recomputación de poblaciones/rareza. No conservar identificadores recuperables tras una eliminación por el mero prestigio del logro. La revisión auditada y sus plazos necesitan política de retención autorizada; no se implementa TTL ni purga automática.

## Escenarios y separación

Fixtures exclusivos `src/server/hall-of-fame/demo.ts`, fuente `fictional_hall`, SoloQ/2026. Marea: hazaña legendaria simulada; Ronin: permanente simulada y récord actual; Nebula: pionero simulado; Marea conserva el antiguo récord. Las cifras 18/21 y el período de siete días son guion, no cálculos de las partidas experimentales ni umbrales adicionales aprobados. El récord de muestra ilustra una comunidad; su ámbito real y comparabilidad deben aprobarse antes de cualquier acreditación.

Flex y el perfil Demo Eclipse muestran ausencia de acreditaciones simuladas. No se importan esos escenarios al motor, al historial ranked, ni a datos reales. No se calcula rareza real o ficticia: la UI informa «no calculada»/«todavía no disponible».

## Dirección artística propuesta

Recursos originales sujetos a aprobación futura; ahora solo Lucide/CSS:

- El Intocable: escudo angular con llama contenida, dorado/ámbar; sensación de resistencia legendaria, sin cifras de rareza ni corona Riot.
- El Primero de su Nombre: estandarte y marca inaugural, cian/plata; identidad de pionero distinta de un campeón de récord vigente.
- El Monarca: corona original de tres puntas y sello de continuidad, azul violeta/dorado; diferenciar acreditación histórica de titular actual del récord.

Máster cuadrado 512×512 transparente, figura central aprox. 80 % y ornamentos dentro del lienzo. Slots UI hasta 120×140 px con `contain`; derivadas 128×128, 64×64 y 32×32, sin recortes ni texto incorporado. Estados: propuesta/indisponible neutral con etiqueta, Demo inequívoca, futura acreditación válida acompañada de fecha/evidencia, en revisión o invalidada con texto/icono. Los colores nunca sustituyen el estado accesible. No se generan ni descargan assets en esta fase.
## Validación local

1427 tests aprobados, 69 PostgreSQL de servicio opt-in omitidos, cero fallidos. Lint y typecheck pasaron. Navegador real a 1920/1440/390/320 px: Salón, propuestas/evidencia abiertas por teclado, perfil con legado ficticio, perfil vacío y Flex sin acreditaciones, sin overflow ni errores de hidratación. Capturas y bounding boxes en artifacts/f63-*.png y f63-visual-checks.json. Galería F6.2, motor, fixtures previos, SQL y journal preservados byte a byte; F5/P4.4.D intactos y sin commit.

Build Demo final y 45 comprobaciones HTTP: PASS. No se ejecutaron migraciones ni escrituras operacionales. Archivos nuevos: página salon-de-la-fama, hall-of-fame.tsx/hall.module.css, proposals.ts/contracts.ts, fixtures hall-of-fame/demo.ts, hall-of-fame.test.tsx y este documento. Modificados: header-nav.tsx, perfil de jugador, globals.css (solo navegación responsive) y validate-production-demo.mjs. Sin commit ni publicación.

## F6.3.1 — Emblemas originales integrados

Solo los tres WebP aportados por el usuario se copiaron a public/achievements/hall-of-fame; fuentes RGBA 512×512 con alfa real, bytes/hash idénticos al ZIP. No se copiaron PNG originales ni ZIP al worktree; no se editaron imágenes. Mapeo por IDs en emblems.ts y next/image unoptimized local, alt vacío por nombres adyacentes, máscara/fondo temporal retirados. Featured 160×160, compactos 96×96, miniaturas 48×48; object-fit contain y espacio reservado, sin recortes.

HallOfFame, Nombres del legado y HallLegacyShowcase reutilizan los mismos assets; fallback decorativo Lucide para un ID sin recurso. Catálogo, reglas, propuestas, contratos, fechas/evidencia ficticias y F6.2 permanecen iguales. Código: nuevo src/lib/hall-of-fame/emblems.ts, renderer hall-of-fame.tsx, hall.module.css y nueve pruebas nuevas hall-emblems.test.tsx.

1436 tests aprobados, 69 PostgreSQL de servicio opt-in omitidos, cero fallidos. PGlite solo en memoria y sin red, autorizado explícitamente para esta fase. Lint/typecheck/build Demo y 45 checks HTTP PASS. Navegador real en 1920/1440/390/320 px: fuentes decodificadas 512×512, tamaños CSS 160/96/48, alfa sobre fondo oscuro, sin máscaras, overflow ni errores de imágenes/hidratación, teclado/detalles y perfil vacío preservados. Capturas en artifacts/f631-*.png; comparación de tamaños en f631-size-comparison.png.

A 48 px se distinguen siluetas/colores, pero se pierden adornos finos. Conviene diseñar posteriormente una variante original simplificada de miniatura, sujeta a aprobación; no se reconstruyó mediante CSS ni se generó ahora. F5/P4.4.D, sus 13 hashes y SQL/journal intactos. Sin acreditaciones reales, equipamiento, commit o publicación.
