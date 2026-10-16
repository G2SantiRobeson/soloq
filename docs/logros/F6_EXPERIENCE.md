# F6.1–F6.3 — Experiencia local de logros

Base local de staging: 2dbd13a32b58676adf5e70afdbdbe0c34722b92a. No se consultó el remoto.
F5 está respaldada mediante un bundle verificado, fuera de los worktrees; su centrado pendiente se conserva.

## Catálogo existente

Tres reglas observation_only: Resurrección (caída ≥50 LP y recuperación ≤30 días desde la observación previa; snapshots comparables y huecos ≤7 días), Racha imparable (≥5 victorias registradas por modalidad) y OTP (≥50 partidas válidas y ≥65 %, 13/20, del mismo campeón).
Categorías existentes: progression, performance y champion. Se muestran como Evolución, Rendimiento y Campeones.
El catálogo usa las condiciones originales y la versión calculada del motor. No se cambiaron umbrales, validaciones ni algoritmos.
OTP certificado es el nombre histórico del catálogo, no una certificación. La UI conserva «OTP · muestra importada».
El Salón de Honor es un reconocimiento comparativo separado. La previsualización de títulos y los conceptos futuros no son insignias activas ni se añadieron al catálogo.

## Experiencia

/logros: catálogo público de reglas, consulta de un perfil por modalidad y requisitos/evidencia desplegables.
Sin selección: no hay lectura del motor. Perfil seleccionado: reutiliza profileAchievementPresentation.
Vitrina compacta del perfil: solo condiciones observadas; comparte la misma promesa que el panel y el destacado OTP.
Estados separados: condición observada, no observado, datos insuficientes, datos inválidos, lectura no disponible, desactivado y no aplicable a 5v5.
No se conceden, certifican, equipan ni persisten insignias. No hay barras de progreso inventadas.

## Demo y flag

El flag ACHIEVEMENTS_EXPERIMENTAL conserva su gate: solo desarrollo local o Preview; Production queda desactivada incluso con true.
La Demo local puede activar ese flag solo en su proceso de desarrollo. No se modifican archivos .env ni variables remotas.
Casos: Demo Marea tiene dos condiciones observadas; Demo Ronin una; Demo Eclipse no tiene historial suficiente. Se evaluaron con el motor real y los mismos registros de sus perfiles.
Los runs ficticios de cinco victorias están escritos en las partidas Demo; no se alteran LP ni se reconstruye rango desde Match-V5.

## Infraestructura y evolución pendiente

El catálogo no necesita base de datos. Fuera de Demo, la consulta utiliza el lector consistente existente con sus SELECT de jugadores, snapshots y partidas. No añade esquema ni grants; su uso real depende de la futura configuración runtime P4.4.D.
La acreditación permanente, títulos equipables o preferencias públicas necesitan diseño/autorización posterior; los resultados actuales grantAuthorized=false no permiten implementarlas como presentación.
No se accedió a Neon, Riot operacional ni Vercel.
Recursos propuestos para más adelante: medalla de recuperación, llama de racha y emblema de campeón. Por ahora se usan Lucide y assets locales existentes.

## Arranque local aislado

Desde este worktree: `node scripts/dev-achievements-demo.mjs`. Puerto 3002, solo loopback; aborta si existe un archivo .env operativo. Limpia credenciales heredadas del proceso y bloquea conexiones externas (incluido DDragon); los assets locales y fallback existentes siguen disponibles. No cambia ningún archivo de entorno. Ctrl+C detiene el servidor.

## Validación final

1411 tests aprobados; 69 PostgreSQL opt-in omitidos por configuración existente; cero fallidos. Lint, typecheck y npm run build Demo aislado pasaron, con 43 checks HTTP (40 anteriores +3 del centro desactivado en Production). Revisión real a 1440/390 px: categorías, 2/1/0 señales, estado insuficiente, cambio SoloQ/Flex conservando jugador, perfil vacío, disclosure por teclado, foco visible y ausencia de overflow/errores. Capturas locales en artifacts/f6-*.png.

Git autocrlf introdujo CRLF en el nuevo checkout: se repusieron solo los bytes originales de drizzle desde HEAD, sin cambiar SQL ni metadata. .gitattributes conserva esos bytes en futuros checkouts. next-env.d.ts es generado por Next dev; no es parte funcional propuesta.

## F6.2 — Rediseño visual

Cabecera «Deja tu marca en la Grieta», perfil/modalidad visibles y aviso experimental breve. Galería de las mismas tres reglas: Resurrección cian, Racha imparable dorado y OTP esmeralda. Emblemas temporales Lucide/CSS comparten un slot con la vitrina; no son premios concedidos ni assets de Riot.

Requisitos exactos, estado, razones, evidencia, cobertura y versiones siguen en details nativos, cerrados inicialmente. Las métricas son las cadenas originales del motor: no hay porcentajes de desbloqueo ni progreso reconstruido. Método y límites se despliegan al final. La vitrina conserva nombres, copy breve, estado observado y Demo, sin ocultar contenido a 320 px.

Componentes: achievement-catalog.tsx, achievement-showcase.tsx, nuevo achievement-emblem.tsx, experience.module.css y página /logros. Se adaptó el check de texto del harness Demo y se añadieron ocho tests en achievements-gallery.test.tsx. Catálogo/reglas/umbrales, fixtures y lectores de servidor intactos.

1419 tests aprobados, 69 PostgreSQL opt-in omitidos, cero fallidos. Navegador real en 1920/1440/390/320 px: tres columnas en escritorio, apilado en móvil, foco/teclado, requisitos y método accesibles, cambio de perfil/modalidad preservado, 2/1/0 señales Demo, sin overflow ni errores de hidratación. Vitrina: 156/156/184/238 px aproximadamente. Capturas y bounding boxes en artifacts/f62-*.png y f62-visual-checks.json.

No se conceden ni equipan insignias. No hay nuevos datos, gráficos raster o dependencias. Emblemas originales futuros sugeridos: fénix de recuperación, llama de racha y sello de especialización; requieren una decisión visual posterior del usuario.

Lint, typecheck y build Demo finales: PASS. Las 43 comprobaciones HTTP también pasaron sobre la versión final. F5 y P4.4.D conservan HEAD, estado y archivos pendientes; los 13 hashes protegidos coinciden. Sin commit, integración ni publicación.
