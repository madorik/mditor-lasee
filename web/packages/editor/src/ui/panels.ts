// 도구 막대의 팝업 내용 — 색 · 링크 · 표 크기 · 특수 문자 · 그림 · 정렬.

import { colorCss, INLINE_COLORS, safeHref, SHADE } from "../core/inline";
import { h } from "./dom";
import { icon } from "./icons";
import { fill, type Messages } from "./messages";

// ───────────── 색 ─────────────

// 색 팔레트 — 7칸 × 5줄. 첫 칸("")은 기본 색(색 지우기). 빨강 · 파랑 · 회색 칸은 이름 태그({빨강})로 쓴다.
export const PALETTE: string[][] = [
  ["", "#000000", "#404040", "#7f7f7f", "#a6a6a6", "#d0d0d0", "#ffffff"],
  ["#c00000", "#e36c09", "#c99a06", "#2e8b57", "#1f4e9b", "#7030a0", "#4f6b8a"],
  ["#f4b6b6", "#f9cfa8", "#f2e2a0", "#b5e3c8", "#b4cff0", "#d2c2ee", "#cbd5e1"],
  ["#e06666", "#f39c5a", "#d6b52a", "#6aa84f", "#3d85c6", "#8e7cc3", "#7f9cb5"],
  ["#7f1d1d", "#8a4b1f", "#6b5f12", "#275e2a", "#1c3d6e", "#4b2a85", "#334155"],
];
const HEX6 = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

