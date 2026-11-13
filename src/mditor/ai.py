"""AI 수정 — MD 를 받아 MD 로 돌려준다(편집기 형식이 따로 없으므로 AI 경로도 하나다).

Claude 는 고친 섹션만(또는 문서 전체를) 돌려주고, 서버가 섹션 단위로 합친 뒤 되읽어 검사한다.
새로 나온 숫자는 따로 알려 준다 — 근거 없는 수치가 끼었는지 사람이 확인하도록.
"""

from __future__ import annotations

from typing import Any

from . import core, md
from .i18n import t
from .settings import Settings, syntax_guide


class AiError(RuntimeError):
    def __init__(self, message: str, status: int = 502) -> None:
        super().__init__(message)
        self.status = status


def system_prompt() -> str:
    return f"""You are the editing assistant inside MDitor, a document editor whose source format is a constrained \
Markdown dialect. People write formal documents (reports, plans, minutes; mostly Korean, some English) in it, and the same Markdown is \
rendered to a paginated PDF. You receive the current document and one editing instruction, and you return revised \
Markdown that the server merges back into the document.

The dialect, in full:

<syntax>
{syntax_guide()}
</syntax>

How to reply:
- Reply with Markdown only. No explanation before or after it, and no code fence around it.
- Start with one marker line that tells the server how to merge your reply.
  - `<!-- mditor:sections -->` when the change stays inside existing sections. After the marker, give only the \
sections you changed. Give each one in full, starting with its `## ` heading line copied exactly, because the server \
finds the section by that line and replaces the whole section with what you wrote.
  - `<!-- mditor:full -->` when you change the document title, rename, add, remove or reorder sections, or change \
text that sits above the first `## ` heading. After the marker, give the complete document.
- Change only what the instruction asks for. Copy everything else character for character: the editor tracks each \
block, so an untouched block must come back identical or it shows up as an edit the person never asked for.
- Keep the document's language and tone. Formal Korean reports are usually written in terse noun-ending or \
plain-form sentences; match what is already there.
- Formatting tags have Korean and English names that mean the same thing ({{빨강}} = {{red}}, {{파랑}} = {{blue}}, \
{{회색}} = {{gray}}, {{밑줄}} = {{underline}}, {{음영}} = {{shade}}). Use the names the document already uses.
- Every number, date and name must come from the document or the instruction. If the instruction asks for content \
you have no data for, write the sentence with `[확인 필요]` (in an English document, `[TBC]`) where the missing fact \
goes, so the person can fill it in.
- Stay inside the dialect. A table row must have as many cells as its header, and merged cells keep their `<` and \
`^` markers.
- If the instruction is not an editing request, or cannot be applied to this document, reply with \
`<!-- mditor:sections -->` and nothing else, which leaves the document unchanged."""


def revise(settings: Settings, text: str, instruction: str, base: Any = None) -> dict[str, Any]:
    """문서와 지시를 보내 고친 MD 를 받는다. 저장하지 않는다 — 화면이 검토 뒤 적용한다."""
    import anthropic

    if not settings.ai_enabled:
        raise AiError(t("AI 수정이 꺼져 있습니다."), 404)
    if len(text) > settings.ai_max_md_chars:
        raise AiError(t("AI 수정은 {limit}자까지의 문서에 쓸 수 있습니다.", limit=f"{settings.ai_max_md_chars:,}"), 413)
    instruction = instruction.strip()
    if not instruction:
        raise AiError(t("무엇을 고칠지 적어 주세요."), 422)

    client = anthropic.Anthropic()
    try:
        # 긴 문서는 응답도 길다 — 스트리밍으로 받아 시간 초과를 피한다.
        # fallbacks="default": 안전 분류기가 거절하면 같은 호출 안에서 대체 모델이 이어 받는다.
        with client.beta.messages.stream(
            model=settings.ai_model,
            max_tokens=64000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": settings.ai_effort},
            system=system_prompt(),
            messages=[
                {
                    "role": "user",
                    "content": f"<document>\n{text}\n</document>\n\n<instruction>\n{instruction[:4000]}\n</instruction>",
                }
            ],
        ) as stream:
            message = stream.get_final_message()
    except anthropic.RateLimitError as e:
        raise AiError(t("AI 사용량이 몰렸습니다. 잠시 뒤에 다시 해 주세요."), 429) from e
    except anthropic.APIStatusError as e:
        raise AiError(t("AI 호출에 실패했습니다({status}).", status=e.status_code), 502) from e
    except anthropic.APIConnectionError as e:
        raise AiError(t("AI 서버에 연결하지 못했습니다."), 502) from e

    if message.stop_reason == "refusal":
        raise AiError(t("AI 가 이 요청을 처리하지 않았습니다. 지시를 바꿔 다시 해 보세요."), 422)
    if message.stop_reason == "max_tokens":
        raise AiError(t("문서가 길어 끝까지 고치지 못했습니다. 섹션을 나눠 요청해 보세요."), 422)
    reply = "".join(block.text for block in message.content if block.type == "text")
    merged, touched = md.merge_sections(text, reply) if reply.strip() else (text, [])
    result = core.read(merged, base)
    if not result["ok"]:
        err = result["error"]
        raise AiError(
            t("AI 가 돌려준 글을 읽지 못했습니다({line}번째 줄: {message}). 다시 해 보세요.", line=err["line"], message=err["message"]),
            422,
        )
    return {
        "md": merged,
        "changed": merged.strip() != text.strip(),
        "sections": touched,
        "new_numbers": md.new_numbers(text, merged),
        "changes": result["changes"],
    }
