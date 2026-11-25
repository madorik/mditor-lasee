// MD 탭(글 편집)의 도구 — 고른 글에 기호를 입히거나 표·줄바꿈을 넣는다.

export type Edit = { start: number; end: number; text: string; selStart: number; selEnd: number };

/** 고른 글을 여닫는 기호로 감싼다. 이미 감싸여 있으면 벗긴다. 앞뒤 공백은 기호 밖에 둔다. */
export function wrapSelection(text: string, start: number, end: number, open: string, close: string): Edit {
  const sel = text.slice(start, end);
  if (text.slice(start - open.length, start) === open && text.slice(end, end + close.length) === close) {
    return { start: start - open.length, end: end + close.length, text: sel, selStart: start - open.length, selEnd: end - open.length };
  }
  if (sel.startsWith(open) && sel.endsWith(close) && sel.length >= open.length + close.length) {
    const inner = sel.slice(open.length, sel.length - close.length);
    return { start, end, text: inner, selStart: start, selEnd: start + inner.length };
  }
  if (!sel) return { start, end, text: open + close, selStart: start + open.length, selEnd: start + open.length };
  const lead = sel.length - sel.trimStart().length;
  const trail = sel.length - sel.trimEnd().length;
  const core = sel.slice(lead, sel.length - trail);
  if (!core) return { start, end, text: sel, selStart: start, selEnd: end };
  const out = sel.slice(0, lead) + open + core + close + sel.slice(sel.length - trail);
  return { start, end, text: out, selStart: start + lead + open.length, selEnd: start + lead + open.length + core.length };
}

/** 커서 자리에 줄바꿈(<br>)을 넣는다. */
export function insertBreak(start: number, end: number): Edit {
  return { start, end, text: "<br>", selStart: start + 4, selEnd: start + 4 };
}

const LINE_MARK = /^(#{1,6}|[-*+](?:[ \t]+\[[ xX]\])?|\d{1,9}[.)](?:[ \t]+\[[ xX]\])?|>)[ \t]+/;

/** 커서가 있는 줄의 앞에 기호를 붙인다(목록 `- `, 번호 `1. `, 할 일 `- [ ] `, 비고 `> `, 제목 `## `). 이미 있으면 뗀다. */
export function prefixLines(text: string, start: number, end: number, prefix: string): Edit {
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const stop = text.indexOf("\n", end);
  const to = stop < 0 ? text.length : stop;
  const lines = text.slice(from, to).split("\n");
  const all = lines.every((l) => !l.trim() || l.startsWith(prefix));
  const out = lines.map((l) => (!l.trim() ? l : all ? l.slice(prefix.length) : prefix + l.replace(LINE_MARK, ""))).join("\n");
  return { start: from, end: to, text: out, selStart: from, selEnd: from + out.length };
}

/** 커서 아래에 3×3 표를 넣는다. */
export function insertTable(text: string, start: number): Edit {
  const stop = text.indexOf("\n", start);
  const at = stop < 0 ? text.length : stop;
  const table = "\n\n| 구분 | 항목 | 값 |\n|:---|:---|---:|\n|  |  |  |\n|  |  |  |\n";
  return { start: at, end: at, text: table, selStart: at + 4, selEnd: at + 6 };
}

/** 줄 번호(1부터)의 글자 범위. */
export function lineRange(text: string, line: number): [number, number] {
  let from = 0;
  for (let i = 1; i < line; i++) {
    const next = text.indexOf("\n", from);
    if (next < 0) break;
    from = next + 1;
  }
  const stop = text.indexOf("\n", from);
  return [from, stop < 0 ? text.length : stop];
}

/** 고른 글을 링크로 — `[글](https://)` 을 넣고 주소 자리를 골라 둔다. */
export function insertLink(text: string, start: number, end: number, label: string): Edit {
  const sel = text.slice(start, end).replace(/\n/g, " ") || label;
  const out = `[${sel}](https://)`;
  const at = start + sel.length + 3;
  return { start, end, text: out, selStart: at, selEnd: at + 8 };
}

/** 고른 줄들을 코드 블록(```)으로 감싼다. 고른 것이 없으면 지금 줄 아래에 빈 코드 블록을 넣고 그 안에 커서를 둔다. */
export function insertCodeBlock(text: string, start: number, end: number): Edit {
  if (start === end) {
    const stop = text.indexOf("\n", start);
    const at = stop < 0 ? text.length : stop;
    return { start: at, end: at, text: "\n\n```\n\n```", selStart: at + 6, selEnd: at + 6 };
  }
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const stop = text.indexOf("\n", end);
  const to = stop < 0 ? text.length : stop;
  const body = text.slice(from, to);
  return { start: from, end: to, text: "```\n" + body + "\n```", selStart: from + 4, selEnd: from + 4 + body.length };
}

/** 커서가 있는 줄 아래에 블록 한 줄(가로줄 · 쪽 나눔)을 넣는다. */
export function insertBlockLine(text: string, start: number, line: string): Edit {
  const stop = text.indexOf("\n", start);
  const at = stop < 0 ? text.length : stop;
  const out = `\n\n${line}\n`;
  return { start: at, end: at, text: out, selStart: at + out.length, selEnd: at + out.length };
}
