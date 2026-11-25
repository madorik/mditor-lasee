// 글 서식 규칙. 서버 src/mditor/inline.py 와 **같은 규칙**이다. 고치면 둘 다 고친다
// (공유 기준 파일 fixture.json 이 어긋남을 잡는다).
//
// 태그는 한국어 이름({빨강})과 영어 이름({red})이 같은 태그다. 안에서는 한국어 이름으로 다루고,
// 쓸 때만 문서의 태그 언어(dialect)로 쓴다. 문서의 태그 언어는 처음 나오는 짝 맞은 태그가 정한다(dialectOf).
// 색 코드 태그({#1f8a5c}…{/#1f8a5c})는 아무 글자 색이나 쓴다. 언어가 없고, 소문자로 쓴다.
//
// 서식(바깥 → 안 순서):
//   [글](주소)        링크            — 글 안에 서식을 쓴다. 링크 안에 링크는 없다
//   **굵게**          굵게            — 여는 기호 뒤 · 닫는 기호 앞이 공백이 아니어야 짝이 된다
//   ~~취소선~~        취소선          — 〃
//   {기울임} {밑줄} {음영}            — 종류별로 여닫는 짝을 센다
//   ==형광펜==        형광펜(노랑)    — ** 와 같은 짝 규칙
//   {빨강} {#rrggbb}  글자 색
//   <sup> <sub>       위 · 아래 첨자
//   `코드`            코드            — 안의 글자는 그대로(서식 · 이스케이프 없음). 백틱 수가 같은 짝을 찾는다
//   <br>              줄바꿈
// 정렬 태그 {왼쪽} {가운데} {오른쪽} {양쪽} 은 문단 전체를 감쌀 때만 뜻이 있다(blockAlign). 글 안에서는 버린다.

export const INLINE_COLORS: Record<string, string> = { 빨강: "#c00000", 파랑: "#1f4e9b", 회색: "#7f7f7f" };
export const SHADE = "#d9d9d9";
export const MARK = "#fff3a3";
const FLAGS = ["기울임", "밑줄", "음영"] as const;
/** 정렬 태그 → CSS 정렬. 왼쪽은 기본이라 문단에 남기지 않는다. */
export const ALIGN_TAGS: Record<string, TextAlign | null> = { 왼쪽: null, 가운데: "center", 오른쪽: "right", 양쪽: "justify" };
export type TextAlign = "center" | "right" | "justify";
export type Dialect = "ko" | "en";
const EN: Record<string, string> = {
  빨강: "red",
  파랑: "blue",
  회색: "gray",
  기울임: "italic",
  밑줄: "underline",
  음영: "shade",
  왼쪽: "left",
  가운데: "center",
  오른쪽: "right",
  양쪽: "justify",
};
const ALIASES: Record<string, string> = { ...Object.fromEntries(Object.entries(EN).map(([k, v]) => [v, k])), grey: "회색" };
const WS = " \t\u00a0\u3000";
export const ESCAPABLE = "\\*~{}<>^|#-+!`[]=._)";
const TAG_NAMES = [...Object.keys(EN), ...Object.keys(ALIASES), "#[0-9a-fA-F]{6}"].join("|");
const HEX = /^#[0-9a-f]{6}$/;

/** 글자 색 태그인가 — 이름 붙은 색(빨강 · 파랑 · 회색) 또는 색 코드(#rrggbb). */
export const isColor = (name: string): boolean => name in INLINE_COLORS || HEX.test(name);
/** 글자 색 태그 → 색 코드. */
export const colorCss = (name: string): string => INLINE_COLORS[name] ?? name;

