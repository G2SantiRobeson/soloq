# Íconos de campeones

Fuente principal de los retratos de campeón. Naming: `<championId>.png`, usando el
ID numérico de Riot. Hay 173 PNG de 128 × 128 px.

Inventario completo respecto del catálogo Data Dragon 16.19.1 (173 campeones).
Los cuatro archivos antes pendientes ya están incorporados y sincronizados:

| Campeón    | Archivo   |
| ---------- | --------- |
| Cassiopeia | `69.png`  |
| Gangplank  | `41.png`  |
| Warwick    | `19.png`  |
| Xerath     | `101.png` |

Agregar los archivos aquí y ejecutar `npm run icons:sync`, o reiniciar `npm run dev`.
`npm run build` también los sincroniza automáticamente. No editar a mano el manifiesto
`src/lib/champion-icons.generated.ts` ni las copias de `public/champ-icons`.

La utilidad `championAsset` resuelve archivo local → Data Dragon → iniciales.
Los archivos ausentes no impiden renderizar una partida o un campeón.
