"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";

/**
 * Toggletip: a real button whose explanation is visible on hover, keyboard focus,
 * click or tap, and is announced through a status region. Escape or a tap outside
 * closes it; the bubble can be hovered without disappearing (WCAG 1.4.13).
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
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
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
          pinned.current = true;
          setOpen(true);
        }}
      >
        {term ?? <Info size={14} aria-hidden="true" />}
      </button>
      <span role="status" id={id} className="info-tip-bubble" data-align={align} hidden={!open}>
        {open && children}
      </span>
    </span>
  );
}
