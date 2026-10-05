# SoloQ — sistema visual

## Dirección

Una clasificación de competición, con la precisión de una hoja de resultados de esports.
El ranking es el contenido principal: emblema de rango → jugador → LP → WR → forma.
La posición permanece como número secundario en su columna. Las alas de `Wings/`
rodean el avatar en Jugador / Riot ID; el emblema de tier aparece junto al texto en Rango.
Sin hero promocional, tarjetas por métrica, ornamentos de Riot inventados ni efectos luminosos.
La identidad procede de la tipografía condensada, numeración grande y reglas de separación.

## Tokens

- Fondo carbón `#101215`; superficie `#171a1f`; superficie activa `#20252a`.
- Texto `#f0f1ed`; secundario `#a2a9b2`; borde `#30363d`.
- Selección marfil `#e0d3ad`; victoria verde `#9bc7ab`; derrota coral `#df9299`.
- Rangos: Iron `#afa49b`, Bronze `#caa081`, Silver `#c5cdd5`, Gold `#ddc17f`,
  Platinum `#88c9d0`, Emerald `#7ed3ac`, Diamond `#9abaff`, Master `#c9a3ec`,
  Grandmaster `#ed9995`, Challenger `#eed28d`. Unranked neutro, sin LP ficticios.
- Bordes de 1 px. Radio 2 px para controles e imágenes; secciones abiertas sin sombras.
- Espaciado: 4 / 8 / 12 / 16 / 24 / 32 / 48 px. Ancho máximo 1360 px.

## Tipografía

Barlow Condensed semibold para títulos, posiciones y LP; Barlow regular/semibold
para texto, identidades y navegación. Fuentes locales con sus licencias OFL.
Escala: 48/40 px título, 24 px sección, 18 px LP, 14 px contenido, 12 px metadatos,
11 px etiquetas. Números tabulares y lining (`tnum`, `lnum`); porcentajes alineados.
Riot ID legible, tag secundario. Nombres largos envuelven; nunca se pierde la identidad.

## Lenguaje de componentes

- RankEmblem: artwork completo de `rank_icon`, con alas propias de cada tier y viewport
  ajustado a sus márgenes transparentes. RankDisplay conserva nombre y división visibles.
  El color refuerza, nunca sustituye, el texto. Fallback neutro para Unranked y assets ausentes.
- LPDisplay: valor dominante y unidad pequeña; guion cuando no corresponde.
- PlayerIdentity: icono cuadrado, nombre, tag, región y frescura secundaria.
- RecentChampionForm: cinco retratos de campeón, más reciente a la izquierda;
  borde semántico y marcas ✓/×, con campeón y resultado accesibles.
- ChampionIdentity: retrato y nombre juntos, tamaños constantes, fallback de iniciales.
- QueueTabs: carriles numerados SoloQ / Flex / 5v5; fondo y regla superior seleccionados.
- Botones rectangulares, altura mínima 40 px; primario marfil, secundario con borde.
- Inputs con label, fondo oscuro y foco visible también en su contenedor.
- Tabla compacta, avatar con marco específico del tier y emblema de 44 px junto al rango, posición secundaria, LP separado, líderes con acento sutil.
  Sorting explícito; búsqueda, región y orden disponibles también en móvil.
- Perfil: cabecera de identidad, columna de rango y área de evolución en una misma banda;
  métricas en línea, repertorio de campeones y registro de partidas separados por reglas.
- Iconos solo para acciones o información. Wordmark textual propio, sin logotipo de League.

## Responsive y estados

Desktop ≥1100 px: tabla completa. Laptop/tablet: ocultar métricas secundarias primero.
Móvil ≤700 px: una fila se transforma en ficha compacta de resultados, con posición,
jugador, rango, LP, WR y forma; sin scroll horizontal. Orden mediante select accesible.
Perfil pasa a una columna; historial reorganizado y métricas en 2×2 sin tarjetas.
Vacío, carga, error, datos antiguos, sin rango y 5v5 mantienen el mismo sistema.
No se inventan cambios de posición: los datos actuales no incluyen posiciones históricas.

## Accesibilidad y motion

Semántica de tabla y encabezados, enlaces reales, foco de 2 px, acceso directo al contenido,
labels en controles y targets de al menos 40 px. Win/loss incluyen símbolos y texto accesible además del color.
Hover/focus 120 ms, sin animación de gráficos; respetar `prefers-reduced-motion`.
Disclaimer legible, enlaces legales y administración en el footer.

## Auditoría inicial

Hero de marketing, tres tarjetas de resumen, Arial uniforme, LP pequeño bajo el rango,
posiciones débiles, escudos idénticos, textos de 7–10 px y tabla móvil de 1000 px.
Se conserva Tailwind y toda la arquitectura, rutas, metadata y contratos de datos.

## Aplicación y revisión

La demo incluye los diez tiers, sin rango, 0/999 LP, 0/100% WR, Riot ID largo,
sin partidas, datos antiguos y un icono ausente. Nunca mezclar estos fixtures con producción.
No confundir falta de datos (guion y barra neutra) con 0% WR (registro real de derrotas).
Al filtrar u ordenar, se conserva la posición global de la cola.
El eje del gráfico muestra LP en Master+; en tiers inferiores muestra la coordenada acumulada,
con rango y división explícitos en los extremos y en el tooltip. No es MMR.
El diálogo administrativo contiene el foco y lo devuelve al botón de origen.

Herramientas: se consultó Plugin Management; `build-web-apps` y `product-design` no
aparecieron como disponibles en este entorno. Implementación y auditoría mediante código
y navegador integrado. No se utilizó `frontend-skill`. Detalles de QA en `artifacts/redesign/QA.md`.

## Iteración de campeones e insights

Los retratos usan `champ_icons/<championId>.png`, sincronizados a `public/champ-icons`
con un manifiesto generado. Prioridad: archivo local → Data Dragon → iniciales.
El ID numérico evita discrepancias de nombres, idiomas y puntuación.

GlobalMetricsSection aparece después de la tabla: líder por rango, mejor WR/KDA
con mínimo de diez partidas y jugador con más partidas; debajo, WR/KDA conjuntos
y partidas por participante. Sus denominadores son explícitos. Los filtros de la
tabla no alteran los insights de la comunidad. En móvil, dos columnas de destacados
y una fila por promedio; sin tarjetas ni sombras.

PlayerMomentum combina flecha, signo y delta de la coordenada de rango entre hasta
30 snapshots comparables. El perfil conserva hasta 180 puntos en la gráfica y suma
LpDeltaSummary: neto, LP/victoria, LP/derrota y neto/partida, con fechas y muestras.
Las estimaciones no se presentan como recompensas exactas de Match-V5. SoloQ y Flex
se calculan por separado; 5v5 no recibe ninguna métrica de LP.

Ver metodología y segunda revisión visual en `artifacts/insights/QA.md`.