// 파이썬 \s 와 같은 공백 집합(제어 문자는 서버가 지운다)
export const PS = "[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const PS_CHARS = "\t\n\v\f\r \u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\x1c\x1d\x1e\x1f";
/** 링크 주소에 쓰는 글자 — 공백 · 제어 문자 · 괄호가 아닌 것. 괄호는 한 겹까지 짝을 맞춰 쓴다. */
const URL_CHAR = "[^\\x00-\\x20\\x7f-\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff()]";
const URL = `${URL_CHAR}*(?:\\(${URL_CHAR}*\\)${URL_CHAR}*)*`;
const URL_WHOLE = new RegExp(`^${URL}$`);

// 한 자리에서 읽는 토큰(이스케이프 · 코드는 따로 본다)
const AT = new RegExp(
  `(\\*\\*)|(~~)|(==)|\\{(/?)(${TAG_NAMES})\\}|(<br[ \\t]*/?>)|<(/?)(sup|sub)>|(\\[)|\\]\\((${URL})\\)|(\\])`,
  "iy",
);
const TAG_AT = new RegExp(`\\{/?(?:${TAG_NAMES})\\}`, "iy");
const BR_AT = /<br[ \t]*\/?>/iy;
const SCRIPT_AT = /<\/?(?:sup|sub)>/iy;
const PARA_BLOCK = new RegExp(`^(?:#{1,6}(?:${PS}|$)|>|[-*+](?:${PS}|$)|\\||!\\[.*\\]\\(.*\\)$)`, "s");
const PARA_ORDERED = new RegExp(`^(\\d{1,9})([.)])(?:${PS}|$)`, "s");
const PAGEBREAK = /^<!--[ \t]*pagebreak[ \t]*-->$/i;
const RULE = /^([-*_])(?:[ \t]*\1){2,}$/; // 가로줄(---)로 읽히는 문단
const ITEM_RULE = /^-(?:[ \t]*-)+$/; // "- " 뒤에 붙으면 가로줄이 되는 항목
const ITEM_TASK = new RegExp(`^\\[[ xX]\\](?:${PS}|$)`, "s"); // 항목 글이 할 일 칸([ ])으로 읽힌다
export const SPACES = new RegExp(`${PS.slice(0, -1)}\\x1c-\\x1f]+`, "g");

