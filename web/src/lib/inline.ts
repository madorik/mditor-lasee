// 글 서식 규칙. 서버 src/mditor/inline.py 와 **같은 규칙**이다. 고치면 둘 다 고친다
// (공유 기준 파일 fixture.json 이 어긋남을 잡는다).
//
// 태그는 한국어 이름({빨강})과 영어 이름({red})이 같은 태그다. 안에서는 한국어 이름으로 다루고,
// 쓸 때만 문서의 태그 언어(dialect)로 쓴다. 문서의 태그 언어는 처음 나오는 짝 맞은 태그가 정한다(dialectOf).

export const INLINE_COLORS: Record<string, string> = { 빨강: "#c00000", 파랑: "#1f4e9b", 회색: "#7f7f7f" };
export const SHADE = "#d9d9d9";
const FLAGS = ["밑줄", "음영"] as const;
export type Dialect = "ko" | "en";
const EN: Record<string, string> = { 빨강: "red", 파랑: "blue", 회색: "gray", 밑줄: "underline", 음영: "shade" };
const ALIASES: Record<string, string> = { ...Object.fromEntries(Object.entries(EN).map(([k, v]) => [v, k])), grey: "회색" };
const WS = " \t\u00a0\u3000";
const ESCAPABLE = "\\*~{}<>^|#-+!";
const TAG_NAMES = ["빨강", "파랑", "회색", "밑줄", "음영", ...Object.keys(ALIASES)].join("|");
const TOKEN = () =>
  new RegExp(`\\\\([\\\\*~{}<>^|#\\-+!])|(\\*\\*)|(~~)|\\{(/?)(${TAG_NAMES})\\}|(<br[ \\t]*/?>)`, "gi");
const TAG_AT = new RegExp(`\\{/?(?:${TAG_NAMES})\\}`, "y");
const BR_AT = /<br[ \t]*\/?>/iy;
// 파이썬 \s 와 같은 공백 집합(제어 문자는 서버가 지운다)
const PS = "[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const PARA_BLOCK = new RegExp(`^(?:#{1,6}(?:${PS}|$)|>|[-*+](?:${PS}|$)|\\||!\\[.*\\]\\(.*\\)$)`);
const RULE = /^([-*])(?:[ \t]*\1){2,}$/; // 가로줄(---)로 읽히는 문단
const ITEM_RULE = /^-(?:[ \t]*-)+$/; // "- " 뒤에 붙으면 가로줄이 되는 항목
export const SPACES = new RegExp(`${PS.slice(0, -1)}\\x1c-\\x1f]+`, "g");

export type Seg = {
  text: string;
  bold?: boolean;
  strike?: boolean;
  underline?: boolean;
  shade?: boolean;
  color?: string | null;
};

type Style = [boolean, boolean, boolean, boolean, string | null];

/** 바깥 → 안 순서(굵게 · 취소선 · 밑줄 · 음영 · 색). */
function style(s: Seg): Style {
  return [!!s.bold, !!s.strike, !!s.underline, !!s.shade, s.color ?? null];
}

function sameStyle(a: Seg, b: Seg): boolean {
  const x = style(a);
  const y = style(b);
  return x.every((v, i) => v === y[i]);
}

function seg(text: string, st: Style): Seg {
  const out: Seg = { text };
  if (st[0]) out.bold = true;
  if (st[1]) out.strike = true;
  if (st[2]) out.underline = true;
  if (st[3]) out.shade = true;
  if (st[4]) out.color = st[4];
  return out;
}

type Tok = {
  start: number;
  end: number;
  kind: "esc" | "bold" | "strike" | "open" | "close" | "br";
  value: string; // esc: 글자, open/close: 태그 이름(안에서 쓰는 한국어 이름)
  raw: string; // open/close: 글에 적힌 태그 이름 그대로
  paired: boolean;
  opens: boolean;
  partner: number;
};

