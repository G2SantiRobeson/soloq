# SoloQ

Leaderboard público de una comunidad de League of Legends, con perfiles, estadísticas por cola e historial de rango. La consulta no requiere cuenta. Una administración privada decide qué jugadores se siguen.

Primera versión funcional orientada a Vercel + PostgreSQL. El modo demo permite explorar la interfaz sin base de datos ni credenciales Riot y siempre identifica los datos como ficticios.

## Funcionalidades

- Leaderboard SoloQ, Flex y 5v5; búsqueda por Riot ID, filtro de plataforma y orden por rango/LP, partidas, winrate y KDA.
- Perfiles con iconos, resultados, estadísticas por campeón y gráfico del rango oficial desde el registro.
- Rangos ordenados por jerarquía y división; unranked después de ranked. No se estima MMR/ELO.
- Estados de carga, errores, listas vacías, unranked y datos desactualizados (más de 36 horas).
- Panel privado: añadir por Riot ID/plataforma, activar/desactivar, eliminar con confirmación y sincronizar.
- Sesiones revocables en PostgreSQL, caducidad de ocho horas, cookie HttpOnly/SameSite=Strict/Secure en producción y protección de origen en cada mutación.
- Importación incremental, snapshots de cambios, deduplicación, exclusión mutua entre instancias, ritmo conservador y reintentos acotados.
- Metadata, Open Graph, privacidad, términos y disclaimer visible de Riot.

## Arquitectura

```text
Visitante → páginas Next.js / Server Components → consultas Drizzle → PostgreSQL
Admin autenticado → Route Handlers → servicios → PostgreSQL
Cron con Bearer secret → lease PostgreSQL → syncPlayer → cliente Riot → PostgreSQL
Campeones → champ_icons / manifiesto generado → Data Dragon como fallback
Iconos de invocador → catálogo Data Dragon cacheado → CDN oficial
```

**Cargar páginas públicas no consulta ACCOUNT, LEAGUE ni MATCH de Riot.** Los datos reales se leen de PostgreSQL. El catálogo estático de Data Dragon tiene una caché de 24 horas; los campeones usan primero los PNG locales y después la CDN oficial como fallback. No se hace polling de Riot desde el navegador.

### Campeones, resumen global y evolución de LP

Los archivos `champ_icons/<championId>.png` se sincronizan mediante `npm run icons:sync`
a `public/champ-icons` y a un manifiesto tipado generado. También se ejecuta antes de
`dev` y `build`. El ID numérico coincide con el dato de las partidas y evita depender
del nombre traducido. Si falla el recurso local, se intenta Data Dragon y luego iniciales.
Las últimas cinco partidas muestran retratos con ✓/× y descripciones accesibles.
El inventario de archivos pendientes está en [champ_icons/README.md](champ_icons/README.md).

La home incluye destacados y WR/KDA conjuntos (ponderados por resultados y muertes,
respectivamente), además de partidas por participante. Los mejores WR/KDA requieren
al menos diez partidas en su fuente; el líder ranked se compara por tier, división y LP.

SoloQ y Flex muestran tendencia en la tabla y un balance en el perfil. Se utilizan
hasta 30 snapshots recientes, cortando la serie ante reinicios de contadores, Unranked
o datos inválidos. La coordenada de rango absorbe ascensos/descensos entre divisiones;
El gráfico usa únicamente snapshots oficiales. Su coordenada ordena tier y división, incluidos
Master, Grandmaster y Challenger, pero no se muestra ni se interpreta como LP ganado.
Los cambios de tier/división se etiquetan como ascenso/descenso; no se calculan recompensas
retrospectivas. El perfil diferencia confianza alta (una partida y contadores concordantes),
agregada (varias partidas) e indeterminada. El momentum resume solo el último segmento
comparable del mismo rango, hasta 30 snapshots: es una ventana de presentación, no retención.

### Remakes

Match-V5 aporta `gameEndedInEarlySurrender` en los participantes. Si alguno lo marca,
la partida se guarda con `matches.is_remake=true` y se muestra como **Remake**, con
una flecha circular neutra en la forma reciente. La duración no determina el resultado.
Los remakes permanecen en el historial, pero se excluyen de las agregaciones de combate,
V/D y winrate del historial importado. Los contadores y snapshots ranked conservan los
valores oficiales de Riot, incluyendo las penalizaciones que Riot aplique.

La migración `0002` añade una columna nullable: los registros anteriores quedan pendientes
de clasificación, sin inferir su resultado por duración. Después de `npm run db:migrate`,
ejecutar `npm run db:backfill-remakes` para consultar hasta cien partidas pendientes.
Repetir para lotes adicionales; cada resultado se persiste, respetando lease y rate limits.