/** 파이썬 str.strip() 과 같은 공백 떼기. */
export function pyStrip(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && PS_CHARS.includes(s[a])) a++;
  while (b > a && PS_CHARS.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

export type Script = "sup" | "sub";

export type Seg = {
  text: string;
  link?: string | null;
  bold?: boolean;
  strike?: boolean;
  italic?: boolean;
  underline?: boolean;
  shade?: boolean;
  mark?: boolean;
  color?: string | null;
  script?: Script | null;
  code?: boolean;
};

// 0 링크 · 1 굵게 · 2 취소선 · 3 기울임 · 4 밑줄 · 5 음영 · 6 형광펜 · 7 색 · 8 첨자 · 9 코드
type Style = [string | null, boolean, boolean, boolean, boolean, boolean, boolean, string | null, Script | null, boolean];
const OFF: Style = [null, false, false, false, false, false, false, null, null, false];
const CODE = 9;

function style(s: Seg): Style {
  return [s.link || null, !!s.bold, !!s.strike, !!s.italic, !!s.underline, !!s.shade, !!s.mark, s.color || null, s.script || null, !!s.code];
}

const sameUpTo = (x: Style, y: Style, n: number) => {
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return false;
  return true;
};
const sameStyle = (a: Seg, b: Seg) => sameUpTo(style(a), style(b), 10);

function seg(text: string, st: Style): Seg {
  const out: Seg = { text };
  if (st[0]) out.link = st[0];
  if (st[1]) out.bold = true;
  if (st[2]) out.strike = true;
  if (st[3]) out.italic = true;
  if (st[4]) out.underline = true;
  if (st[5]) out.shade = true;
  if (st[6]) out.mark = true;
  if (st[7]) out.color = st[7];
  if (st[8]) out.script = st[8];
  if (st[9]) out.code = true;
  return out;
}

type Kind = "esc" | "bold" | "strike" | "mark" | "open" | "close" | "br" | "sopen" | "sclose" | "lopen" | "lclose" | "rclose" | "code";

type Tok = {
  start: number;
  end: number;
  kind: Kind;
  value: string; // esc: 글자, open/close: 태그 이름(안에서 쓰는 한국어 이름), sopen/sclose: sup|sub, lopen/lclose: 주소, code: 속 글자
  raw: string; // open/close: 글에 적힌 태그 이름 그대로
  paired: boolean;
  opens: boolean;
  partner: number;
  active: boolean; // lopen: 링크를 열 수 있는가(링크 안에 링크는 없다)
};

const PAIRED_DELIMS = ["bold", "strike", "mark"] as const;

function scan(s: string): Tok[] {
  const toks: Tok[] = [];
  const n = s.length;
  const push = (start: number, end: number, kind: Kind, value = "", raw = "", paired = false) =>
    toks.push({ start, end, kind, value, raw, paired, opens: false, partner: -1, active: true });
  let i = 0;
  while (i < n) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < n && ESCAPABLE.includes(s[i + 1])) {
      push(i, i + 2, "esc", s[i + 1], "", true);
      i += 2;
      continue;
    }
    if (ch === "`") {
      // 코드: 같은 수의 백틱으로 닫는다. 닫는 짝이 없으면 백틱은 글자다
      let j = i;
      while (j < n && s[j] === "`") j++;
      const len = j - i;
      let k = j;
      let close = -1;
      while (k < n) {
        if (s[k] === "`") {
          let m = k;
          while (m < n && s[m] === "`") m++;
          if (m - k === len) {
            close = k;
            break;
          }
          k = m;
        } else k++;
      }
      if (close >= 0) {
        let body = s.slice(j, close);
        if (body.length >= 2 && body[0] === " " && body[body.length - 1] === " " && /[^ ]/.test(body)) body = body.slice(1, -1);
        push(i, close + len, "code", body, "", true);
        i = close + len;
      } else i = j;
      continue;
    }
    AT.lastIndex = i;
    const m = AT.exec(s);
    if (!m) {
      i++;
      continue;
    }
    const end = i + m[0].length;
    if (m[1]) push(i, end, "bold");
    else if (m[2]) push(i, end, "strike");
    else if (m[3]) push(i, end, "mark");
    else if (m[5]) {
      const name = m[5].startsWith("#") ? m[5].toLowerCase() : (ALIASES[m[5].toLowerCase()] ?? m[5]);
      push(i, end, m[4] ? "close" : "open", name, m[5]);
    } else if (m[6]) push(i, end, "br", "", "", true);
    else if (m[8]) push(i, end, m[7] ? "sclose" : "sopen", m[8].toLowerCase());
    else if (m[9]) push(i, end, "lopen");
    else if (m[10] !== undefined && m[10] !== "") push(i, end, "lclose", m[10]);
    else {
      push(i, i + 1, "rclose"); // `]` 또는 주소가 빈 `]()` — 괄호는 글자로 남는다
      i++;
      continue;
    }
    i = end;
  }

  // ** · ~~ · == : 가장 가까운 여는 기호와 짝짓는다
  for (const kind of PAIRED_DELIMS) {
    let pending = -1;
    toks.forEach((t, i) => {
      if (t.kind !== kind) return;
      const canOpen = t.end < s.length && !WS.includes(s[t.end]);
      const canClose = t.start > 0 && !WS.includes(s[t.start - 1]);
      if (pending >= 0 && canClose) {
        const o = toks[pending];
        o.paired = t.paired = true;
        o.opens = true;
        o.partner = i;
        t.partner = pending;
        pending = -1;
      } else if (canOpen) {
        pending = i;
      }
    });
  }

  // 중괄호 태그 · <sup> <sub> : 종류별 스택
  const stacks: Record<string, number[]> = {};
  toks.forEach((t, i) => {
    if (t.kind === "open" || t.kind === "sopen") (stacks[t.kind + t.value] ??= []).push(i);
    else if (t.kind === "close" || t.kind === "sclose") {
      const key = (t.kind === "close" ? "open" : "sopen") + t.value;
      if (!stacks[key]?.length) return;
      const j = stacks[key].pop()!;
      toks[j].paired = t.paired = true;
      toks[j].partner = i;
      t.partner = j;
    }
  });

  // 링크: 대괄호 스택. 링크가 되면 그 앞의 여는 괄호는 더는 링크를 열지 못한다
  const brackets: number[] = [];
  toks.forEach((t, i) => {
    if (t.kind === "lopen") brackets.push(i);
    else if (t.kind === "lclose" || t.kind === "rclose") {
      if (!brackets.length) return;
      const j = brackets.pop()!;
      if (t.kind === "lclose" && toks[j].active) {
        toks[j].paired = t.paired = true;
        toks[j].value = t.value;
        toks[j].partner = i;
        t.partner = j;
        for (const k of brackets) toks[k].active = false;
      }
    }
  });
  return toks;
}

