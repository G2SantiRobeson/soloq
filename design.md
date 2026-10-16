# SoloQ — sistema visual

## Dirección (RC3, en revisión)

Transmisión competitiva: un fondo de tinta y un cromo color hueso que no compiten con el
contenido. El color de la pantalla pertenece a los jugadores: su tier, sus campeones y sus
resultados. El ranking sigue siendo el contenido principal y se lee como una escalera:
estratos por tier oficial (Challenger → Iron → Sin clasificar) con su banda fijada bajo las
cabeceras de columna mientras se recorre. La firma de la portada es la forma de la escalera:
una barra de distribución por tier construida solo con los jugadores visibles.
En el perfil, el tier del jugador tiñe el héroe y el marcador. Sin glow, gradientes,
cejas (eyebrows) ni numeración decorativa 01/02/03. Columnas de la portada, iconos de
perfil y alas de elo se conservan tal cual.

## Tokens (fuente única: `:root` en `src/app/globals.css`)

- Fondo `#0b0e13`; superficies `#10141b` / `#12171f` / `#161c25` / `#1c2330` (escalones de tono).
- Texto `#eceff4`; secundario `#a3adbd` (≥6,9:1 en todas las superficies); línea `#232b37`;
  borde de control `#606e84` (≥3:1 en todas las superficies).
- Acento hueso `#ecdcb8` solo para cromo: acción primaria, foco, ubicación actual. Nunca dato.
- Victoria azul `#5aa2ff` y derrota roja `#ff6672`, la convención de League; distinguibles
  con daltonismo rojo-verde. Aviso/demo ámbar `#ffb547`.
- Tiers: Iron `#b9aba1`, Bronze `#e8915a`, Silver `#b8c8dc`, Gold `#ffd84a`, Platinum `#3ad9c8`,
  Emerald `#45e083`, Diamond `#72a6ff`, Master `#d07cff`, Grandmaster `#f86056`,
  Challenger `#fff0a8`; siempre junto al nombre del tier.
- Emblemas de logros (`--emblem-*`): recuperación `#29d6f2`, racha `#ffb64b`, maestría `#37e4a6`,
  cada uno con su fondo oscuro (icono ≥7,7:1 sobre él). Solo en el emblema, nunca en texto.
- Recompensa latón `--reward` `#e6c27a` (10,9:1 sobre superficie): exclusiva del Salón de la Fama.
  Distinta del ámbar de aviso/Demo y del oro del tier Gold.
- Radio 2 px. Sin sombras en reposo; solo flotan popovers, diálogos y barras fijas.
- Espaciado: 4 / 8 / 12 / 16 / 24 / 32 / 40 / 48 px. Ancho máximo 1360 px.
- Capas: `--z-sticky` 20, `--z-header` 40, `--z-popover` 60; cabecera fija de 60 px.

## Tipografía

Barlow Condensed semibold para títulos, posiciones, LP y estratos; Barlow regular/semibold
para texto, identidades y navegación. Fuentes locales con sus licencias OFL.
Escala: título de página `clamp(52px … 104px)` con tracking −0,02 em; LP del perfil hasta
104 px; 44 / 28 / 20 px para cifras y secciones; 15 px contenido; 13 px metadatos;
12 px mínimo. Etiquetas en tipo oración, sin mayúsculas espaciadas diminutas. Números
tabulares y lining (`tnum`, `lnum`).

## Movimiento

Solo `transform` y `opacity`, curva `cubic-bezier(0.23, 1, 0.32, 1)`, 120–180 ms.
Respuesta al pulsar (`scale(0.97)`), subrayados de navegación y pestañas al pasar el puntero
(solo con puntero fino), popovers que crecen desde su disparador y un único momento propio:
la distribución por tier se asienta una vez al cargar (≈0,6 s, las etiquetas no se mueven).
Con `prefers-reduced-motion` se conservan color y opacidad y desaparece el desplazamiento.

## Lenguaje de componentes

- RankEmblem: artwork completo de `rank_icon`, con alas propias de cada tier y viewport
  ajustado a sus márgenes transparentes. RankDisplay conserva nombre y división visibles.
  El color refuerza, nunca sustituye, el texto. Fallback neutro para Unranked y assets ausentes.
- LPDisplay: valor dominante y unidad pequeña; guion cuando no corresponde.
- PlayerIdentity: icono cuadrado, nombre, tag, región y frescura secundaria.
- RecentChampionForm: cinco retratos de campeón, más reciente a la izquierda;
  borde semántico y marcas ✓/×, con campeón y resultado accesibles.
- ChampionIdentity: retrato y nombre juntos, tamaños constantes, fallback de iniciales.
- QueueTabs: SoloQ / Flex / 5v5 en display con detalle en tipo oración; la seleccionada
  lleva una regla hueso inferior de 3 px. Sin numeración 01/02/03.
- TierDistribution y estratos: una barra por tier presente, ancha según su parte de los
  jugadores visibles; con orden oficial enlaza a su estrato. 5v5 no tiene ni barra ni estratos.
- PageHeading: título grande, frase de entrada y línea de contexto debajo (nunca una ceja
  encima) y cifras o un panel lateral opcionales. Lo usan portada, Rivalidades, el duelo
  compartido, Métricas, Logros y el Salón de la Fama.
- Duelo de clasificación (Rivalidades): una franja por duelo; cada mitad lleva el tier de su
  jugador y los LP se enfrentan a través de la ventaja central. Sin LP comparables se muestra
  el texto, nunca una cifra. La rivalidad de la semana encabeza la lista. Proximidad en el
  ranking, no partidas entre ambos jugadores.
- Métricas: cabecera con las cifras del período y el aviso de historial parcial; cola y
  período bajo ella; la distribución compartida enlaza cada tier a su estrato del ranking.
  Después, marcadores con costuras de 1 px: líderes y comunidad (el líder ranked teñido con
  su tier), honor y vergüenza, forma y tendencia, actividad y campeones. Sin franjas de color.
- Logros: cabecera compartida con el selector de perfil a su derecha (casos Demo o ID público)
  y la etiqueta Experimental en la línea de contexto; pestañas SoloQ / Flex. Cada desafío es una
  fila del mismo tablero con costuras de 1 px: emblema (encendido solo si la condición se
  observó), categoría y Experimental, umbral leído de las constantes de la regla, evaluación con
  icono y texto, evidencia registrada y requisitos plegados. Sin insignias concedidas, sin
  progreso inventado. La vitrina del perfil reutiliza el emblema compacto, sin franja lateral.
- Salón de la Fama: cabecera compartida con un único aviso sobrio a su derecha (propuestas sin
  acreditación real y, en Demo, el carácter ficticio). Las tres insignias originales cuelgan como
  placas de un mismo tablero; la legendaria, más ancha, lleva filete latón y su nombre en latón.
  Después, el cuadro de honor de nombres (el enlazado desde un perfil se enmarca al llegar) y los
  récords: el vigente con filete latón, los antiguos titulares siguen en el tablero. Sin cejas,
  sin trofeos genéricos, sin franjas de color.
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
