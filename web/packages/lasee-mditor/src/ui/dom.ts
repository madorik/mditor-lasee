// 작은 DOM 도우미 — 프레임워크 없이 화면을 만든다.

type Child = Node | string | null | undefined | false;
type Props = {
  className?: string;
  html?: string;
  text?: string;
  title?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  style?: Partial<CSSStyleDeclaration> | Record<string, string>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (e: HTMLElementEventMap[K]) => void }>;
};

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.className) el.className = props.className;
  if (props.html !== undefined) el.innerHTML = props.html;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.title) el.title = props.title;
  for (const [k, v] of Object.entries(props.attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? "" : String(v));
  }
  if (props.style) Object.assign(el.style, props.style);
  for (const [k, fn] of Object.entries(props.on ?? {})) el.addEventListener(k, fn as EventListener);
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** 열린 팝업 — 한 편집기 안에서 하나만 연다. */
export type Popover = { wrap: HTMLElement; button: HTMLButtonElement; open(): void; close(): void; isOpen(): boolean };

export type PopoverHost = { current: Popover | null };

/**
 * 단추 + 팝업. 단추를 누르면 build() 로 내용을 새로 만들어 단추 아래에 연다.
 * 바깥을 누르거나 Esc 를 누르면 닫는다.
 */
export function popover(host: PopoverHost, button: HTMLButtonElement, build: (close: () => void) => HTMLElement, align: "left" | "right" = "left"): Popover {
  const wrap = h("span", { className: "mde-menu" }, button);
  button.setAttribute("aria-haspopup", "true");
  button.setAttribute("aria-expanded", "false");
  let pop: HTMLElement | null = null;
  const away = (e: MouseEvent) => {
    if (!wrap.contains(e.target as Node)) api.close();
  };
  const esc = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      api.close();
      button.focus();
    }
  };
  const api: Popover = {
    wrap,
    button,
    open() {
      if (pop) return;
      if (host.current && host.current !== api) host.current.close();
      host.current = api;
      pop = h("div", { className: `mde-pop ${align === "right" ? "right" : ""}`, attrs: { role: "dialog" } }, build(() => api.close()));
      wrap.append(pop);
      button.setAttribute("aria-expanded", "true");
      document.addEventListener("mousedown", away, true);
      wrap.addEventListener("keydown", esc);
      // 화면 오른쪽을 넘으면 왼쪽으로 붙인다
      const r = pop.getBoundingClientRect();
      if (r.right > window.innerWidth - 8) pop.classList.add("right");
      pop.querySelector<HTMLElement>("input[data-autofocus], [data-autofocus]")?.focus();
    },
    close() {
      if (!pop) return;
      pop.remove();
      pop = null;
      if (host.current === api) host.current = null;
      button.setAttribute("aria-expanded", "false");
      document.removeEventListener("mousedown", away, true);
      wrap.removeEventListener("keydown", esc);
    },
    isOpen: () => !!pop,
  };
  button.addEventListener("click", () => (pop ? api.close() : api.open()));
  return api;
}