/** 서식 문자열 → 조각. 줄바꿈(<br>)은 글자 "\n" 으로 들어간다. */
export function segments(s: string): Seg[] {
  const toks = scan(s);
  const out: Seg[] = [];
  let link: string | null = null;
  let bold = false;
  let strike = false;
  let mark = false;
  const depth: Record<string, number> = { 기울임: 0, 밑줄: 0, 음영: 0 };
  const colors: string[] = [];
  const scripts: Script[] = [];

  const now = (code: boolean): Style => [
    link,
    bold,
    strike,
    depth["기울임"] > 0,
    depth["밑줄"] > 0,
    depth["음영"] > 0,
    mark,
    colors.length ? colors[colors.length - 1] : null,
    scripts.length ? scripts[scripts.length - 1] : null,
    code,
  ];
  const emit = (text: string, code = false) => {
    if (!text) return;
    const next = seg(text, now(code));
    const last = out[out.length - 1];
    if (last && sameStyle(last, next)) last.text += text;
    else out.push(next);
  };

  let pos = 0;
  for (const t of toks) {
    emit(s.slice(pos, t.start));
    pos = t.end;
    if (!t.paired) emit(s.slice(t.start, t.end));
    else if (t.kind === "esc") emit(t.value);
    else if (t.kind === "br") emit("\n");
    else if (t.kind === "code") emit(t.value, true);
    else if (t.kind === "bold") bold = t.opens;
    else if (t.kind === "strike") strike = t.opens;
    else if (t.kind === "mark") mark = t.opens;
    else if (t.kind === "lopen") link = t.value;
    else if (t.kind === "lclose") link = null;
    else if (t.kind === "sopen") scripts.push(t.value as Script);
    else if (t.kind === "sclose") {
      const k = scripts.lastIndexOf(t.value as Script);
      if (k >= 0) scripts.splice(k, 1);
    } else if (isColor(t.value)) {
      if (t.kind === "open") colors.push(t.value);
      else {
        const k = colors.lastIndexOf(t.value); // 가장 안쪽의 같은 색을 닫는다
        if (k >= 0) colors.splice(k, 1);
      }
    } else if ((FLAGS as readonly string[]).includes(t.value)) {
      depth[t.value] += t.kind === "open" ? 1 : -1;
    } // 정렬 태그는 글 안에서는 뜻이 없다
  }
  emit(s.slice(pos));
  return out;
}

function merge(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    if (!s.text) continue;
    const last = out[out.length - 1];
    if (last && sameStyle(last, s)) last.text += s.text;
    else out.push(seg(s.text, style(s)));
  }
  return out;
}

function lstripLen(t: string, chars: string): number {
  let n = 0;
  while (n < t.length && chars.includes(t[n])) n++;
  return n;
}