Las agregaciones de combate se calculan en SQL a partir de filas persistidas y deduplicadas. Así se actualizan con cada importación sin mantener un segundo contador susceptible de desincronizarse. Las listas recientes están acotadas, y las agregaciones incluyen todo el historial importado.

## Stack y decisiones

Next.js 16.3.8 / App Router, React 19.3, TypeScript estricto, Tailwind CSS 4, PostgreSQL, Drizzle ORM, `postgres`, Zod, Recharts y Lucide. Node **24 LTS** recomendado (`.nvmrc`); también se admite Node 22.12+ dentro de la rama 22.

Drizzle mantiene el esquema tipado cerca de SQL, permite migraciones SQL revisables y no necesita generar un cliente binario. `prepare: false` permite conexiones mediante poolers transaccionales, incluido Supabase. Recharts se limita al gráfico del perfil.

Las versiones instaladas están fijadas mediante `package-lock.json`; usar `npm ci`. Se conserva ESLint 9.39.5 por compatibilidad: el plugin React de `eslint-config-next` 16.3.8 falla con ESLint 10 (`context.getFilename`). No se usan versiones RC de Drizzle aunque su documentación actual muestre ejemplos de la siguiente versión.

## Setup local

```sh
git clone https://github.com/G2SantiRobeson/soloq.git
cd soloq
npm ci
```

Copiar `.env.example` a `.env.local`:

```sh
# macOS / Linux
cp .env.example .env.local
```

```powershell
# PowerShell
Copy-Item .env.example .env.local
```

Para explorar la demo, dejar `DEMO_MODE=true` y ejecutar:

```sh
npm run dev
```

