"use client";
import Link from "next/link";
import { ladderQuery, parseLadderFilters } from "@/lib/ladder-filters";
import { parseView } from "@/lib/queues";
import { useSearchParams, usePathname } from "next/navigation";
import { NAV_LINKS, navLinkContent } from "./nav-links";

const MATCHES: Record<(typeof NAV_LINKS)[number]["href"], (path: string) => boolean> = {
  "/": (path) => path === "/",
  "/metrics": (path) => path.startsWith("/metrics"),
  "/logros": (path) => path.startsWith("/logros"),
  "/salon-de-la-fama": (path) => path.startsWith("/salon-de-la-fama"),
  "/rivalidades": (path) => path.startsWith("/rivalidades") || path.startsWith("/rivalidad/"),
};

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
      {NAV_LINKS.map((link) => {
        const { label, content } = navLinkContent(link);
        return (
          <Link
            key={link.href}
            href={navigationHref(link.href)}
            prefetch={link.href === "/rivalidades" ? false : undefined}
            className="nav-link"
            aria-label={label}
            aria-current={MATCHES[link.href](pathname) ? "page" : undefined}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
