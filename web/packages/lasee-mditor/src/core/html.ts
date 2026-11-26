// 문서 → HTML(미리보기). 서버 없이 그린다. 링크는 열어도 되는 주소만 단다(javascript: 같은 것은 글자로).

import { cellShade, colorCss, MARK, safeHref, segments, SHADE } from "./inline";
import { parseMarkdown } from "./parse";
import { spans } from "./table";
import type { Block, Doc, Item, TableBlock } from "./types";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]);

export type HtmlOptions = {
  /** 그림 이름 → 주소. 없으면 이름을 그대로 쓴다. */
  resolveImage?: (src: string) => string | undefined;
  /** 링크를 새 창으로 연다(기본 true). */
  linkTarget?: "_blank" | null;
};

/** 그림 주소 → 화면에 그릴 주소(열어도 되는 것만). */
export function imageUrl(src: string, o: HtmlOptions = {}): string | null {
  const url = o.resolveImage?.(src) ?? src;
  return url && (url.startsWith("blob:") || url.startsWith("data:image/") ? url : safeHref(url));
}

const IMG_MARGIN: Record<string, string> = { center: "margin-left:auto;margin-right:auto", right: "margin-left:auto" };

/** 칸 안의 그림 — 한 줄을 차지하고(display:block), 폭은 칸 폭의 %. 가로 자리는 열 정렬을 따른다. */
function cellImageHtml(src: string, alt: string, width: number | undefined, align: string | null | undefined, o: HtmlOptions): string {
  const url = imageUrl(src, o);
  const style = ["display:block", "max-width:100%", "height:auto", width ? `width:${width}%` : "", align ? (IMG_MARGIN[align] ?? "") : ""].filter(Boolean).join(";");
  return url
    ? `<img class="md-cell-image" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" style="${style}">`
    : `<span class="md-cell-image md-image-missing" style="${style}">${escapeHtml(alt || src)}</span>`;
}

/** 서식 문자열 → HTML. images: 표 칸(그림도 읽는다), align: 칸의 정렬(그림의 가로 자리). */
export function inlineHtml(s: string, o: HtmlOptions = {}, images = false, align: string | null = null): string {
  let out = "";
  for (const seg of segments(s, images)) {
    if (seg.image !== undefined) {
      out += cellImageHtml(seg.image, seg.text, seg.width, align, o);
      continue;
    }
    let h = escapeHtml(seg.text).replace(/\n/g, "<br>");
    if (seg.code) h = `<code>${h}</code>`;
    if (seg.script) h = `<${seg.script}>${h}</${seg.script}>`;
    if (seg.color) h = `<span style="color:${escapeHtml(colorCss(seg.color))}">${h}</span>`;
    if (seg.mark) h = `<mark class="md-mark" style="background:${MARK}">${h}</mark>`;
    if (seg.shade) h = `<mark class="md-shade" style="background:${SHADE}">${h}</mark>`;
    if (seg.underline) h = `<u>${h}</u>`;
    if (seg.italic) h = `<em>${h}</em>`;
    if (seg.strike) h = `<s>${h}</s>`;
    if (seg.bold) h = `<strong>${h}</strong>`;
    if (seg.link) {
      const href = safeHref(seg.link);
      const target = o.linkTarget === null ? "" : ' target="_blank" rel="noopener noreferrer nofollow"';
      h = href ? `<a href="${escapeHtml(href)}"${target}>${h}</a>` : h;
    }
    out += h;
  }
  return out;
}

/** 목록 항목 번호 — MD 로 쓸 때와 같은 규칙(구간마다 start 또는 1부터). */
export function itemNumbers(items: Item[]): (number | null)[] {
  let nums: (number | null)[] = [];
  return items.map((it) => {
    const level = it.level;
    nums = nums.slice(0, level + 1);
    while (nums.length < level + 1) nums.push(null);
    if (!it.ordered) {
      nums[level] = null;
      return null;
    }
    const prev = nums[level];
    const n = prev !== null ? prev + 1 : (it.start ?? 1);
    nums[level] = n;
    return n;
  });
}

