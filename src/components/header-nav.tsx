"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Clasificación", matches: (path: string) => path === "/" },
  { href: "/metrics", label: "Métricas", matches: (path: string) => path.startsWith("/metrics") },
] as const;

export function HeaderNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Principal" className="header-nav">
      {LINKS.map(({ href, label, matches }) => (
        <Link
          key={href}
          href={href}
          className="nav-link"
          aria-current={matches(pathname) ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
