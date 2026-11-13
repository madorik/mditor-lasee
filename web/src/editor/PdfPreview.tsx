import { useEffect, useState } from "react";
import { t } from "../lib/i18n";

/** PDF 그대로 — 브라우저의 PDF 보기(iframe)에 넘긴다. */
export function PdfPreview({ blob, loading, error }: { blob: Blob | null; loading: boolean; error: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  if (error) {
    return (
      <div className="pdfview">
        <div className="hint">
          <strong>{t("PDF 를 만들지 못했습니다")}</strong>
          <span>{error}</span>
        </div>
      </div>
    );
  }
  if (!url) {
    return (
      <div className="pdfview">
        <div className="hint">{loading ? t("PDF 를 만드는 중입니다") : t("문서를 쓰면 PDF 가 여기에 보입니다")}</div>
      </div>
    );
  }
  return (
    <div className="pdfview">
      <iframe title={t("PDF 미리보기")} src={`${url}#view=FitH`} />
    </div>
  );
}