function rstripLen(t: string, chars: string): number {
  let n = 0;
  while (n < t.length && chars.includes(t[t.length - 1 - n])) n++;
  return n;
}

/**
 * `field` 서식이 켜진 연속 구간마다 앞뒤 공백에서 그 서식을 뗀다(공백을 구간 밖으로 민다).
 * 구간은 그보다 바깥 서식(0..field-1)이 바뀌는 자리에서 끊긴다 — 쓸 때 거기서 기호가 닫혔다 열리기 때문이다.
 */
function trimEdges(segs: Seg[], field: number): Seg[] {
  const out: Seg[] = [];
  let i = 0;
  while (i < segs.length) {
    if (!style(segs[i])[field]) {
      out.push(segs[i]);
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < segs.length && style(segs[j + 1])[field] && sameUpTo(style(segs[i]), style(segs[j + 1]), field)) j++;
    let run = segs.slice(i, j + 1);
    const off = (s: Seg, text: string): Seg => {
      const st = style(s);
      st[field] = false;
      return seg(text, st);
    };
    const head: Seg[] = [];
    while (run.length) {
      const t = run[0].text;
      const n = lstripLen(t, WS);
      if (n === 0) break;
      head.push(off(run[0], t.slice(0, n)));
      if (n === t.length) run = run.slice(1);
      else {
        run = [seg(t.slice(n), style(run[0])), ...run.slice(1)];
        break;
      }
    }
    const tail: Seg[] = [];
    while (run.length) {
      const last = run[run.length - 1];
      const t = last.text;
      const n = rstripLen(t, WS);
      if (n === 0) break;
      tail.unshift(off(last, t.slice(t.length - n)));
      if (n === t.length) run = run.slice(0, -1);
      else {
        run = [...run.slice(0, -1), seg(t.slice(0, t.length - n), style(last))];
        break;
      }
    }
    out.push(...head, ...run, ...tail);
    i = j + 1;
  }
  return out;
}

/**
 * 표준 꼴: 코드 안의 줄바꿈은 빈칸으로, 전체 앞뒤 공백·줄바꿈을 버리고,
 * 굵게·취소선·형광펜 구간의 앞뒤 공백을 구간 밖으로 민다(짝 규칙 때문에 기호 안쪽에 공백을 둘 수 없다).
 */
export function normalize(segs: Seg[]): Seg[] {
  // 코드 안의 줄바꿈은 빈칸, 링크 주소는 MD 에 쓸 꼴(linkHref)로 — 그래야 쓰고 다시 읽어도 같다
  const pre = segs.map((s) => {
    const st = style(s);
    let text = s.text;
    if (st[CODE] && text.includes("\n")) text = text.replace(/\n/g, " ");
    if (st[0]) st[0] = linkHref(st[0]) || null;
    return seg(text, st);
  });
  let cur = merge(pre);
  while (cur.length) {
    const t = cur[0].text.slice(lstripLen(cur[0].text, WS + "\n"));
    if (t) {
      cur[0] = seg(t, style(cur[0]));
      break;
    }
    cur.shift();
  }
  while (cur.length) {
    const last = cur[cur.length - 1];
    const t = last.text.slice(0, last.text.length - rstripLen(last.text, WS + "\n"));
    if (t) {
      cur[cur.length - 1] = seg(t, style(last));
      break;
    }
    cur.pop();
  }
  cur = merge(trimEdges(cur, 1));
  cur = merge(trimEdges(cur, 2));
  cur = merge(trimEdges(cur, 6));
  return cur;
}

/** 태그 이름을 문서의 태그 언어로(`tag("음영", "en") === "shade"`). */
export const tag = (name: string, dialect: Dialect = "ko"): string => (dialect === "en" ? (EN[name] ?? name) : name);
const TAG_LEVEL: Record<number, string> = { 3: "기울임", 4: "밑줄", 5: "음영" };

