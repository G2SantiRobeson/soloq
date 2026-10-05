import Link from "next/link";
import { isDemo } from "@/server/env";
export function Header() {
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href="/" className="brand" aria-label="SoloQ, inicio">
          SOLO<span className="accent">Q</span>
          <span className="brand-slash" aria-hidden="true">
            /
          </span>
        </Link>
        <nav aria-label="Principal">
          <Link href="/" className="nav-link">
            Clasificación
          </Link>
          <span className="header-divider" />
          <span className="header-caption">LEAGUE OF LEGENDS</span>
        </nav>
        <span className="header-caption header-end">RANK. PLAY. REPEAT.</span>
      </div>
    </header>
  );
}
export function DemoBanner() {
  return isDemo() ? (
    <div className="demo-banner">
      <span className="demo-pill">DEMO</span> Estás viendo jugadores y estadísticas ficticios.{" "}
    </div>
  ) : null;
}
export function Footer() {
  return (
    <footer className="site-footer container">
      <div className="footer-top">
        <Link href="/" className="brand small-brand">
          SOLOQ /
        </Link>
        <span>League of Legends · Community ladder</span>
        <div>
          <Link href="/admin">Administración</Link>
          <Link href="/privacy">Privacidad</Link>
          <Link href="/terms">Términos</Link>
        </div>
      </div>
      <p>
        SoloQ isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or opinions of
        Riot Games or anyone officially involved in producing or managing Riot Games properties.
        Riot Games, and all associated properties are trademarks or registered trademarks of Riot
        Games, Inc.
      </p>
    </footer>
  );
}
