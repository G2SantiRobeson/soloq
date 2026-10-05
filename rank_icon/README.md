# Emblemas ranked completos

Los diez archivos `Rank=<Tier>.png` son imágenes RGBA de 1000 × 1000 px con el emblema
central y ornamentación lateral ya integrados. Se muestran junto al texto de la columna Rango.
Cada tier conserva su propia silueta: Iron, Bronze, Silver, Gold, Platinum, Emerald,
Diamond, Master, Grandmaster y Challenger.

`npm run ranks:sync` copia los PNG sin modificar sus bytes a `public/rank-icons` y genera
el único mapping `src/lib/rank-assets.generated.ts`. También se ejecuta antes de dev/build.
El script inspecciona el canal alfa con Sharp (incluido con Next.js): calcula un viewport
cuadrado centrado con 8% de margen alrededor de todos los píxeles visibles. RankEmblem
usa ese viewBox para compensar padding transparente; no recorta ni dibuja ornamentación.

`RankEmblem` acepta tier, tamaño, variante full/compact y modo decorativo. Como no hay
versiones centrales separadas, compact reduce proporcionalmente el emblema completo.
Unranked, tier desconocido, archivo ausente o error de carga usan un guion neutro; el
nombre del rango permanece visible en RankDisplay. No se inventa arte de rangos.

Los diez archivos de `Wings/` son marcos específicos para el avatar del jugador, distintos
del emblema del tier. `Grand.png` corresponde a Grandmaster. `RankAvatar` superpone el
avatar circular en la abertura del marco, conserva la joya inferior y todas las alas.
El mapping y las coordenadas de composición se generan en el mismo archivo central.
Sin rango, tier desconocido o error de carga del marco se conserva el avatar sencillo.
`Tier Wings/` contiene alternativas para siete tiers; se usa `Wings/` para los diez,
siguiendo el asset indicado y evitando mezclar estilos. Los originales no se modifican.
Las copias web de Wings omiten únicamente los bloques de texto de Photoshop (unos
20 MB por archivo); los píxeles comprimidos, alfa y perfil de color permanecen intactos.

La revisión `/dev/emblems` muestra los diez marcos con avatar, los emblemas a 112, 64 y 26 px, fallbacks y filas demo.
Solo se sirve en desarrollo; devuelve 404 en producción y no consulta cuentas reales.
