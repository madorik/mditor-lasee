// 한국어 편집기에서 '내보내기'(PDF · MD · 링크)를 하면 열리는 안내 창 — 안에 쿠팡 배너(lib/banners.ts 의 export 자리)를 둔다.
// 사용자가 내보내기를 눌러서 연 창 안의 배너이고, 쿠팡 스크립트는 이 창이 열릴 때만 불러온다(편집기를 열 때는 싣지 않는다).
// 영어 편집기와 배너 코드가 없을 때는 창을 열지 않는다(내보내기는 예전처럼 바로 한다). 자동화 브라우저(e2e)에도 열지 않는다.
// 주소에 ?ads=demo 를 붙이면 자리만 보여 준다.
// 이 파일의 글은 한국어에서만 보이므로 번역 함수를 쓰지 않는다(영어 사전에 넣을 것이 없다).
import { useEffect, useRef } from "react";
import { liveBanners, SIZES } from "../lib/banners";
import { mountBanner } from "../lib/coupangMount";
import { lang } from "../lib/i18n";
import { DISCLOSURE } from "../lib/picks";
import "../styles/banners.css";
import { Modal } from "./ui";

const ADS = new URLSearchParams(location.search).get("ads");
const banner = () => liveBanners("export")[0] ?? null;

/** 내보낼 때 안내 창(광고)을 띄울지 */
export function exportAdOn(): boolean {
  if (lang !== "ko") return false;
  if (ADS === "demo") return true;
  return !navigator.webdriver && banner() !== null;
}

export function ExportAdDialog({ message, onClose }: { message: string; onClose: () => void }) {
  const live = banner();
  const [width, height] = live ? [live.width, live.height] : SIZES.export;
  const wrap = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  useEffect(() => {
    const b = box.current;
    const w = wrap.current;
    if (!b || !w) return;
    if (live && !started.current) {
      started.current = true; // 개발 모드(StrictMode)에서 두 번 돌아도 배너는 한 번만 심는다
      mountBanner(b, live.html);
    }
    // 창이 좁으면 배너를 줄여서 맞춘다
    const fit = () => {
      const s = Math.min(1, w.clientWidth / width);
      b.style.transform = s < 1 ? `scale(${s})` : "";
      w.style.height = `${Math.round(height * s)}px`;
    };
    const ro = new ResizeObserver(fit);
    ro.observe(w);
    fit();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Modal title="내보내기" wide onClose={onClose} footer={<button type="button" className="btn primary" onClick={onClose}>닫기</button>}>
      <p role="status">{message}</p>
      <div className="exportad">
        <span className="ad-tag">광고</span>
        <div ref={wrap} className="adfit">
          <div ref={box} className={live ? "adframe adbox" : "adframe demo"} style={{ width, height, transformOrigin: "top left" }}>
            {live ? null : `광고 자리 ${width}×${height}`}
          </div>
        </div>
        <p className="ad-note">{DISCLOSURE}</p>
      </div>
    </Modal>
  );
}
