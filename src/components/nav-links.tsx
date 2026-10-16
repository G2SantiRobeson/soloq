/** Primary destinations, shared by the client nav and its server fallback so both render alike. */
export const NAV_LINKS = [
  { href: "/", label: "Clasificación" },
  { href: "/metrics", label: "Métricas" },
  { href: "/logros", label: "Logros" },
  { href: "/salon-de-la-fama", label: "Salón de la Fama", short: "Salón" },
  { href: "/rivalidades", label: "Rivalidades" },
] as const satisfies readonly { href: string; label: string; short?: string }[];

export type NavLink = (typeof NAV_LINKS)[number];

/**
 * Narrow screens show the short label. The link keeps the full label as its accessible name
 * (it contains the visible short one), so assistive technology always hears the destination.
 */
export function navLinkContent(link: NavLink) {
  if (!("short" in link)) return { label: undefined, content: link.label };
  return {
    label: link.label,
    content: (
      <>
        <span className="nav-label-full">{link.label}</span>
        <span className="nav-label-short" aria-hidden="true">
          {link.short}
        </span>
      </>
    ),
  };
}