function openTag(level: number, value: unknown, dialect: Dialect): string {
  if (level === 0) return "[";
  if (level === 1) return "**";
  if (level === 2) return "~~";
  if (level === 6) return "==";
  if (level === 8) return `<${String(value)}>`;
  return `{${tag(TAG_LEVEL[level] ?? String(value), dialect)}}`;
}

function closeTag(level: number, value: unknown, dialect: Dialect): string {
  if (level === 0) return `](${linkHref(String(value))})`;
  if (level === 1) return "**";
  if (level === 2) return "~~";
  if (level === 6) return "==";
  if (level === 8) return `</${String(value)}>`;
  return `{/${tag(TAG_LEVEL[level] ?? String(value), dialect)}}`;
}

/** 링크 주소를 MD 에 쓸 꼴로 — 공백이나 짝 안 맞는 괄호가 있으면 퍼센트 부호로 바꾼다. */
export function linkHref(href: string): string {
  const h = pyStrip(href);
  if (h && URL_WHOLE.test(h)) return h;
  return h.replace(/[\x00-\x20\x7f-\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff()]/g, (c) =>
    Array.from(new TextEncoder().encode(c), (b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`).join(""),
  );
}

/** 코드 조각 → `코드`. 안에 없는 길이의 백틱으로 감싸고, 끝이 백틱이거나 양끝이 빈칸이면 빈칸을 하나씩 덧댄다. */
function codeSpan(text: string): string {
  const runs = new Set<number>();
  let run = 0;
  for (const ch of text + " ") {
    if (ch === "`") run++;
    else {
      if (run) runs.add(run);
      run = 0;
    }
  }
  let n = 1;
  while (runs.has(n)) n++;
  const fence = "`".repeat(n);
  const pad = text.startsWith("`") || text.endsWith("`") || (text.length >= 2 && text.startsWith(" ") && text.endsWith(" ") && /[^ ]/.test(text)) ? " " : "";
  return fence + pad + text + pad + fence;
}

/** 문서의 태그 언어 — 처음 나오는 짝 맞은 태그가 정한다. 태그가 없으면 null. */
export function dialectOf(text: string): Dialect | null {
  for (const line of text.split("\n")) {
    if (!line.includes("{")) continue;
    for (const t of scan(line)) {
      if (t.kind === "open" && t.paired && !t.raw.startsWith("#")) return t.raw.toLowerCase() in ALIASES ? "en" : "ko"; // 색 코드는 언어가 없다
    }
  }
  return null;
}

export type Ctx = "cell" | "para" | "item" | null;

/**
 * 조각 → 서식 문자열. `segs` 는 normalize 를 거친 것이어야 한다.
 * ctx="cell": 칸 전체가 `<` · `^` 하나면 이스케이프(칸 합치기 기호와 구별).
 * ctx="para": 문단이 블록 기호(#, >, -, |, 그림, 번호, 쪽 나눔)로 시작하거나 가로줄(---)로 읽히면 이스케이프.
 * ctx="item": 항목이 `- ` 뒤에 붙어 가로줄로 읽히거나 할 일 칸(`[ ]`)으로 시작하면 이스케이프.
 */
export function write(segs: Seg[], ctx: Ctx = null, dialect: Dialect = "ko"): string {
  // [기호인지, 글자, 링크 안인지]
  const pieces: [boolean, string, boolean][] = [];
  let cur: Style = OFF;
  for (const [st, text] of [...segs.map((s) => [style(s), s.text] as [Style, string]), [OFF, ""] as [Style, string]]) {
    let first = -1;
    for (let i = 0; i < CODE; i++) {
      if (cur[i] !== st[i]) {
        first = i;
        break;
      }
    }
    if (first >= 0) {
      for (let j = CODE - 1; j >= first; j--) if (cur[j]) pieces.push([true, closeTag(j, cur[j], dialect), false]);
      for (let j = first; j < CODE; j++) if (st[j]) pieces.push([true, openTag(j, st[j], dialect), false]);
    }
    if (text) pieces.push(st[CODE] ? [true, codeSpan(text), false] : [false, text, !!st[0]]);
    cur = st;
  }

  const raw = pieces.map((p) => p[1]).join("");
  const markup: boolean[] = []; // raw 의 글자마다: 우리가 넣은 기호인가
  const inLink: boolean[] = [];
  const tokenAt = new Set<number>(); // 우리가 넣은 ** · ~~ · == 의 시작 자리
  const linkAt = new Set<number>(); // 우리가 넣은 링크 여는 [ 자리
  for (const [isMarkup, text, linked] of pieces) {
    if (isMarkup && (text === "**" || text === "~~" || text === "==")) tokenAt.add(markup.length);
    if (isMarkup && text === "[") linkAt.add(markup.length);
    for (let k = 0; k < text.length; k++) {
      markup.push(isMarkup);
      inLink.push(linked);
    }
  }

  // 이스케이프할 자리(raw 기준). 꼭 필요한 곳만 — 짝 없는 `1.31**` 은 그대로 남는다.
  const esc = new Set<number>();
  for (let p = 0; p < raw.length; p++) {
    if (markup[p]) continue;
    const ch = raw[p];
    if (ch === "\\") {
      if (p + 1 < raw.length && (ESCAPABLE.includes(raw[p + 1]) || raw[p + 1] === "\n")) esc.add(p);
    } else if (ch === "{") {
      TAG_AT.lastIndex = p;
      if (TAG_AT.test(raw)) esc.add(p);
    } else if (ch === "<") {
      BR_AT.lastIndex = p;
      SCRIPT_AT.lastIndex = p;
      if (BR_AT.test(raw) || SCRIPT_AT.test(raw)) esc.add(p);
    } else if (ch === "`") {
      esc.add(p); // 글자로 쓴 백틱은 언제나
    } else if ((ch === "[" || ch === "]") && inLink[p]) {
      esc.add(p); // 링크 글 안의 대괄호는 언제나
    }
  }

  let result = "";
  for (;;) {
    const chars: string[] = [];
    const origin: number[] = []; // 출력 글자 → raw 자리
    for (let p = 0; p < raw.length; p++) {
      if (esc.has(p)) {
        chars.push("\\");
        origin.push(-1);
      }
      if (raw[p] === "\n" && !markup[p]) {
        chars.push("<", "b", "r", ">");
        origin.push(-1, -1, -1, -1);
      } else {
        chars.push(raw[p]);
        origin.push(p);
      }
    }
    result = chars.join("");
    // 글자로 쓴 * · ~ · = 가 서식 기호로 읽히거나 글자로 쓴 [ 가 링크를 열면 그 자리만 이스케이프하고 다시 본다
    let offender: number[] = [];
    for (const t of scan(result)) {
      if (t.kind === "bold" || t.kind === "strike" || t.kind === "mark") {
        const p0 = origin[t.start];
        const p1 = origin[t.start + 1];
        if (tokenAt.has(p0)) continue; // 우리가 넣은 기호가 제자리에서 읽혔다
        const literal = [p0, p1].filter((p) => !markup[p]);
        if (literal.length < 2 || t.paired) {
          offender = literal;
          break;
        }
      } else if (t.kind === "lopen" && t.paired) {
        const p0 = origin[t.start];
        if (linkAt.has(p0)) continue;
        offender = [p0];
        break;
      } else if (t.kind === "lclose" && !t.paired) {
        // 짝 없는 `](…)` 는 통째로 글자로 읽힌다 — 그 안에 우리가 넣은 기호(서식 · <br> · 이스케이프)가 들면
        // 기호가 글자가 되어 버리므로, 글자로 쓴 `]` 를 이스케이프해 토큰을 깬다
        const p0 = origin[t.start];
        let swallows = false;
        for (let k = t.start + 1; k < t.end && !swallows; k++) swallows = origin[k] < 0 || markup[origin[k]];
        if (p0 >= 0 && !markup[p0] && swallows) {
          offender = [p0];
          break;
        }
      }
    }
    if (!offender.length) break;
    offender.forEach((p) => esc.add(p));
  }

  if (ctx === "cell" && (result === "<" || result === "^")) return "\\" + result;
  if (ctx === "para") {
    if (PARA_BLOCK.test(result) || RULE.test(result) || PAGEBREAK.test(result)) return "\\" + result;
    const m = PARA_ORDERED.exec(result);
    if (m) return m[1] + "\\" + result.slice(m[1].length);
  }
  if (ctx === "item" && (ITEM_RULE.test(result) || ITEM_TASK.test(result))) return "\\" + result;
  return result;
}

/** 서식 문자열을 표준 꼴로. */
export function canon(s: string, ctx: Ctx = null, dialect: Dialect = "ko"): string {
  return write(normalize(segments(s)), ctx, dialect);
}

/** 줄바꿈·빈칸 문자를 빈칸 하나로, 이어진 빈칸은 조각 경계를 넘어서도 하나로(서버 _one_space). */
export function oneSpace(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  let space = false; // 앞 조각이 빈칸으로 끝났는가
  for (const s of segs) {
    let text = s.text.replace(SPACES, " ");
    if (space && text.startsWith(" ")) text = text.slice(1);
    if (text) {
      out.push(seg(text, style(s)));
      space = text.endsWith(" ");
    }
  }
  return out;
}

/** 제목(# ## ###)의 표준 꼴(서버 inline.title). 서식은 본문과 같고, 한 줄이므로 줄바꿈은 빈칸이며 이어진 빈칸은 하나다. */
export function title(s: string, dialect: Dialect = "ko"): string {
  return write(normalize(oneSpace(segments(s))), null, dialect);
}

/** 서식을 뗀 글자만(줄바꿈은 공백). */
export function plainInline(s: string): string {
  return pyStrip(
    segments(s)
      .map((x) => x.text)
      .join("")
      .replace(SPACES, " "),
  );
}

/** 글 전체를 한 태그로 감쌌으면 [태그 이름, 속 내용]. */
function wrapped(s: string, accept: (t: Tok) => boolean): [string | null, string] {
  const toks = scan(s);
  if (!toks.length) return [null, s];
  const first = toks[0];
  const last = toks[toks.length - 1];
  const whole = first.start === 0 && first.kind === "open" && accept(first) && first.paired && last.end === s.length && toks[first.partner] === last;
  return whole ? [first.value, s.slice(first.end, last.start)] : [null, s];
}

/** 칸 전체를 `{음영}…{/음영}` 으로 감쌌으면 [true, 속 내용] — 칸 배경이다. */
export function cellShade(s: string): [boolean, string] {
  const [name, inner] = wrapped(s, (t) => t.value === "음영");
  return [name !== null, inner];
}

/** 문단 전체를 정렬 태그(`{가운데}…{/가운데}`)로 감쌌으면 [정렬, 속 내용]. 왼쪽은 기본이라 null. */
export function blockAlign(s: string): [TextAlign | null, string, boolean] {
  const [name, inner] = wrapped(s, (t) => t.value in ALIGN_TAGS);
  return name === null ? [null, s, false] : [ALIGN_TAGS[name], inner, true];
}

/** 링크 주소가 열어도 되는 것인가(javascript: 같은 것은 막는다). 화면에 그릴 때 쓴다. */
export function safeHref(href: string): string | null {
  const h = pyStrip(href);
  if (!h) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(h);
  if (!scheme) return h; // 상대 주소 · #자리
  return ["http", "https", "mailto", "tel"].includes(scheme[1].toLowerCase()) ? h : null;
}