function tableHtml(b: TableBlock, o: HtmlOptions): string {
  const part = (grid: string[][], head: boolean) => {
    const sp = spans(grid);
    return grid
      .map((row, r) => {
        const cells = row
          .map((raw, c) => {
            if (sp[r][c].hidden) return "";
            const [shade, inner] = cellShade(raw);
            const styles: string[] = [];
            if (shade) styles.push(`background:${SHADE}`);
            const align = sp[r][c].colSpan > 1 && head ? "center" : b.align[c];
            if (align) styles.push(`text-align:${align}`);
            const attrs = [sp[r][c].rowSpan > 1 ? ` rowspan="${sp[r][c].rowSpan}"` : "", sp[r][c].colSpan > 1 ? ` colspan="${sp[r][c].colSpan}"` : "", styles.length ? ` style="${styles.join(";")}"` : ""].join("");
            const tagName = head ? "th" : "td";
            return `<${tagName}${attrs}>${inlineHtml(inner, o, true, align)}</${tagName}>`;
          })
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");
  };
  return `<table><thead>${part(b.head, true)}</thead><tbody>${part(b.rows, false)}</tbody></table>`;
}

export function blockHtml(b: Block, o: HtmlOptions = {}): string {
  let body = "";
  switch (b.kind) {
    case "text":
      if (b.text) body = `<p${b.align ? ` style="text-align:${b.align}"` : ""}>${inlineHtml(b.text, o)}</p>`;
      break;
    case "list": {
      const nums = itemNumbers(b.items);
      body = `<ul class="md-list">${b.items
        .map((it, i) => {
          const attrs = [`data-level="${it.level}"`, nums[i] !== null ? `data-ordered="true" data-num="${nums[i]}"` : "", it.checked !== undefined ? `data-checked="${it.checked}"` : ""].filter(Boolean).join(" ");
          const box = it.checked !== undefined ? `<span class="md-check" role="img" aria-label="${it.checked ? "☑" : "☐"}"></span>` : "";
          return `<li ${attrs}>${box}<div class="md-item-body">${inlineHtml(it.text, o)}</div></li>`;
        })
        .join("")}</ul>`;
      break;
    }
    case "table":
      body = tableHtml(b, o);
      break;
    case "image": {
      const safe = imageUrl(b.src, o);
      const style = b.width ? ` style="width:${b.width}%"` : "";
      body = `<figure class="md-image">${safe ? `<img src="${escapeHtml(safe)}" alt="${escapeHtml(b.caption)}"${style}>` : ""}${b.caption ? `<figcaption>${escapeHtml(b.caption)}</figcaption>` : ""}</figure>`;
      break;
    }
    case "code":
      body = `<pre class="md-code"${b.lang ? ` data-lang="${escapeHtml(b.lang)}"` : ""}><code${b.lang ? ` class="language-${escapeHtml(b.lang)}"` : ""}>${escapeHtml(b.code)}</code></pre>`;
      break;
    case "rule":
      body = `<hr class="md-rule">`;
      break;
    case "pagebreak":
      body = `<div class="md-pagebreak" data-page-break=""></div>`;
      break;
  }
  const title = b.title ? `<h3>${inlineHtml(b.title, o)}</h3>` : "";
  const notes = b.notes.map((n) => `<div class="md-note">${inlineHtml(n, o)}</div>`).join("");
  return `<div class="blk${b.title ? " titled" : ""}" data-kind="${b.kind}">${title}${body}${notes}</div>`;
}

/** 문서(또는 MD) → HTML. */
export function renderHtml(doc: Doc | string, o: HtmlOptions = {}): string {
  const d = typeof doc === "string" ? parseMarkdown(doc) : doc;
  let out = d.title ? `<h1>${inlineHtml(d.title, o)}</h1>` : "";
  for (const s of d.sections) {
    out += "<section>";
    if (s.title) out += `<h2>${inlineHtml(s.title, o)}</h2>`;
    for (const b of s.blocks) out += blockHtml(b, o);
    out += "</section>";
  }
  return out;
}
