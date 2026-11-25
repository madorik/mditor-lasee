import { DEFAULT_TOOLBAR, type MarkdownEditor, type PageMarks, type ToolbarItem } from "@mditor/editor";
import "@mditor/editor/style.css";
import { MarkdownEditorView } from "@mditor/editor/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lang } from "../lib/i18n";
import { imageSrc } from "../lib/images";
import type { Dialect } from "@mditor/editor/core";
import type { StoredImage } from "../lib/store";
import type { Doc, Options } from "../lib/types";
import { FontPicker } from "./Dialogs";

/** 바깥(Workspace)에서 그림을 다루는 손잡이 — 넣기, 주소 바꾸기(올리기가 끝나면 blob: → 저장소 주소, null 이면 뺀다). */
export type ImageApi = { insert: (src: string) => void; replace: (from: string, to: string | null) => void };

// 이 서비스의 도구 막대 — MD 원문 · 미리보기는 화면의 탭과 오른쪽 창이 맡으므로 뺀다. 글꼴 칸은 블록 종류 옆에 둔다.
const HIDDEN = new Set(["source", "preview", "fullscreen"]);

/**
 * 문서 탭 — 보이는 모양 그대로 고친다(편집기 패키지 @mditor/editor).
 * 서버가 되읽은 문서(doc)로 열고, 고칠 때마다 MD 로 직렬화해 올린다. 밖에서 MD 가 바뀌면 부모가 key 를 올려 새로 연다.
 */
export default function RichEditor({ doc, dialect, pageMarks, showPageMarks, images, options, onOptions, onChange, onPickImage, onImageFile, register }: { doc: Doc; dialect: Dialect; pageMarks: PageMarks | null; showPageMarks: boolean; images: Record<string, StoredImage>; options: Options; onOptions: (o: Options) => void; onChange: (md: string) => void; onPickImage: () => void; onImageFile: (file: File) => void; register: (api: ImageApi | null) => void }) {
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const pick = useRef(onPickImage);
  pick.current = onPickImage;
  const onFile = useRef(onImageFile);
  onFile.current = onImageFile;
  const [editor, setEditor] = useState<MarkdownEditor | null>(null);
  const [fontSlot] = useState(() => document.createElement("span"));

  const toolbar = useMemo<ToolbarItem[]>(() => {
    const out: ToolbarItem[] = [];
    for (const it of DEFAULT_TOOLBAR) {
      if (typeof it === "string" && HIDDEN.has(it)) continue;
      out.push(it);
      if (it === "blockKind") out.push({ name: "font", render: () => (fontSlot.className = "mde-group", fontSlot) });
    }
    while (out[out.length - 1] === "|") out.pop();
    return out;
  }, [fontSlot]);

  useEffect(() => {
    if (!editor) return;
    register({ insert: (src) => editor.insertImage(src), replace: (from, to) => editor.replaceImage(from, to) });
    return () => register(null);
  }, [editor, register]);

  // 자동 쪽 나눔 — 서버가 PDF 를 그려 본 쪽 배치(Workspace 가 순번으로 옮긴 것)
  useEffect(() => {
    editor?.setPageMarksVisible(showPageMarks);
  }, [editor, showPageMarks]);
  useEffect(() => {
    editor?.setPageMarks(pageMarks);
  }, [editor, pageMarks]);

  // 그림이 늦게 붙으면(이름만 먼저 들어간 경우) 다시 그린다
  useEffect(() => {
    editor?.refreshImages();
  }, [editor, images]);

  return (
    <>
      <MarkdownEditorView
        className="rich"
        doc={doc}
        dialect={dialect}
        locale={lang}
        contentClass="docstyle"
        toolbar={toolbar}
        image={{ resolve: (src) => imageSrc(src, imagesRef.current), pick: () => pick.current(), onFiles: (files) => files.forEach((f) => onFile.current(f)) }}
        onChange={onChange}
        onReady={setEditor}
      />
      {createPortal(<FontPicker options={options} onChange={onOptions} />, fontSlot)}
    </>
  );
}
