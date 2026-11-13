// 문서 · MD 탭 도구 막대가 함께 쓰는 단추 — 글자 색 · 음영을 한데 모은 색 메뉴, 이미지 단추.

import { useState, type FormEvent } from "react";
import { t } from "../lib/i18n";
import { colorCss, INLINE_COLORS, SHADE } from "../lib/inline";
import { Menu } from "./ui";

// 색 팔레트 — 7칸 × 5줄. 첫 칸("")은 기본 색(색 지우기). 빨강 · 파랑 · 회색 칸은 이름 태그({빨강})로 쓴다.
const PALETTE: string[][] = [
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
  const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
  return `#${h.toLowerCase()}`;
}

/** 색 코드 → 문서에 쓸 태그 이름. 이름 붙은 색과 같으면 그 이름(빨강 · 파랑 · 회색). */
export function colorTag(hex: string): string {
  return Object.entries(INLINE_COLORS).find(([, css]) => css === hex)?.[0] ?? hex;
}

/**
 * 색 메뉴 — 팔레트에서 글자 색을 고르거나 색 코드를 넣고, 음영을 켜고 끈다.
 * color: 지금 글자 색(태그 이름 또는 색 코드, 모르면 null). onColor(null) 은 색 지우기 — 문서 탭에서만 준다(MD 탭은 태그로 감싸기만 한다).
 */
export function ColorMenu({
  color,
  shade,
  disabled,
  onColor,
  onShade,
  canClear,
}: {
  color: string | null;
  shade: boolean;
  disabled?: boolean;
  onColor: (name: string | null) => void;
  onShade: () => void;
  canClear: boolean;
}) {
  const current = color ? colorCss(color) : null;
  const bar = current ?? "currentColor";
  if (disabled) {
    return (
      <button type="button" className="tool color-tool" disabled title={t("글자 색 · 음영")}>
        <ColorGlyph bar={bar} shade={false} />
      </button>
    );
  }
  return (
    <Menu
      align="left"
      className="tool color-tool"
      title={t("글자 색 · 음영")}
      label={
        <span className="color-label">
          <ColorGlyph bar={bar} shade={shade} />
          <span className="caret" aria-hidden="true">▾</span>
        </span>
      }
    >
      {(close) => <ColorPanel current={current} shade={shade} canClear={canClear} onColor={(c) => (close(), onColor(c))} onShade={() => (close(), onShade())} />}
    </Menu>
  );
}

function ColorPanel({ current, shade, canClear, onColor, onShade }: { current: string | null; shade: boolean; canClear: boolean; onColor: (name: string | null) => void; onShade: () => void }) {
  const [text, setText] = useState(current ?? "#333333");
  const typed = parseHex(text);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (typed) onColor(colorTag(typed));
  };
  return (
    <div className="color-panel">
      <div className="palette" role="group" aria-label={t("글자 색")}>
        {PALETTE.flat().map((hex) =>
          hex ? (
            <button
              key={hex}
              type="button"
              className={`swatch-btn ${hex === "#ffffff" ? "light" : ""}`}
              style={{ background: hex }}
              data-color={hex}
              aria-label={hex}
              title={hex}
              aria-pressed={current === hex}
              onClick={() => onColor(colorTag(hex))}
            />
          ) : (
            <button
              key="none"
              type="button"
              className="swatch-btn none"
              data-color=""
              aria-label={t("기본 색")}
              title={canClear ? t("기본 색") : t("MD 탭에서는 색 태그를 지워서 되돌립니다")}
              aria-pressed={!current}
              disabled={!canClear}
              onClick={() => onColor(null)}
            />
          ),
        )}
      </div>
      <form className="hex-row" onSubmit={submit}>
        <input type="color" aria-label={t("색 고르기")} title={t("색 고르기")} value={typed ?? "#333333"} onChange={(e) => setText(e.target.value)} />
        <input type="text" className="hex-input" aria-label={t("색 코드")} value={text} maxLength={7} spellCheck={false} onFocus={(e) => e.target.select()} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn hex-apply" disabled={!typed}>
          {t("입력")}
        </button>
      </form>
      <div className="menu-sep" />
      <button type="button" className="menu-item" role="menuitemcheckbox" aria-checked={shade} data-color="음영" onClick={onShade}>
        <span className="swatch-row">
          <span className="swatch square" style={{ background: SHADE }} />
          <mark style={{ background: SHADE, padding: "0 3px" }}>{t("음영")}</mark>
        </span>
        {shade && <small>✓</small>}
      </button>
    </div>
  );
}

/** 색 단추의 그림 — 글자 아래 막대가 지금 색이다. */
function ColorGlyph({ bar, shade }: { bar: string; shade: boolean }) {
  return (
    <span className="color-glyph" style={shade ? { background: SHADE } : undefined}>
      {t("가")}
      <i style={{ background: bar }} />
    </span>
  );
}

/** 이미지 넣기 단추(저장소가 켜져 있으면 올린다). */
export function ImageButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="tool word image-tool" disabled={disabled} onClick={onClick} title={t("이미지 넣기")}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-5-5L5 21" />
      </svg>
      {t("이미지")}
    </button>
  );
}
