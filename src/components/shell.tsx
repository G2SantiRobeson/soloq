import Link from "next/link";
import { isDemo } from "@/server/env";
import { Suspense } from "react";
import { HeaderNav } from "./header-nav";
import { NAV_LINKS, navLinkContent } from "./nav-links";
export function Header() {
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href="/" className="brand" aria-label="SoloQ, inicio">
          SOLO<span className="brand-q">Q</span>
        </Link>
        <Suspense
          fallback={
            <nav className="header-nav" aria-label="Principal">
              {NAV_LINKS.map((link) => {
                const { label, content } = navLinkContent(link);
                return (
                  <Link key={link.href} href={link.href} className="nav-link" aria-label={label}>
                    {content}
                  </Link>
                );
              })}
            </nav>
          }
        >
          <HeaderNav />
        </Suspense>
      </div>
    </header>
  );
}
export function DemoBanner() {
  return isDemo() ? (
    <div className="demo-banner">
      <div className="container demo-banner-inner">
        <span className="demo-pill">Demo</span>
        <span>
          Jugadores, partidas, rangos y LP ficticios. No son datos reales de Riot ni se sincronizan
          cuentas.
        </span>
      </div>
    </div>
  ) : null;
}
export function Footer() {
  return (
    <footer className="site-footer container">
      <div className="footer-top">
        <Link href="/" className="brand small-brand" aria-label="SoloQ, inicio">
          SOLO<span className="brand-q">Q</span>
        </Link>
        <span>League of Legends · Clasificación de la comunidad</span>
        <nav aria-label="Pie de página">
          <Link href="/admin">Administración</Link>
          <Link href="/privacy">Privacidad</Link>
          <Link href="/terms">Términos</Link>
          <a href="mailto:drg1212yt@gmail.com">Contacto · Yuusha1</a>
        </nav>
      </div>
      <p lang="en">
        SoloQ isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or opinions of
        Riot Games or anyone officially involved in producing or managing Riot Games properties.
        Riot Games, and all associated properties are trademarks or registered trademarks of Riot
        Games, Inc.
      </p>
    </footer>
  );
}