Abrir [localhost:3000](http://localhost:3000). Para verificar la versión de producción: `npm run build` y después `npm start`. El build y los tests no necesitan una cuenta Riot existente ni una base remota.

## Variables de entorno

| Variable                   | Uso                                                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `DEMO_MODE`                | `true` activa exclusivamente fixtures. Para datos reales debe ser `false`. Nunca se activa automáticamente si falla la base o la clave. |
| `DATABASE_URL`             | URI PostgreSQL con credenciales y SSL según el proveedor. Solo servidor.                                                                |
| `RIOT_API_KEY`             | Development Key para desarrollo privado; Production Key para un servicio público real. Solo servidor.                                   |
| `ADMIN_PASSWORD`           | Contraseña única de al menos 16 caracteres. No se guarda en el navegador.                                                               |
| `ADMIN_SESSION_SECRET`     | Secreto aleatorio de al menos 32 caracteres para HMAC de los tokens almacenados. Rotarlo invalida todas las sesiones.                   |
| `CRON_SECRET`              | Secreto aleatorio de al menos 32 caracteres. Vercel lo envía como `Authorization: Bearer …`.                                            |
| `APP_URL`                  | Origen exacto, por ejemplo `https://soloq.example`. Se usa en validación de Origin y metadata. Sin rutas adicionales.                   |
| `DDRAGON_VERSION`          | Opcional: fijar una versión existente. Vacío descubre la última versión publicada diariamente.                                          |
| `RIOT_REQUEST_INTERVAL_MS` | Opcional, 1300 por defecto; se acepta aumentar la espera. El mínimo de esta versión es 1300 ms.                                         |

Generar cada secreto por separado y pegar el resultado únicamente en el gestor de variables o `.env.local`:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

**Nunca commitear la Development API Key ni ningún secreto.** `.gitignore` excluye `.env*`, salvo `.env.example`. Ninguna variable sensible tiene prefijo `NEXT_PUBLIC_`. No incluir secretos en URLs, capturas o logs.

## Base de datos

Usar un proyecto independiente con PostgreSQL 15 o superior. No se necesita Supabase Auth ni su API de datos.

### PostgreSQL local con Docker

La instalación local usa `compose.local.yaml`, PostgreSQL 17 y el volumen persistente
`soloq_soloq-postgres-data`. La conexión escucha únicamente en `127.0.0.1:5433`.
Las credenciales están en `.env.postgres.local` y la conexión de la app en `.env.local`;
ambos archivos están excluidos de Git.

Para volver a arrancar la base: `docker compose -f compose.local.yaml up -d --wait`.
Para detenerla conservando los datos: `docker compose -f compose.local.yaml stop`.
Docker Desktop debe estar en ejecución. Las migraciones se aplican con `npm run db:migrate`.
La contraseña de administración se consulta en `ADMIN_PASSWORD` dentro de `.env.local`.

Después de configurar una Development Key válida en `RIOT_API_KEY`, reiniciar Next.js
y agregar jugadores desde `/admin`. Una base recién creada comienza sin jugadores.

### Neon

1. Crear una cuenta y un proyecto en [Neon](https://neon.com/).
2. Elegir una región próxima a las funciones de Vercel.
3. En **Connect**, elegir base/rol y copiar la cadena PostgreSQL con pooling y SSL para `DATABASE_URL`.
4. Para las migraciones, utilizar la conexión directa de esa misma base si el proveedor lo recomienda. Puede sobrescribirse temporalmente `DATABASE_URL` al ejecutar el comando.

### Supabase

1. Crear un proyecto en [Supabase](https://supabase.com/) y guardar su contraseña de base de datos.
2. En **Connect**, copiar la URI del pooler para entornos serverless, sustituyendo la contraseña y conservando los parámetros SSL del proveedor.
3. Configurar esa URI como `DATABASE_URL`. El driver desactiva prepared statements para el pooler transaccional.
4. Ejecutar migraciones con una conexión directa o de sesión a la misma base. El rol debe poder crear tablas en `public`.
5. Las migraciones habilitan **RLS sin políticas de acceso para clientes en las siete tablas**. `DATABASE_URL` debe utilizar el rol propietario del backend (o un rol con BYPASSRLS), nunca el rol `anon`. La aplicación autoriza las peticiones en Next.js. Como defensa adicional, desactivar la Data API de Supabase o retirar `public` de sus esquemas expuestos si esa API no se usa en el proyecto. No se necesitan claves `anon`/`service_role` en el frontend.

Más detalles: [Drizzle con Supabase](https://orm.drizzle.team/docs/connect-supabase), [conexiones Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres) y [conexiones Neon](https://neon.com/docs/connect/connect-from-any-app).

### Migraciones

Con `DATABASE_URL` configurada:

```sh
npm run db:migrate
```

Aplica las migraciones versionadas de `drizzle/` y registra cuáles se ejecutaron. El comando no elimina ni reinicializa la base. No se ejecuta en cada request ni durante `next build`.

Al cambiar `src/db/schema.ts`, ejecutar `npm run db:generate`, revisar el SQL generado y después `npm run db:migrate`. Usar respaldo y entorno de staging antes de migraciones de producción.

### Modelo de datos

| Tabla              | Propósito e integridad                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `players`          | UUID interno, Riot ID, PUUID único y estable, plataforma, icono, enabled, timestamps, estado y cursor de sincronización. Una cuenta no se duplica al cambiar de nombre. |
| `ranked_snapshots` | Estado por jugador/cola: tier, división, LP, V/D y fecha. Se inserta al cambiar cualquiera de esos valores, incluido unranked. Índice jugador/cola/fecha.               |
| `matches`          | Match ID de Riot como PK, cola, mapa, timestamp y duración. Sin JSON masivo de Riot.                                                                                    |
| `player_matches`   | PK compuesta jugador/partida; campeón, posición, K/D/A, CS, daño, victoria y participación en kills.                                                                    |
| `admin_sessions`   | Hash HMAC del token aleatorio y expiración; nunca almacena el token de cookie en claro.                                                                                 |
| `login_attempts`   | Contador atómico compartido: hasta 10 intentos cada 15 minutos para el administrador.                                                                                   |
| `sync_locks`       | Lease compartido con propietario y vencimiento para sincronización y mutaciones del roster.                                                                             |

Eliminar un jugador elimina sus snapshots y participaciones mediante FK `ON DELETE CASCADE`. Las partidas compartidas sobreviven; la ruta elimina solo las que quedaron sin jugadores. Pausar oculta el perfil público, detiene su sincronización y conserva los datos. Una transferencia de plataforma requiere por ahora intervención del operador en la base; no crear una cuenta duplicada.

## Seed / modo demo

La demo vive en `src/server/demo.ts`, separada del repositorio SQL y del cliente Riot. Incluye doce cuentas con prefijo `Demo`, todos los tiers, 0/999 LP, winrates de 0/100%, nombres largos, datos antiguos y perfiles sin historial. **No inserta datos de prueba en PostgreSQL.** El banner DEMO aparece en todas las páginas. La administración y la sincronización están deshabilitadas en este modo.

La guía visual está en [`design.md`](design.md). El frontend usa Barlow y Barlow Condensed servidas localmente con licencias OFL en `src/app/fonts`. En móvil, las filas del ladder reorganizan posición, identidad, rango, LP, WR y forma reciente; los filtros conservan la posición global del jugador. No se añadieron dependencias de UI.

Los assets de campeones e iconos sí son oficiales de Data Dragon, incluso en demo. Si la CDN falla, se muestran iniciales; no se depende de ella para compilar. La versión se descubre mediante `versions.json` y los nombres/archivos se resuelven por ID numérico desde `champion.json`. No hay URLs de un parche antiguo hardcodeadas.

## Riot Developer API

### Obtener una Development API Key

1. Entrar al [Riot Developer Portal](https://developer.riotgames.com/) con una cuenta Riot.
2. Generar o regenerar la Development API Key del panel.
3. Guardarla únicamente como `RIOT_API_KEY` en `.env.local`.
4. Configurar PostgreSQL y los secretos admin, ejecutar migraciones, cambiar a `DEMO_MODE=false` y reiniciar Next.
5. Abrir `/admin`, entrar con `ADMIN_PASSWORD` y añadir `gameName`, `tagLine` sin `#`, y la plataforma correcta (LAS = LA2).

Las Development Keys expiran cada 24 horas. Un 401/403 se informa y no se reintenta indefinidamente. La cuenta guardada puede quedar con sincronización pendiente si Riot falla después de resolverla; el panel conserva y muestra ese estado.

### Endpoints y routing

Se consultó la documentación oficial para esta implementación, incluyendo las referencias dinámicas de [LEAGUE-V4](https://developer.riotgames.com/apis/#league-v4) y [MATCH-V5](https://developer.riotgames.com/apis/#match-v5):

- ACCOUNT-V1: `/riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}` y `/by-puuid/{puuid}` con routing regional.
- SUMMONER-V4: `/lol/summoner/v4/summoners/by-puuid/{encryptedPUUID}` con routing de plataforma; se usa para el icono y para validar la plataforma.
- LEAGUE-V4: **`/lol/league/v4/entries/by-puuid/{encryptedPUUID}`**, sin depender de Summoner ID.
- MATCH-V5: `/lol/match/v5/matches/by-puuid/{puuid}/ids` y `/lol/match/v5/matches/{matchId}`, routing regional.

`src/lib/routing.ts` centraliza AMERICAS (NA/BR/LAN/LAS), EUROPE (EUW/EUNE/TR/RU/ME), ASIA (KR/JP) y SEA (OCE/SG/TW/VN). Las plataformas antiguas PH2/TH2 no se ofrecen en el formulario; revisar el catálogo actual antes de ampliarlo. ME1 se obtiene de la referencia de MATCH-V5, más actual que algunas tablas generales del portal.

**ACCOUNT-V1 y MATCH-V5 no comparten exactamente los hosts disponibles.** La referencia oficial de ACCOUNT-V1 ofrece AMERICAS, ASIA y EUROPE, sin SEA. `accountRouting()` usa ASIA para cuentas de OCE/SG/TW/VN, mientras MATCH-V5 usa SEA. Los datos de ACCOUNT se replican entre clusters según la documentación de Riot. Esta diferencia tiene una prueba específica.

### Alcance de 5v5

Fuente: [catálogo oficial de queues](https://static.developer.riotgames.com/docs/lol/queues.json). Configuración editable: `src/lib/queues.ts`.

| Queue ID | Incluida                               |
| -------- | -------------------------------------- |
| 400      | Draft Pick                             |
| 420      | Ranked Solo/Duo (`RANKED_SOLO_5x5`)    |
| 430      | Blind Pick, si aparece en el historial |
| 440      | Ranked Flex (`RANKED_FLEX_SR`)         |
| 490      | Quickplay                              |
| 700      | Clash de Summoner's Rift               |

Además se exige `mapId=11` y `gameMode=CLASSIC`. La selección es intencionalmente conservadora: excluye Swiftplay (480, reglas diferentes), custom (0), ARAM (450), Clash de ARAM (720), Arena, bots y modos temporales. 5v5 incluye SoloQ/Flex como subconjuntos; **no sumar los totales de las tres pestañas**. No tiene LP ni rango propios. Para incorporar un nuevo modo, revisar la fuente, cambiar la configuración y actualizar los tests y textos de la interfaz.

### Semántica estadística

- Ranked: rango/LP/V/D/partidas/winrate usan el último snapshot de LEAGUE-V4, que puede abarcar más partidas que el historial importado.
- 5v5 y estadísticas por campeón: solo las participaciones importadas, nunca se mezclan modos excluidos.
- KDA: `(suma kills + suma assists) / max(1, suma deaths)`. Sin partidas se muestra `—`.
- CS: minions + monstruos neutrales; CS/min usa la duración acumulada.
- KP: `(kills + assists) / kills del equipo`; con cero kills de equipo es `null`/`—`.
- Los contadores de resumen son resultados **individuales**: si dos jugadores comparten partida cuenta una participación para cada uno.
- El gráfico conecta snapshots de cambios; su coordenada acumula LP oficiales entre divisiones y muestra tier/división/LP en el tooltip. No predice habilidad ni reconstruye historia anterior al registro.

### Pasar a Production API

Registrar el producto en el portal, proporcionar una demo funcional, explicar la sincronización y completar privacidad/contacto. Solicitar la aprobación de una Production Key y reemplazar `RIOT_API_KEY` en Vercel; no cambia el modelo ni el frontend. **Un producto público real requiere Production Key**: las claves development/personal no autorizan un lanzamiento público, ni siquiera una beta abierta. La demo sin datos reales permite enseñar el prototipo durante el proceso. Consultar las [políticas del portal](https://developer.riotgames.com/docs/portal) y las [políticas de League](https://developer.riotgames.com/docs/lol).

## Sincronización y cron

`syncPlayer(playerId, client)` es la operación central. Solo se invoca dentro de `withSyncLease`, usada tanto por cron como por las acciones administrativas. El bloqueo vive en PostgreSQL, por lo que cubre distintas instancias de Vercel. Si un proceso muere, el lease caduca.

1. Actualiza identidad e icono; consulta ambas colas ranked y registra los cambios de estado.
2. Importa desde el inicio regional de la temporada. Congela `scanEnd` dos minutos antes de la ejecución, persiste páginas de 100 IDs y procesa lotes de 25.
3. Guarda cada partida y el avance del cursor en una transacción con `ON CONFLICT DO NOTHING`. Un fallo conserva las filas ya guardadas y los IDs pendientes de esa página.
4. Procesa hasta 25 IDs por jugador o hasta acercarse al presupuesto de tiempo. En la siguiente ejecución retoma la ventana congelada.
5. Al completar, mueve el cursor con solapamiento de 24 horas para tolerar indexación tardía y actualiza `lastSyncedAt`. Si falta historial, conserva el timestamp anterior y un mensaje administrativo.

Concurrencia Riot = **1**, mínimo 1300 ms entre peticiones, timeout de 10 s y máximo 3 intentos por petición. HTTP 429 respeta `Retry-After` en segundos o fecha HTTP. Si la espera excede el presupuesto, se difiere la sincronización y el lease conserva el cooldown para otras instancias. Los errores transitorios usan backoff acotado; 401/403/404 no tienen retries automáticos. Los logs muestran IDs internos, estados y contadores, sin headers, contraseñas ni respuestas completas.

El lote prioriza los jugadores con intentos más antiguos, selecciona hasta 50 y usa un presupuesto de cliente de 230 s. La función Vercel declara máximo 300 s y el lease 285 s. Usar una configuración de funciones que permita esa duración. No usar la misma Riot Key desde otro proceso que ignore este lease.

`vercel.json` programa **09:00 UTC una vez al día**. Esta configuración es compatible con Hobby; no promete sincronización en tiempo real. En un plan que permita mayor frecuencia, cambiar el schedule a `*/15 * * * *` y redeployar. Vercel envía automáticamente `CRON_SECRET` como Bearer. El cron solo se programa en producción; localmente se puede usar el botón de sincronizar en `/admin`.

Puede verificarse manualmente el endpoint con un cliente HTTP, usando `GET /api/cron/sync` y `Authorization: Bearer <CRON_SECRET>` como header. No pasar el secreto en la URL. Un 409 significa trabajo en curso/cooldown; el siguiente cron lo reintenta. Revisar también los estados parciales/error del JSON y los logs, no solo el HTTP 200. [Documentación oficial de Vercel Cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

## Endpoints

| Método y ruta                    | Acceso                                  | Acción                                                |
| -------------------------------- | --------------------------------------- | ----------------------------------------------------- |
| `GET /`                          | Público                                 | Leaderboard; `?queue=soloq`, `flex`, `5v5`.           |
| `GET /player/[id]`               | Público                                 | Perfil de jugador habilitado; mismas colas.           |
| `GET /admin`                     | Sesión o formulario de entrada          | Administración privada.                               |
| `POST /api/admin/login`          | Origin válido + contraseña + rate limit | Crear sesión.                                         |
| `POST /api/admin/logout`         | Sesión + Origin                         | Revocar sesión.                                       |
| `GET /api/admin/players`         | Sesión                                  | Listar roster y estado de sincronización.             |
| `POST /api/admin/players`        | Sesión + Origin                         | Validar Riot ID, resolver cuenta, guardar e importar. |
| `PATCH /api/admin/players/[id]`  | Sesión + Origin                         | Cambiar `{ "enabled": true/false }`.                  |
| `DELETE /api/admin/players/[id]` | Sesión + Origin                         | Eliminar con `{ "confirm": true }`.                   |
| `POST /api/admin/sync`           | Sesión + Origin                         | Sincronizar lote.                                     |
| `GET /api/cron/sync`             | Bearer `CRON_SECRET`                    | Sincronizar lote desde cron.                          |
| `GET /privacy`, `GET /terms`     | Público                                 | Textos iniciales del prototipo.                       |

Todas las APIs administrativas validan la sesión en servidor. Sus respuestas llevan `Cache-Control: no-store`; no se usa localStorage. Zod valida entradas/respuestas Riot, las consultas son parametrizadas y React escapa el contenido. El cuerpo JSON de las mutaciones está limitado a 8 KiB. El panel no devuelve PUUID ni tokens. La protección de sesión no depende de ocultar botones.

## Deployment en Vercel

1. Subir este proyecto a su repositorio GitHub y crear/importar el proyecto en [Vercel](https://vercel.com/), preset Next.js, Node 24.
2. Crear PostgreSQL en Neon o Supabase, aplicar las migraciones una vez y configurar conexión segura/pooler como se describe arriba.
3. Configurar las variables en **Settings → Environment Variables**. En producción usar `DEMO_MODE=false`, `APP_URL` con el dominio definitivo y secretos propios. Para publicar solo la demo, usar `DEMO_MODE=true`; el cron no importa datos en ese modo.
4. Configurar `RIOT_API_KEY` de producción aprobada antes de habilitar datos reales para visitantes públicos. Para pruebas privadas usar una instancia protegida, no un deployment público con Development Key.
5. Desplegar. Build: `npm run build`; instalación reproducible: `npm ci`. No poner migraciones destructivas en el build ni compartir base/secretos entre previews no confiables y producción.
6. Verificar login admin, añadir una cuenta, observar su primera sincronización y revisar Functions/Cron logs. Ajustar la frecuencia conforme al plan y al volumen.
7. Completar la identidad/contacto del responsable en `/privacy` y `/terms`, y registrar el producto en Riot antes del lanzamiento público real.

No se provisionan cuentas, bases, API keys ni servicios de pago automáticamente. [Next.js en Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs).

## Estructura

```text
src/app/                  Páginas App Router, metadata, estados y rutas API
src/components/           Leaderboard, tabs, perfil, gráfico y administración
src/lib/                  Tipos, colas, routing, ranking y cálculos puros
src/db/                   Esquema Drizzle y conexión PostgreSQL server-only
src/server/               Auth, validación HTTP, consultas públicas y demo aislada
src/server/riot/          Cliente Riot, esquemas, normalización y Data Dragon
src/server/sync/          Lease distribuido y servicio incremental
drizzle/                  Migraciones SQL y metadata versionadas
scripts/migrate.ts        Aplicación explícita de migraciones
tests/                    Dominio, Riot, seguridad y PostgreSQL embebido
```

## Scripts y pruebas

| Comando               | Función                                   |
| --------------------- | ----------------------------------------- |
| `npm run dev`         | Desarrollo con recarga.                   |
| `npm run lint`        | ESLint / reglas Next y TypeScript.        |
| `npm run typecheck`   | TypeScript sin emitir archivos.           |
| `npm run test`        | Vitest; sin credenciales ni red.          |
| `npm run build`       | Build de producción.                      |
| `npm start`           | Servir el build.                          |
| `npm run format`      | Formato con Prettier.                     |
| `npm run db:generate` | Generar nueva migración desde el esquema. |
| `npm run db:migrate`  | Aplicar migraciones a `DATABASE_URL`.     |

Los tests críticos cubren clasificación de queues, jerarquía/divisiones/LP, winrate/KDA/KP, agregaciones, routing, 429 y retries, límite de tiempo, autenticación/origen de rutas, deduplicación por PUUID y partida, cascadas, snapshots, exclusión de modos, reanudación de una página incompleta, lease compartido y limitación concurrente de login. Las pruebas de integración ejecutan las migraciones reales con **PGlite (PostgreSQL embebido)**; no simulan SQL con un array en memoria. Las respuestas Riot sí se simulan, para no depender de claves ni cuentas.

## Límites conocidos y próximos pasos

- El historial y la sincronización incremental se validaron localmente contra Neon staging con una cuenta Riot real y Development Key. La validación manual en Vercel Preview sigue pendiente; consultar `VALIDATION.md` para evidencia y alcance.
- La importación inicial abarca la temporada anual disponible en MATCH-V5 y requiere varios lotes. La retención de Riot puede impedir recuperar partidas antiguas; completar el recorrido no garantiza que Riot conserve toda la temporada. El incremental solapa 24 horas; retrasos de indexación mayores pueden requerir un backfill operativo.
- La sincronización serial está pensada para una comunidad pequeña. Para cientos/miles de jugadores se necesita una cola duradera por trabajo, presupuesto por método/región y control de rate limits según los headers de producción. La frecuencia diaria de Hobby puede dejar backlog; monitorizar la antigüedad de los jugadores.
- El leaderboard agrega todo el historial de jugadores habilitados en cada consulta. Para alto tráfico, añadir caché invalidada por sincronización, paginación y agregados materializados tras medir.
- Hasta 40 partidas recientes en la lista del perfil; las estadísticas y el gráfico móvil usan toda la temporada. La progresión conserva todos los snapshots de la temporada. El resto del historial permanece en la base. No hay API pública de exportación ni paginación de partidas todavía.
- No hay cuentas de usuario, OAuth/RSO, sistema de roles, MFA, alertas, edición de plataforma ni eliminación automática por retención. El bucket de login compartido puede bloquear nuevos intentos durante 15 minutos; para mayor escala conviene combinar controles por IP confiable e identidad.
- Revisar los textos legales, backups y contacto del responsable antes de producción. La implementación facilita cumplir la política, pero la aprobación corresponde a Riot.
- En la auditoría inicial, las dependencias de producción no presentan vulnerabilidades reportadas. Hay avisos de desarrollo heredados de `braces` en las herramientas ESLint/Next, sin versión estable corregida disponible en el registro consultado. No se aplica `npm audit fix --force`, que propone degradar Next/Drizzle. Revisar nuevas versiones del tooling. `esbuild` se sobreescribe a 0.28.2 para retirar su aviso conocido; generación de migraciones y tests se validan con esa versión.

Prioridades siguientes: probar una cuenta real en entorno privado, habilitar la base alojada, obtener Production Key, completar textos del operador y ajustar cron; después medir el tráfico y ampliar la cola de sincronización según necesidad.


## Historial de temporada y seguimiento de rango

`src/lib/season.ts` centraliza el ciclo **anual** 2026, distinto de las temporadas temáticas:
8 de enero a las 12:00 del servidor, según las [notas oficiales 26.1](https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-1-notes/).
En LAS equivale a 15:00 UTC. Las fechas se convierten con las zonas del servidor;
`endAt` es opcional (UTC, exclusivo). Al cambiar `CURRENT_SEASON`, el siguiente sync reinicia
solo el cursor de importación, sin borrar partidas ni snapshots anteriores.

El alta resuelve la cuenta, guarda el rango actual y comienza a importar hasta 5 IDs,
con un presupuesto de 35 segundos. `/api/cron/sync`, la sincronización manual o
**Continuar historial** procesan como máximo 25 IDs por jugador y ejecución. MATCH-V5 se
pagina con `count=100`, offsets 0/100/200…, límites temporales congelados e IDs pendientes
persistidos. Cada participación y su cursor se confirman en una misma transacción. Los
campos de la migración **0003_careless_odin.sql** ya existente son suficientes; no hay
migración nueva. Una página corta termina el recorrido; exactamente 100 requiere otra página.

Al terminar, la consulta incremental avanza desde el límite temporal ya recorrido con
24 horas de solapamiento. Las claves únicas de Match y PlayerMatch evitan duplicados.
Solo se almacenan las queues de `STANDARD_QUEUES`, map 11 y modo CLASSIC; no se guarda raw JSON.
Los contadores del trabajo describen IDs procesados/descubiertos, incluyendo modos excluidos;
las estadísticas públicas cuentan únicamente las partidas compatibles, sin remakes.

El cliente continúa serial (mínimo 1300 ms), con tres intentos como máximo, backoff y
Retry-After. El lease PostgreSQL excluye cron/manual/altas concurrentes y conserva el cooldown.
El presupuesto global es 230 s dentro del máximo HTTP existente de 300 s. Una fecha límite
conserva el estado running; 401/403 y otros fallos lo marcan recuperable sin perder progreso.
Tras renovar la Development Key, **Reintentar historial** continúa el cursor. Los detalles
404 se cuentan como no disponibles. No hay procesos de fondo fuera de la request ni scheduler nuevo.

**Rendimiento de temporada** se calcula desde MATCH-V5: V/D, WR, KDA, CS/min, campeones y
winrate móvil de 20 partidas (adaptativo al inicio). SQL calcula la ventana antes de seleccionar
el último punto diario. **Progresión de rango** empieza en el primer snapshot real de esa cola
y temporada. Solo se inserta un snapshot si cambia tier/división/LP/V/D o comienza la temporada.
No se infiere rango pasado a partir de resultados. Los deltas de confianza alta exigen además
una partida que termine entre snapshots y contadores coincidentes; siguen siendo observaciones,
no premios exactos de MATCH-V5, porque puede haber ajustes externos.

`/metrics` tiene filtros Temporada (predeterminado), 30d y 7d. Usa agregados SQL y muestra
participaciones, partidas únicas, rendimiento, campeones, actividad semanal y rango actual.
La forma reciente compara las últimas 20 partidas del período; WR, KDA y destacados recientes
exigen al menos 10 partidas (`HIGHLIGHT_MIN_GAMES`). El WR por campeón utiliza el mismo mínimo.
Subidas y caídas comparan el último tramo de hasta 30 snapshots del mismo tier/división,
con fechas visibles: no son LP reconstruidos ni dependen del filtro de partidas.
Una partida compartida cuenta una participación por jugador, pero una sola partida única.
Los filtros no eliminan datos. Los estados parcial/completo/fallido son visibles en perfil/admin;
la demo ilustra meses de partidas frente a horas de snapshots y nunca escribe en PostgreSQL.

## Δ SEMANA y sincronización global

La semana comienza el lunes 00:00 en `America/Santiago` (`src/lib/time.ts`),
respetando DST. `weeklyRankDelta` resta la posición del último RankedSnapshot válido
anterior o igual al lunes a la del último snapshot válido de la misma cola y temporada.
No hay baseline: `—`. Solo/Duo y Flex son independientes; 5v5 no combina rangos.
`rankProgress` usa 100 LP/división y 400/tier; Master/Grandmaster/Challenger comparten
2800 + LP. Promociones y descensos se expresan como desplazamiento continuo, sin
atribuir premios individuales de MATCH-V5. La consulta semanal usa una ventana SQL
y devuelve como máximo dos observaciones por jugador, sin N+1 ni límite de 30 snapshots.

El objetivo de 10 minutos está en `LADDER_SYNC_INTERVAL_MS` de
`src/lib/sync-status.ts`. La migración `0004_far_wiccan.sql` añade cuatro campos
nullable a `sync_locks`. Solo una ejecución global que recorra todos los jugadores
habilitados y complete sus sincronizaciones registra `lastSuccessfulSyncAt` al finalizar.
Errores, backfills parciales, límite de lote y trabajos individuales no lo avanzan.
Un lease abandonado se muestra como fallido. `nextExpectedSyncAt` es el último éxito
más 600000 ms, no una promesa de ejecución del scheduler.

El navegador cuenta localmente cada segundo. Al vencer, faltar metadata o estar corriendo,
consulta exclusivamente `/api/ladder/sync-status` cada 15 segundos mientras la pestaña
esté visible; no llama a Riot ni inicia un sync. Un éxito más reciente provoca
`router.refresh()` y comienza el siguiente ciclo desde su timestamp persistido.
Sin éxito nuevo permanece actualizando o indica retraso si el último intento falló.

**Programación externa pendiente:** `vercel.json` conserva su cron diario de Production.
No se cambió. [Vercel cron solo corre en Production](https://vercel.com/docs/cron-jobs/manage-cron-jobs),
no en Preview. Actualmente no hay scheduler de 10 minutos para staging.
Hace falta configurar, con autorización separada, un runner externo que invoque
`GET /api/cron/sync` cada 10 minutos, con `Authorization: Bearer <CRON_SECRET>`
y acceso autorizado al Preview protegido. Los secretos se guardan en el runner,
no en la URL ni en el cliente. Verificar ejecuciones y límites del proveedor antes
de declarar `LADDER_SCHEDULER_ENABLED=true`; esa variable solo informa al UI y no crea jobs.
El lease y el pacing serial existentes siguen evitando solapamientos y respetando 429/Retry-After.

`/dev/ladder` permite auditar signos, baseline ausente, fin del contador y refresco
con metadata ficticia en memoria. Solo está disponible con NODE_ENV=development;
no escribe en Neon ni llama a Riot. Los datos reales nunca se sustituyen por esa simulación.