/** 입력한 색 코드 → #rrggbb(소문자). 틀리면 null. */
export function parseHex(text: string): string | null {
  const m = HEX6.exec(text.trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
  return `#${hex.toLowerCase()}`;
}

/** 색 코드 → 문서에 쓸 태그 이름. 이름 붙은 색과 같으면 그 이름(빨강 · 파랑 · 회색). */
export function colorTag(hex: string): string {
  return Object.entries(INLINE_COLORS).find(([, css]) => css === hex)?.[0] ?? hex;
}

/** 색 단추의 그림 — 글자 아래 막대가 지금 색이다. */
export function colorGlyph(glyph: string, color: string | null, shade: boolean): string {
  const bar = color ? colorCss(color) : "currentColor";
  return `<span class="mde-color-glyph"${shade ? ` style="background:${SHADE}"` : ""}>${glyph}<i style="background:${bar}"></i></span><span class="mde-caret" aria-hidden="true">▾</span>`;
}

export function colorPanel(m: Messages, current: string | null, shade: boolean, canClear: boolean, onColor: (name: string | null) => void, onShade: () => void): HTMLElement {
  const cur = current ? colorCss(current) : null;
  const palette = h("div", { className: "mde-palette", attrs: { role: "group", "aria-label": m.color } });
  for (const hex of PALETTE.flat()) {
    const b = h("button", {
      className: `mde-swatch ${hex === "#ffffff" ? "light" : ""} ${hex ? "" : "none"}`,
      attrs: { type: "button", "data-color": hex, "aria-label": hex || m.defaultColor, title: hex || m.defaultColor, "aria-pressed": hex ? cur === hex : !cur, disabled: !hex && !canClear },
      style: hex ? { background: hex } : {},
      on: { click: () => onColor(hex ? colorTag(hex) : null) },
    });
    palette.append(b);
  }
  const picker = h("input", { attrs: { type: "color", "aria-label": m.pickColor, title: m.pickColor } });
  const text = h("input", { className: "mde-hex", attrs: { type: "text", "aria-label": m.colorCode, maxlength: 7, spellcheck: "false" } });
  const apply = h("button", { className: "mde-btn word primary", text: m.apply, attrs: { type: "submit" } });
  const sync = () => {
    const typed = parseHex(text.value);
    apply.disabled = !typed;
    if (typed) picker.value = typed;
  };
  text.value = cur ?? "#333333";
  picker.value = cur ?? "#333333";
  picker.addEventListener("input", () => ((text.value = picker.value), sync()));
  text.addEventListener("input", sync);
  text.addEventListener("focus", () => text.select());
  const form = h("form", { className: "mde-hex-row", on: { submit: (e) => (e.preventDefault(), parseHex(text.value) && onColor(colorTag(parseHex(text.value)!))) } }, picker, text, apply);
  const shadeBtn = h(
    "button",
    { className: "mde-menu-item", attrs: { type: "button", role: "menuitemcheckbox", "aria-checked": shade, "data-color": "음영" }, on: { click: onShade } },
    h("span", { className: "mde-swatch-row" }, h("span", { className: "mde-square", style: { background: SHADE } }), h("mark", { text: m.shade, style: { background: SHADE, padding: "0 3px" } })),
    shade ? h("small", { text: "✓" }) : null,
  );
  return h("div", { className: "mde-color-panel" }, palette, form, h("div", { className: "mde-menu-sep" }), shadeBtn);
}

// ───────────── 링크 ─────────────

export function linkPanel(m: Messages, href: string | null, withText: boolean, onApply: (href: string, text: string) => void, onRemove: (() => void) | null): HTMLElement {
  const url = h("input", { className: "mde-input", attrs: { type: "url", placeholder: "https://", "aria-label": m.linkUrl, "data-autofocus": true, spellcheck: "false" } });
  url.value = href ?? "";
  const label = withText ? h("input", { className: "mde-input", attrs: { type: "text", placeholder: m.linkText, "aria-label": m.linkText } }) : null;
  const err = h("div", { className: "mde-field-error", attrs: { role: "alert" } });
  err.hidden = true;
  const submit = (e: Event) => {
    e.preventDefault();
    let v = url.value.trim();
    if (!v) return;
    if (/^www\./i.test(v)) v = `https://${v}`;
    if (!safeHref(v)) {
      err.textContent = m.linkInvalid;
      err.hidden = false;
      return;
    }
    onApply(v, label?.value.trim() ?? "");
  };
  const actions = h(
    "div",
    { className: "mde-row" },
    h("button", { className: "mde-btn word primary", text: m.linkApply, attrs: { type: "submit" } }),
    onRemove ? h("button", { className: "mde-btn", html: icon("unlink"), title: m.linkRemove, attrs: { type: "button", "aria-label": m.linkRemove }, on: { click: onRemove } }) : null,
    href && safeHref(href)
      ? h("a", { className: "mde-btn", html: icon("external"), title: m.linkOpen, attrs: { href: safeHref(href)!, target: "_blank", rel: "noopener noreferrer", "aria-label": m.linkOpen } })
      : null,
  );
  return h("form", { className: "mde-link-panel", on: { submit } }, url, label, err, actions);
}

// ───────────── 표 크기 ─────────────

export function tableGrid(m: Messages, onPick: (rows: number, cols: number) => void, size: [number, number] = [8, 10]): HTMLElement {
  const [maxR, maxC] = size;
  const label = h("div", { className: "mde-grid-label", text: fill(m.tableSize, { rows: 3, cols: 3 }) });
  const grid = h("div", { className: "mde-grid", attrs: { role: "grid", "aria-label": m.insertTable } });
  grid.style.gridTemplateColumns = `repeat(${maxC}, 16px)`;
  const cells: HTMLButtonElement[] = [];
  const paint = (r: number, c: number) => {
    cells.forEach((b) => b.classList.toggle("on", Number(b.dataset.r) <= r && Number(b.dataset.c) <= c));
    label.textContent = fill(m.tableSize, { rows: r, cols: c });
  };
  for (let r = 1; r <= maxR; r++) {
    for (let c = 1; c <= maxC; c++) {
      const b = h("button", { className: "mde-grid-cell", attrs: { type: "button", "data-r": r, "data-c": c, "aria-label": fill(m.tableSize, { rows: r, cols: c }) }, on: { mouseenter: () => paint(r, c), focus: () => paint(r, c), click: () => onPick(r, c) } });
      cells.push(b);
      grid.append(b);
    }
  }
  paint(3, 3);
  return h("div", { className: "mde-table-panel" }, grid, label);
}

// ───────────── 특수 문자 ─────────────

export const SPECIAL_CHARS: [string, string][] = [
  ["기호", "©®™§¶†‡•·…‰′″‹›«»「」『』〈〉《》【】※"],
  ["화살표", "←↑→↓↔↕⇐⇑⇒⇓⇔↗↘↙↖➔"],
  ["수학", "±×÷≠≈≡≤≥∞√∑∏∫∂∆∇∈∉∩∪⊂⊃∧∨¬∀∃°µπΩαβγδθλσφω½⅓¼¾"],
  ["통화", "₩$€£¥¢₹₽₿"],
  ["단위", "℃℉㎜㎝㎞㎡㎥㎏㎖ℓ№㈜"],
  ["도형", "○●◎◇◆□■△▲▽▼☆★♠♣♥♦✓✗"],
];

export function specialCharsPanel(m: Messages, onPick: (ch: string) => void): HTMLElement {
  const wrap = h("div", { className: "mde-chars", attrs: { "aria-label": m.specialChars } });
  for (const [, chars] of SPECIAL_CHARS) {
    const row = h("div", { className: "mde-chars-group" });
    for (const ch of chars) row.append(h("button", { className: "mde-char", text: ch, attrs: { type: "button", title: ch, "aria-label": ch }, on: { click: () => onPick(ch) } }));
    wrap.append(row);
  }
  return wrap;
}

// ───────────── 그림 ─────────────

export function imagePanel(m: Messages, onUrl: (src: string, caption: string) => void, onFile: (() => void) | null): HTMLElement {
  const url = h("input", { className: "mde-input", attrs: { type: "url", placeholder: "https://…/image.png", "aria-label": m.imageUrl, "data-autofocus": true, spellcheck: "false" } });
  const caption = h("input", { className: "mde-input", attrs: { type: "text", placeholder: m.imageCaption, "aria-label": m.imageCaption } });
  const submit = (e: Event) => {
    e.preventDefault();
    const v = url.value.trim();
    if (v) onUrl(v, caption.value.trim());
  };
  return h(
    "form",
    { className: "mde-image-panel", on: { submit } },
    onFile ? h("button", { className: "mde-btn word wide", html: `${icon("image")}<span>${m.imageUpload}</span>`, attrs: { type: "button" }, on: { click: onFile } }) : null,
    url,
    caption,
    h("div", { className: "mde-row" }, h("button", { className: "mde-btn word primary", text: m.insertImage, attrs: { type: "submit" } })),
  );
}

// ───────────── 정렬 ─────────────

export const ALIGNS = [
  ["left", "alignLeft"],
  ["center", "alignCenter"],
  ["right", "alignRight"],
  ["justify", "alignJustify"],
] as const;

export function alignPanel(m: Messages, current: string | null, onPick: (align: "left" | "center" | "right" | "justify") => void): HTMLElement {
  return h(
    "div",
    { className: "mde-align-panel", attrs: { role: "group", "aria-label": m.align } },
    ...ALIGNS.map(([a, key]) => h("button", { className: "mde-btn", html: icon(key), title: m[key], attrs: { type: "button", "aria-label": m[key], "aria-pressed": current === a, "data-align": a }, on: { click: () => onPick(a) } })),
  );
}
