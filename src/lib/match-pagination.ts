export const MATCH_SUMMARY_SIZE = 5;
export const MATCH_PAGE_SIZE = 10;

export function matchPage<T>(matches: readonly T[], expanded: boolean, requestedPage = 0) {
  const pages = Math.max(1, Math.ceil(matches.length / MATCH_PAGE_SIZE));
  const page = expanded ? Math.min(pages - 1, Math.max(0, Math.trunc(requestedPage) || 0)) : 0;
  const start = expanded ? page * MATCH_PAGE_SIZE : 0;
  const items = matches.slice(start, start + (expanded ? MATCH_PAGE_SIZE : MATCH_SUMMARY_SIZE));
  return { items, page, pages, start, end: start + items.length };
}
