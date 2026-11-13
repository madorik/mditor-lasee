import { Fragment, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { t } from "../lib/i18n";
import { imageSrc } from "../lib/images";
import { cellShade, INLINE_COLORS, segments, SHADE } from "../lib/inline";
import { pageBreaks, type BlockPages } from "../lib/pages";
import type { StoredImage } from "../lib/store";
import { spans } from "../lib/table";
import type { Block, Changes, Doc, Options, PageLayout, TableBlock } from "../lib/types";

const MM = 96 / 25.4;

export function paperSize(o: Options): [number, number] {
  const [w, h] = o.page === "Letter" ? [215.9, 279.4] : [210, 297];
  return o.landscape ? [h, w] : [w, h];
}

export function Inline({ s }: { s: string }) {
  const segs = useMemo(() => segments(s), [s]);
  return (
    <>
      {segs.map((seg, i) => {
        let node: ReactNode = seg.text.split("\n").map((line, k) => (
          <Fragment key={k}>
            {k > 0 && <br />}
            {line}
          </Fragment>
        ));
        if (seg.color) node = <span style={{ color: INLINE_COLORS[seg.color] }}>{node}</span>;
        if (seg.shade) node = <mark className="md-shade">{node}</mark>;
        if (seg.underline) node = <u>{node}</u>;
        if (seg.italic) node = <em>{node}</em>;
        if (seg.strike) node = <s>{node}</s>;
        if (seg.bold) node = <strong>{node}</strong>;
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}

function PageMark({ n }: { n: number }) {
  return (
    <div className="pagemark" role="separator" aria-label={t("여기부터 {n}쪽", { n })}>
      <span>{t("{n}쪽", { n })}</span>
    </div>
  );
}

function TableView({ b, pages }: { b: TableBlock; pages: BlockPages | undefined }) {
  const width = b.head[b.head.length - 1]?.length ?? 1;
  const rows = (grid: string[][], head: boolean) => {
    const sp = spans(grid);
    return grid.map((row, r) => (
      <Fragment key={r}>
        {!head && pages?.rows[r] && (
          <tr className="pagemark-row">
            <td colSpan={width}>
              <PageMark n={pages.rows[r]} />
            </td>
          </tr>
        )}
        <tr>
          {row.map((raw, c) => {
            if (sp[r][c].hidden) return null;
            const [shade, inner] = cellShade(raw);
            const align = b.align[c];
            const style: CSSProperties = {};
            if (shade) style.background = SHADE;
            if (align) style.textAlign = align;
            const Tag = head ? "th" : "td";
            return (
              <Tag key={c} rowSpan={sp[r][c].rowSpan} colSpan={sp[r][c].colSpan} style={sp[r][c].colSpan > 1 && head ? { ...style, textAlign: "center" } : style}>
                <Inline s={inner} />
              </Tag>
            );
          })}
        </tr>
      </Fragment>
    ));
  };
  return (
    <table>
      <thead>{rows(b.head, true)}</thead>
      <tbody>{rows(b.rows, false)}</tbody>
    </table>
  );
}

/** 그림. 올린 그림을 불러오지 못하면(지워졌거나 저장소가 꺼져 있으면) 없다고 알린다. */
function FigureView({ src, caption, images }: { src: string; caption: string; images: Record<string, StoredImage> }) {
  const url = imageSrc(src, images);
  const [broken, setBroken] = useState<string | null>(null);
  return (
    <figure className="md-image">
      {url && broken !== url ? <img src={url} alt={caption} onError={() => setBroken(url)} /> : <div className="image-missing">{t("그림 ‘{src}’ 이 이 문서에 없습니다", { src })}</div>}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

function BlockView({ b, pages, change, images }: { b: Block; pages: BlockPages | undefined; change: string | undefined; images: Record<string, StoredImage> }) {
  let body: ReactNode = null;
  if (b.kind === "text") {
    body = b.text ? (
      <p>
        <Inline s={b.text} />
      </p>
    ) : null;
  } else if (b.kind === "list") {
    body = (
      <div className="md-list">
        {b.items.map((it, i) => (
          <Fragment key={i}>
            {pages?.items[i] && <PageMark n={pages.items[i]} />}
            <div className="md-item" data-level={it.level}>
              <Inline s={it.text} />
            </div>
          </Fragment>
        ))}
      </div>
    );
  } else if (b.kind === "table") {
    body = <TableView b={b} pages={pages} />;
  } else {
    body = <FigureView src={b.src} caption={b.caption} images={images} />;
  }
  return (
    <>
      {pages?.before && <PageMark n={pages.before} />}
      <div className={`blk ${b.title ? "titled" : ""}`} data-change={change}>
        {b.title && (
          <h3>
            <Inline s={b.title} />
          </h3>
        )}
        {body}
        {b.notes.map((n, i) => (
          <div className="md-note" key={i}>
            <Inline s={n} />
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * 화면 미리보기 — 문서(JSON)를 HTML 로 그리고, 서버가 PDF 를 그려 본 쪽 배치로 'n쪽' 경계를 넣는다.
 * 쪽은 여기서 계산하지 않는다.
 */
export function Preview({ doc, layout, changes, images, options }: { doc: Doc; layout: PageLayout | null; changes: Changes | null; images: Record<string, StoredImage>; options: Options }) {
  const desk = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [wmm, hmm] = paperSize(options);
  useLayoutEffect(() => {
    const el = desk.current;
    if (!el) return;
    const fit = () => {
      const style = getComputedStyle(el);
      const avail = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      setZoom(Math.min(1, Math.max(0.3, avail / (wmm * MM))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [wmm]);

  const breaks = useMemo(() => pageBreaks(doc, layout), [doc, layout]);
  const changed = useMemo(() => {
    const m: Record<string, string> = {};
    changes?.added.forEach((id) => (m[id] = "added"));
    changes?.modified.forEach((id) => (m[id] = "modified"));
    return m;
  }, [changes]);
  const empty = !doc.title && !doc.sections.some((s) => s.title || s.blocks.length);
  const style = {
    width: `${wmm}mm`,
    minHeight: `${hmm}mm`,
    padding: `${options.margin_mm}mm`,
    zoom,
    "--doc-size": `${options.font_size}pt`,
    "--paper-pad": `${options.margin_mm}mm`,
  } as CSSProperties;

  return (
    <div className="desk" ref={desk}>
      <article className="paper docstyle" style={style} aria-label={t("문서 미리보기")}>
        {layout && layout.total > 1 && <span className="first-page">{t("{n}쪽", { n: 1 })}</span>}
        {doc.title && (
          <h1>
            <Inline s={doc.title} />
          </h1>
        )}
        {empty && <p style={{ color: "#9aa4ad" }}>{t("왼쪽에 글을 쓰면 여기에 보입니다.")}</p>}
        {doc.sections.map((s) => (
          <section key={s.key}>
            {breaks.sections[s.key] && <PageMark n={breaks.sections[s.key]} />}
            {s.title && (
              <h2>
                <Inline s={s.title} />
              </h2>
            )}
            {s.blocks.map((b) => (
              <BlockView key={b.id} b={b} pages={breaks.blocks[b.id]} change={changed[b.id]} images={images} />
            ))}
          </section>
        ))}
      </article>
      {layout && <p className="paper-foot">{layout.total === 1 ? t("PDF 로 내면 1쪽입니다. 쪽 경계는 PDF 를 실제로 그려 본 자리입니다.") : t("PDF 로 내면 {n}쪽입니다. 쪽 경계는 PDF 를 실제로 그려 본 자리입니다.", { n: layout.total })}</p>}
    </div>
  );
}
