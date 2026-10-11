# Release Candidate de Logros A+B+C+D

Operaciones **futuras y autorizadas**. Esta guía no autoriza push, deployment, configuración Vercel ni activación. Apagado por defecto; sin migración.

## Preparación

- [ ] staging y working tree revisados; CLAUDE.md, .claude/, .env.local preservados.
- [ ] Fetch y origin/staging esperado `e65716b985f2d64b4d5190d79674d38ab1bb34e7`, sin divergencias.
- [ ] A `dc2ed6df20404815b9ada9d166a8c3d161432b03`, B `e4d2bbe4b3755aa109d10086e7041d6ff2305241`, C `bf919ad720e626c16d7953b724e7281d45bb69fe`, D de esta entrega, en orden. Registrar SHA final D.
- [ ] Node soportado (24.19.0 probado); lint, typecheck, suite y build para ese HEAD.
- [ ] Suite 715/4 con PostgreSQL local opt-in; sin él seis MVCC adicionales omitidos. No confundir omission con aprobación.
- [ ] Revisar [hardening y benchmarks](HARDENING.md), reglas/evidencias sin cambios.
- [ ] Sin esquema/migración/secretos/archivos protegidos/QA temporal/fixtures públicos en el commit.
- [ ] ACHIEVEMENTS_EXPERIMENTAL ausente/apagado en Preview. No NEXT_PUBLIC ni variable cliente.
- [ ] Production sigue main, DEMO_MODE=true y guard que rechaza accidental true, sin PostgreSQL/Riot.

## Publicación Staging — requiere autorización

- [ ] Obtener autorización explícita para publicar SHA D; no implica activar.
- [ ] Fetch; ancestry/lista A+B+C+D y fast-forward; detenerse ante cambios inesperados.
- [ ] `git push origin HEAD:staging` únicamente, sin force/main/commits adicionales.
- [ ] Confirmar SHA remoto y ramas sincronizadas; archivos protegidos intactos.
- [ ] Esperar Preview automático; comprobar SHA desplegado exacto y READY. Push no valida deployment.
- [ ] Acceder por Vercel Authentication autorizada; sin bypass ni redeploy manual no autorizado.
- [ ] Confirmar flag ausente/apagado sin revelar secretos.
- [ ] Sin sección/fallback/trabajo/SELECT de logros; distinguir consultas normales de perfil. Instrumentación temporal o logs sanitizados solo si autorizados, no inferirlo de la latencia.
- [ ] SHA/deployment/configuración Production intactos.

## QA Preview apagado

- [ ] Perfil real autorizado SoloQ/Flex: rango/verificación, cobertura reciente/histórica, stats, pool, Firma, ΔLP.
- [ ] 5v5 conserva su ámbito, sin mezclar logros ranked.
- [ ] Gráficas, historial inicial cinco/navegación, remakes, móvil, teclado y tooltips.
- [ ] Metadata/leaderboard intactos; sin sección, espacio, tarjetas ni skeleton añadido.
- [ ] Missing/pausado, vacío/parcial, errores anteriores y Demo como antes.
- [ ] Variables de sistema identifican Preview/Production; desconocido falla cerrado. No activar en Production para probarlo.

## Activación posterior y separada

- [ ] Revisar riesgos técnicos de HARDENING.md y reglas provisionales con el propietario.
- [ ] Autorización explícita de flag/deployment Preview; nunca main/Production.
- [ ] Solo entonces configurar ACHIEVEMENTS_EXPERIMENTAL=true exacto en Preview/staging y realizar deployment controlado si hace falta aplicar configuración.
- [ ] SHA/READY y VERCEL=1, ENV=preview, target ausente/preview; Production siempre rechazado.
- [ ] Perfil real autorizado: cuatro estados, evidencia/muestras/fechas regionales/cobertura/reglas. observed no es unlocked/granted/certified/equipped.
- [ ] 5v5/missing/off sin trabajo; Demo sin DB; error PostgreSQL neutro y resto del perfil conservado.
- [ ] Permisos/RLS/fotografía coherente bajo sincronización con rol real y consultas autorizadas/sanitizadas. Tests locales no acreditan pooling/RLS de Neon.
- [ ] Medir latencia/pool/filas/CPU/memoria/concurrencia y perfiles grandes. Sin extrapolar benchmark, porcentaje o ETA ficticio.
- [ ] Responsive, teclado, foco, lector y zoom real 200 %. Axe no certifica accesibilidad total.
- [ ] Sin grants ni persistencia; restricciones conservadas en motor/DTO/UI.
- [ ] Ante anomalía, mantener o volver a off y detener experimento.

## Rollback — con autorización

1. Quitar flag o poner false solo en Preview; deployment autorizado para aplicar la configuración cuando sea necesario.
2. Confirmar READY/SHA, sección/trabajo/SELECT adicionales ausentes, perfil esencial correcto.
3. Si el código causa regresión aun apagado, restaurar Preview previamente validado según procedimiento aprobado; no reescribir Git ni promover main.
4. Error PostgreSQL: registrar solo fase/tipo sanitizados. No eliminar jugadores/cursores/partidas/snapshots ni grants (no existen).
5. Confirmar Production/SHA/configuración intactos. Sin migración ni rollback DB para este módulo.

## Producto pendiente

Umbrales Resurrección/Imparable/OTP, certificación/evidencia para conceder, permanencia, versionado/invalidación, temporadas, títulos seleccionables, rarezas y leaderboard. Este checklist técnico no los aprueba ni concede premios.
