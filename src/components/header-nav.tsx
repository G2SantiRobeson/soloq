"use client";
import Link from "next/link";
import { ladderQuery, parseLadderFilters } from "@/lib/ladder-filters";
import { parseView } from "@/lib/queues";
import { useSearchParams, usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Clasificación", matches: (path: string) => path === "/" },
  { href: "/metrics", label: "Métricas", matches: (path: string) => path.startsWith("/metrics") },
  { href: "/logros", label: "Logros", matches: (path: string) => path.startsWith("/logros") },
  {
    href: "/salon-de-la-fama",
    label: "Salón de la Fama",
    matches: (path: string) => path.startsWith("/salon-de-la-fama"),
  },
  {
    href: "/rivalidades",
    label: "Rivalidades",
    matches: (p: string) => p.startsWith("/rivalidades") || p.startsWith("/rivalidad/"),
  },
] as const;

export function HeaderNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = Object.fromEntries(searchParams.entries());
  const view = parseView(query.queue);
  const navigationHref = (path: string) =>
    !searchParams.has("queue")
      ? path
      : path === "/" || path === "/rivalidades"
        ? path + ladderQuery(view, parseLadderFilters(view, query))
        : path + "?queue=" + view;
  return (
    <nav aria-label="Principal" className="header-nav">
      {LINKS.map(({ href, label, matches }) => (
        <Link
          key={href}
          href={navigationHref(href)}
          prefetch={href === "/rivalidades" ? false : undefined}
          className="nav-link"
          aria-current={matches(pathname) ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
