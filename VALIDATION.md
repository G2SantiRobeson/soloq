# Validación de la primera versión

Validación realizada el 4 de octubre de 2026 (America/Santiago).

| Verificación | Resultado |
| --- | --- |
| Instalación de dependencias y lockfile | Completada |
| `npm run db:generate` | Migraciones de esquema y RLS generadas |
| Migraciones ejecutadas en PostgreSQL embebido (PGlite) | Correctas |
| `npm run lint` | Correcto, sin errores ni warnings |
| `npm run typecheck` | Correcto |
| `npm run test` | 38 tests, 4 archivos, todos correctos |
| `npm run build` | Correcto, Next.js 16.3.8 |
| `npm audit --omit=dev` | 0 vulnerabilidades reportadas |
| Bundle público | Sin referencias a las variables de secretos del servidor |
| Exclusiones Git | `.env.local`, dependencias, caché y artefactos locales ignorados |

## Cobertura funcional

Dominio: queues, exclusión de modos, ranking oficial, divisiones y LP, winrate,
KDA, KP, agregaciones y routing. Cliente Riot: schema de respuestas, PUUID,
encoding, 429/Retry-After, retries limitados y deadline. Se verificó por separado
la diferencia ASIA/SEA entre ACCOUNT-V1 y MATCH-V5.

Integración: esquema PostgreSQL real ejecutado por PGlite, RLS sin políticas para
roles públicos, PUUID único, partidas idempotentes, snapshots de cambios,
reanudación tras fallo parcial, cascadas y conservación de partidas compartidas,
lease/cooldown entre ejecuciones y limitación atómica de login. Las consultas
públicas calculan agregados, ocultan perfiles pausados y no devuelven PUUID.
Las sesiones se prueban con almacenamiento real, hash, expiración, logout y
rotación del secreto. Riot y el contenedor de cookies se simulan en estos tests.

## Revisión en navegador

Se probaron las pestañas SoloQ/Flex/5v5, búsqueda, búsqueda sin resultados,
filtro de región, ordenación, perfil individual, gráfico de rango y entrada
administrativa deshabilitada en demo. Se revisaron los assets oficiales y la
ausencia de errores de consola durante esa navegación.

En la vista móvil se corrigió un desbordamiento causado por la etiqueta accesible
de la tabla. El documento cabe en el viewport; la tabla conserva su desplazamiento
horizontal propio para mantener legibles las columnas.

Las páginas principales, perfiles demo, administración y páginas legales
responden correctamente. La API del roster devuelve HTTP 401 sin sesión.
Next.js puede devolver HTTP 200 con la vista de no encontrado cuando la respuesta
ya comenzó a transmitirse; `notFound()` incorpora la indicación `noindex`.

La captura local de revisión está en `artifacts/soloq-preview.jpg` (excluida de Git).

## Alcance pendiente

No se proporcionaron credenciales Riot ni una base alojada, por lo que no se
afirma haber probado la integración con una cuenta real, la conexión de red a
Neon/Supabase ni un despliegue en Vercel. La implementación real está separada de
la demo y preparada para configurarse con los pasos del README.

La auditoría completa conserva cinco avisos altos en dependencias transitivas de
desarrollo del tooling ESLint/Next (`braces` y sus dependientes), sin corrección
estable disponible en el registro consultado. Las dependencias de producción
no tienen avisos reportados. Se documentan la compatibilidad con ESLint 9 y el
override de esbuild en el README.
