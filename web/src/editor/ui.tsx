import { useEffect, useRef, useState, type ReactNode } from "react";
import { lang, t } from "../lib/i18n";

/** 단축키 표시 — 맥은 ⌘, 그 밖은 Ctrl+ */
export const MOD = typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.userAgent) ? "⌘" : "Ctrl+";

export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: [T, string][]; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map(([key, text]) => (
        <button key={key} type="button" role="tab" className="tab" aria-selected={value === key} onClick={() => onChange(key)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Menu({ label, children, align = "right", className = "btn" }: { label: ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button type="button" className={className} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {label}
      </button>
      {open && (
        <div className={`menu-pop ${align === "left" ? "left" : ""}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", esc);
    const first = ref.current?.querySelector<HTMLElement>("textarea, input, select, button.primary");
    first?.focus();
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header>
          <h2>{title}</h2>
          <button type="button" className="btn quiet" onClick={onClose} aria-label={t("닫기")}>
            {t("닫기")}
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 때 표시 — 오늘이면 "오늘 09:30", 아니면 "2026.11.13 09:30"(영어: "Today 09:30", "Nov 13, 2026 09:30"). */
export function when(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  const sameDay = new Date().toDateString() === d.toDateString();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay) return t("오늘 {time}", { time });
  return lang === "en" ? `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${time}` : `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${time}`;
}
