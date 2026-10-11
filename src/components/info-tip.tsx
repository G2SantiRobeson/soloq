"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";

const VIEWPORT_MARGIN = 8;

/** Horizontal shift that keeps a bubble inside the viewport (0 when it already fits). */
export function viewportShift(left: number, right: number, viewport: number): number {
  if (right - left > viewport - 2 * VIEWPORT_MARGIN) return VIEWPORT_MARGIN - left;
  if (left < VIEWPORT_MARGIN) return VIEWPORT_MARGIN - left;
  if (right > viewport - VIEWPORT_MARGIN) return viewport - VIEWPORT_MARGIN - right;
  return 0;
}

/**
 * Toggletip: a real button whose explanation is visible on hover, keyboard focus,
 * click or tap, and is announced through a status region. Escape, a tap outside or a
 * second click/tap on a pinned tip closes it; the bubble can be hovered without
 * disappearing (WCAG 1.4.13) and is nudged back inside the viewport when it overflows.
 * Without `term`, the trigger is an "i" icon; with `term`, the term itself is the
 * trigger (named by the term), so table headers keep their width.
 */
export function InfoTip({
  label,
  children,
  term,
  align = "end",
}: {
  children: ReactNode;
  align?: "start" | "end";
} & ({ label: string; term?: undefined } | { term: ReactNode; label?: undefined })) {
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  useLayoutEffect(() => {
    const node = bubble.current;
    if (!open || !node) return;
    node.style.translate = "";
    const { left, right } = node.getBoundingClientRect();
    const shift = viewportShift(left, right, document.documentElement.clientWidth);
    if (shift) node.style.translate = `${shift}px 0`;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = () => {
      pinned.current = false;
      setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span
      ref={root}
      className={`info-tip ${term ? "info-tip-term" : ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!pinned.current) setOpen(false);
      }}
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node | null)) {
          pinned.current = false;
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="info-tip-button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={term ? undefined : label}
        onFocus={() => setOpen(true)}
        onClick={() => {
          // A pinned tip toggles closed; hover/focus-opened tips become pinned first.
          const close = pinned.current && open;
          pinned.current = !close;
          setOpen(!close);
        }}
      >
        {term ?? <Info size={14} aria-hidden="true" />}
      </button>
      <span
        ref={bubble}
        role="status"
        id={id}
        className="info-tip-bubble"
        data-align={align}
        hidden={!open}
      >
        {open && children}
      </span>
    </span>
  );
}
