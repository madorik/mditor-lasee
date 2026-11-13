import { LANG_NAMES, langPath, localPath, otherLang, t } from "../lib/i18n";
import { MOD } from "./ui";

/** 보관한 문서가 하나도 없을 때의 첫 화면 — 새 문서 · 파일 열기 · 예시 보기. */
export function Start({ onNew, onOpen, onExample }: { onNew: () => void; onOpen: () => void; onExample: () => void }) {
  return (
    <div className="start-page">
      <header className="top">
        <a className="brand" href={localPath("/")} title={t("MDitor 첫 화면")}>
          MD<i>itor</i>
        </a>
        <span className="spacer" />
        <a className="btn quiet" href={localPath("/syntax")} target="_blank" rel="noreferrer">
          {t("문법 안내")}
        </a>
        <a className="btn quiet" href={langPath(otherLang, "/edit")} hrefLang={otherLang} lang={otherLang}>
          {LANG_NAMES[otherLang]}
        </a>
      </header>
      <main className="start">
        <h1>{t("무엇으로 시작할까요?")}</h1>
        <p className="lead">{t("문서는 이 브라우저에만 보관됩니다. 서버에는 남지 않습니다.")}</p>
        <div className="choices">
          <button type="button" className="choice" data-act="new" onClick={onNew}>
            <strong>{t("새 문서")}</strong>
            <span>{t("빈 문서에서 시작합니다.")}</span>
          </button>
          <button type="button" className="choice" data-act="open" onClick={onOpen}>
            <strong>
              {t("파일 열기")} <kbd>{MOD}O</kbd>
            </strong>
            <span>{t("내 컴퓨터의 MD 파일(.md)을 엽니다. 이 창에 끌어다 놓아도 됩니다.")}</span>
          </button>
          <button type="button" className="choice" data-act="example" onClick={onExample}>
            <strong>{t("예시 보기")}</strong>
            <span>{t("분기 보고서 예시로 표 · 목록 · 쪽 나눔을 둘러봅니다. 저장하기 전에는 내 문서에 남지 않습니다.")}</span>
          </button>
        </div>
      </main>
    </div>
  );
}