function scan(s: string): Tok[] {
  const toks: Tok[] = [];
  for (const m of s.matchAll(TOKEN())) {
    const start = m.index ?? 0;
    const base = { start, end: start + m[0].length, value: "", raw: "", paired: false, opens: false, partner: -1 };
    if (m[1] !== undefined) toks.push({ ...base, kind: "esc", value: m[1], paired: true });
    else if (m[2]) toks.push({ ...base, kind: "bold" });
    else if (m[3]) toks.push({ ...base, kind: "strike" });
    else if (m[5]) toks.push({ ...base, kind: m[4] ? "close" : "open", value: ALIASES[m[5].toLowerCase()] ?? m[5], raw: m[5] });
    else toks.push({ ...base, kind: "br", paired: true });
  }

  // ** 와 ~~ : 가장 가까운 여는 기호와 짝짓는다
  for (const kind of ["bold", "strike"] as const) {
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

  // 중괄호 태그 : 종류별 스택
  const stacks: Record<string, number[]> = {};
  toks.forEach((t, i) => {
    if (t.kind === "open") (stacks[t.value] ??= []).push(i);
    else if (t.kind === "close" && stacks[t.value]?.length) {
      const j = stacks[t.value].pop()!;
      toks[j].paired = t.paired = true;
      toks[j].partner = i;
      t.partner = j;
    }
  });
  return toks;
}

/** 서식 문자열 → 조각. 줄바꿈(<br>)은 글자 "\n" 으로 들어간다. */
export function segments(s: string): Seg[] {
  const toks = scan(s);
  const out: Seg[] = [];
  let bold = false;
  let strike = false;
  const depth: Record<string, number> = { 밑줄: 0, 음영: 0 };
  const colors: string[] = [];

  const emit = (text: string) => {
    if (!text) return;
    const next = seg(text, [bold, strike, depth["밑줄"] > 0, depth["음영"] > 0, colors.length ? colors[colors.length - 1] : null]);
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
    else if (t.kind === "bold") bold = t.opens;
    else if (t.kind === "strike") strike = t.opens;
    else if (t.value in INLINE_COLORS) {
      if (t.kind === "open") colors.push(t.value);
      else {
        const k = colors.lastIndexOf(t.value); // 가장 안쪽의 같은 색을 닫는다
        if (k >= 0) colors.splice(k, 1);
      }
    } else if ((FLAGS as readonly string[]).includes(t.value)) {
      depth[t.value] += t.kind === "open" ? 1 : -1;
    }
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

/** `field` 가 켜진 연속 구간마다 앞뒤 공백에서 그 서식을 뗀다(공백을 구간 밖으로 민다). */
function trimEdges(segs: Seg[], field: "bold" | "strike", same: (a: Seg, b: Seg) => boolean): Seg[] {
  const out: Seg[] = [];
  let i = 0;
  while (i < segs.length) {
    if (!segs[i][field]) {
      out.push(segs[i]);
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < segs.length && segs[j + 1][field] && same(segs[i], segs[j + 1])) j++;
    let run = segs.slice(i, j + 1);
    const off = (s: Seg, text: string): Seg => {
      const st = style(s);
      st[field === "bold" ? 0 : 1] = false;
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

/** 표준 꼴: 전체 앞뒤 공백·줄바꿈을 버리고, 굵게·취소선 구간의 앞뒤 공백을 구간 밖으로 민다. */
export function normalize(segs: Seg[]): Seg[] {
  let cur = merge(segs);
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
  cur = merge(trimEdges(cur, "bold", () => true));
  // 취소선은 굵게 안쪽이라 굵게가 바뀌는 자리에서 한 번 닫혔다 열린다 — 그 조각 단위로 민다
  cur = merge(trimEdges(cur, "strike", (a, b) => !!a.bold === !!b.bold));
  return cur;
}

/** 태그 이름을 문서의 태그 언어로(`tag("음영", "en") === "shade"`). */
export const tag = (name: string, dialect: Dialect = "ko"): string => (dialect === "en" ? (EN[name] ?? name) : name);
const tagOf = (level: number, value: unknown, dialect: Dialect) => tag(level === 2 ? "밑줄" : level === 3 ? "음영" : String(value), dialect);
const openTag = (level: number, value: unknown, dialect: Dialect) => (level < 2 ? ["**", "~~"][level] : `{${tagOf(level, value, dialect)}}`);
const closeTag = (level: number, value: unknown, dialect: Dialect) => (level < 2 ? ["**", "~~"][level] : `{/${tagOf(level, value, dialect)}}`);

/** 문서의 태그 언어 — 처음 나오는 짝 맞은 태그가 정한다. 태그가 없으면 null. */
export function dialectOf(text: string): Dialect | null {
  for (const line of text.split("\n")) {
    if (!line.includes("{")) continue;
    for (const t of scan(line)) {
      if (t.kind === "open" && t.paired) return t.raw.toLowerCase() in ALIASES ? "en" : "ko";
    }
  }
  return null;
}

export type Ctx = "cell" | "para" | "item" | null;

/**
 * 조각 → 서식 문자열. `segs` 는 normalize 를 거친 것이어야 한다.
 * ctx="cell": 칸 전체가 `<` · `^` 하나면 이스케이프(칸 합치기 기호와 구별).
 * ctx="para": 문단이 블록 기호(#, >, -, |, 그림)로 시작하거나 가로줄(---)로 읽히면 이스케이프.
 * ctx="item": 항목이 `- ` 뒤에 붙어 가로줄로 읽히면 이스케이프.
 */
export function write(segs: Seg[], ctx: Ctx = null, dialect: Dialect = "ko"): string {
  const pieces: [boolean, string][] = []; // [기호인지, 글자]
  let cur: Style = [false, false, false, false, null];
  const off: Style = [false, false, false, false, null];
  for (const [st, text] of [...segs.map((s) => [style(s), s.text] as [Style, string]), [off, ""] as [Style, string]]) {
    const first = [0, 1, 2, 3, 4].find((i) => cur[i] !== st[i]);
    if (first !== undefined) {
      for (let j = 4; j >= first; j--) if (cur[j]) pieces.push([true, closeTag(j, cur[j], dialect)]);
      for (let j = first; j < 5; j++) if (st[j]) pieces.push([true, openTag(j, st[j], dialect)]);
    }
    if (text) pieces.push([false, text]);
    cur = st;
  }

  const raw = pieces.map((p) => p[1]).join("");
  const markup: boolean[] = []; // raw 의 글자마다: 우리가 넣은 기호인가
  const tokenAt = new Set<number>(); // 우리가 넣은 ** · ~~ 의 시작 자리
  for (const [isMarkup, text] of pieces) {
    if (isMarkup && (text === "**" || text === "~~")) tokenAt.add(markup.length);
    for (let k = 0; k < text.length; k++) markup.push(isMarkup);
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
      if (BR_AT.test(raw)) esc.add(p);
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
    // 글자로 쓴 * · ~ 가 서식 기호로 읽히면 그 자리만 이스케이프하고 다시 본다
    let offender: number[] = [];
    for (const t of scan(result)) {
      if (t.kind !== "bold" && t.kind !== "strike") continue;
      const p0 = origin[t.start];
      const p1 = origin[t.start + 1];
      if (tokenAt.has(p0)) continue; // 우리가 넣은 기호가 제자리에서 읽혔다
      const literal = [p0, p1].filter((p) => !markup[p]);
      if (literal.length < 2 || t.paired) {
        offender = literal;
        break;
      }
    }
    if (!offender.length) break;
    offender.forEach((p) => esc.add(p));
  }

  if (ctx === "cell" && (result === "<" || result === "^")) return "\\" + result;
  if (ctx === "para" && (PARA_BLOCK.test(result) || RULE.test(result))) return "\\" + result;
  if (ctx === "item" && ITEM_RULE.test(result)) return "\\" + result;
  return result;
}

/** 서식 문자열을 표준 꼴로. */
export function canon(s: string, ctx: Ctx = null, dialect: Dialect = "ko"): string {
  return write(normalize(segments(s)), ctx, dialect);
}

/** 서식을 뗀 글자만(줄바꿈은 공백). */
export function plainInline(s: string): string {
  return segments(s)
    .map((x) => x.text)
    .join("")
    .replace(SPACES, " ")
    .trim();
}

/** 칸 전체를 `{음영}…{/음영}` 으로 감쌌으면 [true, 속 내용] — 칸 배경이다. */
export function cellShade(s: string): [boolean, string] {
  const toks = scan(s);
  if (!toks.length) return [false, s];
  const first = toks[0];
  const last = toks[toks.length - 1];
  const whole =
    first.start === 0 &&
    first.kind === "open" &&
    first.value === "음영" &&
    first.paired &&
    last.end === s.length &&
    toks[first.partner] === last;
  return whole ? [true, s.slice(first.end, last.start)] : [false, s];
}
