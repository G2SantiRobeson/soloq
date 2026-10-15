import Link from "next/link";
import Image from "next/image";
import { hallEmblemAsset } from "@/lib/hall-of-fame/emblems";
import { Shield, Trophy, ChevronDown, History } from "lucide-react";
import { HALL_PROPOSALS } from "@/lib/hall-of-fame/proposals";
import { readHallPreview } from "@/server/hall-of-fame/demo";
import type { View } from "@/lib/queues";
import styles from "./hall.module.css";
export function HallEmblem({ id, small = false }: { id: string; small?: boolean }) {
  const asset = hallEmblemAsset(id);
  return (
    <span
      className={small ? styles.smallEmblem : styles.emblem}
      aria-hidden="true"
      data-emblem={id}
    >
      {asset ? (
        <Image src={asset.src} width={asset.width} height={asset.height} alt="" unoptimized />
      ) : (
        <Shield strokeWidth={1.4} />
      )}
    </span>
  );
}
const date = (value: string) =>
  new Date(value).toLocaleString("es-CL", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }) + " UTC";
export function HallOfFame({ view }: { view: View }) {
  const data = readHallPreview(view);
  return (
    <>
      <section className={styles.hero}>
        <div>
          <span className="eyebrow">EL LEGADO DE LA COMUNIDAD</span>
          <h1>
            Salón de la <span>Fama.</span>
          </h1>
          <p>Las hazañas pasan. Los nombres permanecen.</p>
          <Link href={`/logros?queue=${view}`}>← Explorar desafíos experimentales</Link>
        </div>
        <Trophy className={styles.heroTrophy} aria-hidden="true" strokeWidth={1} />
      </section>
      <p className={styles.notice}>
        Propuestas · acreditación real todavía no disponible. Ningún reconocimiento se concede desde
        esta página.
      </p>
      <nav className={styles.modeNav} aria-label="Modalidad del Salón de la Fama">
        {(["soloq", "flex"] as const).map((q) => (
          <Link
            key={q}
            href={`/salon-de-la-fama?queue=${q}`}
            aria-current={view === q ? "page" : undefined}
          >
            {q === "soloq" ? "SoloQ" : "Flex"}
          </Link>
        ))}
      </nav>
      {data.demo && (
        <p className={styles.demoNotice}>
          Ficticio · Demo. Nombres, hazañas, fechas y récords simulados. Escenarios independientes
          de las partidas y señales experimentales de los perfiles.
        </p>
      )}
      <section aria-labelledby="hall-concepts">
        <header className={styles.sectionHeading}>
          <div>
            <span className={styles.overline}>EL PRÓXIMO CAPÍTULO</span>
            <h2 id="hall-concepts">Hazañas que dejarían historia</h2>
          </div>
          <span>Rareza real: todavía no disponible</span>
        </header>
        <ul className={styles.gallery}>
          {HALL_PROPOSALS.map((proposal) => (
            <li
              className={styles.proposal}
              key={proposal.id}
              data-category={proposal.category}
              data-proposal={proposal.id}
            >
              <HallEmblem id={proposal.id} />
              <div className={styles.proposalBody}>
                <span className={styles.overline}>{proposal.categoryName} · propuesta</span>
                <h3>{proposal.name}</h3>
                <p>{proposal.description}</p>
                <span className={styles.proposalState}>
                  {data.recognitions.some((r) => r.proposalId === proposal.id)
                    ? "Caso simulado disponible · Demo"
                    : "Sin acreditación disponible"}
                </span>
                <details className={styles.details}>
                  <summary>
                    Ver propuesta y requisitos <ChevronDown size={16} aria-hidden="true" />
                  </summary>
                  <dl>
                    <div>
                      <dt>Requisito conceptual</dt>
                      <dd>{proposal.requirement}</dd>
                    </div>
                    <div>
                      <dt>Evidencia necesaria</dt>
                      <dd>{proposal.evidence}</dd>
                    </div>
                    <div>
                      <dt>Límites de cobertura</dt>
                      <dd>{proposal.coverage}</dd>
                    </div>
                    <div>
                      <dt>Verificabilidad actual</dt>
                      <dd>{proposal.feasibility}</dd>
                    </div>
                    <div>
                      <dt>Infraestructura pendiente</dt>
                      <dd>{proposal.infrastructure}</dd>
                    </div>
                  </dl>
                  <p>
                    Identificador: {proposal.id} · {proposal.version}. No es una regla activa ni un
                    umbral definitivo.
                  </p>
                </details>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className={styles.legacy} aria-labelledby="hall-legacy">
        <header className={styles.sectionHeading}>
          <div>
            <span className={styles.overline}>HISTORIAL PERSONAL</span>
            <h2 id="hall-legacy">
              Nombres del legado {data.demo && <small>Ficticio · Demo</small>}
            </h2>
          </div>
        </header>
        {data.recognitions.length ? (
          <ul className={styles.recognitions}>
            {data.recognitions.map((r) => (
              <li key={r.id} id={`reconocimiento-${r.id}`} data-source={r.source}>
                <HallEmblem id={r.proposalId} small />
                <div>
                  <Link className={styles.player} href={`/player/${r.playerId}?queue=${r.view}`}>
                    {r.playerName} ↗
                  </Link>
                  <h3>{HALL_PROPOSALS.find((p) => p.id === r.proposalId)!.name}</h3>
                  <p>
                    Acreditación simulada · {date(r.accreditedAt)} · {r.season} · SoloQ
                  </p>
                  <details className={styles.details}>
                    <summary>
                      Ver evidencia simulada <ChevronDown size={16} aria-hidden="true" />
                    </summary>
                    <p>{r.evidence}</p>
                    <p>
                      Obtención observada simulada:{" "}
                      {r.observedAt ? date(r.observedAt) : "fecha exacta no establecida"}.
                    </p>
                    <p>
                      Rareza: no calculada. No hay acreditación real ni evidencia operacional
                      asociada.
                    </p>
                  </details>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.empty}>
            <Trophy size={28} aria-hidden="true" />
            <h3>
              {data.demo
                ? "Sin acreditaciones de demostración en esta modalidad"
                : "Todavía no hay acreditaciones disponibles"}
            </h3>
            <p>
              No se infieren premios a partir de las señales experimentales. El registro permanente
              aún no está habilitado.
            </p>
            {data.demo && view !== "soloq" && (
              <Link href="/salon-de-la-fama?queue=soloq">
                Ver los ejemplos ficticios de SoloQ →
              </Link>
            )}
          </div>
        )}
      </section>
      <section className={styles.records} aria-labelledby="hall-records">
        <header className={styles.sectionHeading}>
          <div>
            <span className={styles.overline}>RÉCORDS Y PIONEROS</span>
            <h2 id="hall-records">El trono puede cambiar de manos</h2>
          </div>
          <History size={22} aria-hidden="true" />
        </header>
        <p className={styles.recordNote}>
          Un pionero conserva su acreditación histórica. El poseedor de un récord vigente puede
          cambiar; los antiguos titulares siguen formando parte del historial.
        </p>
        {data.records.length ? (
          <ul>
            {data.records.map((r) => (
              <li key={r.id} data-source={r.source} data-record-state={r.to ? "former" : "current"}>
                <span>
                  {r.to ? "Antiguo poseedor simulado" : "Poseedor vigente simulado"} · Ficticio ·
                  Demo
                </span>
                <Link href={`/player/${r.playerId}?queue=soloq`}>{r.playerName}</Link>
                <strong>{r.value} victorias · racha ficticia SoloQ</strong>
                <p>
                  {date(r.from)} → {r.to ? date(r.to) : "vigente en el guion de Demo"}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>
            Sin récords acreditados disponibles. No se asigna un ganador a partir de datos
            incompletos.
          </p>
        )}
        <p className={styles.recordNote}>
          La comparación de Demo es escenográfica. Perder el récord no eliminaría una hazaña
          histórica válida; revisión e invalidación requieren evidencia y trazabilidad.
        </p>
      </section>
      <details className={styles.details}>
        <summary>
          Qué falta para acreditar estos reconocimientos{" "}
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <p>
          Reglas aprobadas, cobertura demostrable, identidad canónica, registro persistente e
          idempotente, revisión auditada y privacidad. No existe un mecanismo de concesión en esta
          Demo.
        </p>
        <p>
          La rareza necesitará acreditaciones únicas válidas y un denominador de jugadores elegibles
          definido por modalidad, temporada, plataforma, comunidad y versión. Datos insuficientes no
          significan rareza extrema.
        </p>
      </details>
    </>
  );
}
export function HallLegacyShowcase({ playerId, view }: { playerId: string; view: View }) {
  const data = readHallPreview(view);
  if (!data.demo || view === "5v5") return null;
  const rows = data.recognitions.filter((r) => r.playerId === playerId);
  return (
    <section className={styles.showcase} aria-label="Legado personal simulado">
      <header>
        <h2>
          <Trophy size={18} aria-hidden="true" /> Legado personal <small>Ficticio · Demo</small>
        </h2>
        <Link href={`/salon-de-la-fama?queue=${view}`}>Ver Salón de la Fama →</Link>
      </header>
      <p>
        Simulación independiente de las señales experimentales. Sin concesión real ni equipamiento.
      </p>
      {rows.length ? (
        <ul>
          {rows.map((r) => (
            <li key={r.id} data-source={r.source}>
              <HallEmblem id={r.proposalId} small />
              <div>
                <strong>{HALL_PROPOSALS.find((p) => p.id === r.proposalId)!.name}</strong>
                <span>
                  Acreditación simulada · {date(r.accreditedAt)} · {r.season}
                </span>
                <Link href={`/salon-de-la-fama?queue=${view}#reconocimiento-${r.id}`}>
                  Consultar evidencia ficticia →
                </Link>
                <span>Rareza: no calculada</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p>No hay reconocimientos simulados para este perfil y modalidad.</p>
      )}
    </section>
  );
}
