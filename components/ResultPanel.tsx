"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { useIsMac } from "@/lib/platform";

type Props = {
  output: string;
  busy: boolean;
  error: string | null;
  canRefine: boolean;
  /** 글을 모두 지워 output이 빈 문자열이어도 결과 입력 칸을 남길지. 기본은 output이 있을 때만 보인다. */
  hasResult?: boolean;
  saveStatus?: "saved" | "failed" | null;
  onRetry: () => void;
  onRefine: (instruction: string) => void;
  onEdit: (text: string) => void;
};

const QUICK = ["더 짧게", "더 공손하게"];

const SAVE_STATUS_TEXT = { saved: "저장됨", failed: "저장하지 못했습니다." } as const;

export function ResultPanel({
  output,
  busy,
  error,
  canRefine,
  hasResult = output !== "",
  saveStatus = null,
  onRetry,
  onRefine,
  onEdit,
}: Props) {
  const mac = useIsMac();
  const [instruction, setInstruction] = useState("");
  const [copied, setCopied] = useState(false);
  const canCopy = output !== "" && !busy;

  async function copy() {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const onShortcut = useEffectEvent((e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey || e.key.toLowerCase() !== "c") return;
    if (!canCopy) return;
    e.preventDefault();
    void copy();
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => onShortcut(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function submitRefine() {
    const text = instruction.trim();
    if (!text) return;
    onRefine(text);
    setInstruction("");
  }

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <div className="flex items-center gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          <span className="flex-1">{error}</span>
          <button type="button" className="underline" onClick={onRetry}>
            다시 시도
          </button>
        </div>
      )}
      <div className="relative min-h-40 rounded-md border border-slate-300 bg-white p-3">
        {hasResult ? (
          <textarea
            aria-label="결과"
            className="field-sizing-content block min-h-32 w-full resize-none bg-transparent pr-28 font-sans text-sm outline-none"
            value={output}
            readOnly={busy}
            onChange={(e) => onEdit(e.target.value)}
          />
        ) : (
          <p className="text-sm text-slate-400">
            {busy ? "작성 중..." : "작성한 글이 여기에 나옵니다."}
          </p>
        )}
        {canCopy && (
          <button
            type="button"
            className="absolute right-2 top-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100"
            onClick={copy}
          >
            {copied ? (
              "복사됨"
            ) : (
              <>
                복사
                <kbd aria-hidden="true" className="ml-1.5 font-sans text-[10px] text-slate-500">
                  {mac ? "⌘⇧C" : "Ctrl+Shift+C"}
                </kbd>
              </>
            )}
          </button>
        )}
      </div>
      {hasResult && (
        <p role="status" className={`h-4 text-xs ${saveStatus === "failed" ? "text-red-700" : "text-slate-500"}`}>
          {saveStatus ? SAVE_STATUS_TEXT[saveStatus] : ""}
        </p>
      )}
      {canRefine && (
        <div className="flex flex-wrap items-center gap-2">
          {QUICK.map((label) => (
            <button
              key={label}
              type="button"
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-100"
              onClick={() => onRefine(label)}
            >
              {label}
            </button>
          ))}
          <input
            className="min-w-40 flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
            placeholder="수정 지시를 입력하세요 (예: 마지막 문단 빼 줘)"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              // Ctrl/⌘+Enter는 작성하기 단축키의 몫이라 여기서 다듬기로 제출하지 않는다.
              if (e.key === "Enter" && !e.nativeEvent.isComposing && !e.ctrlKey && !e.metaKey) submitRefine();
            }}
          />
          <button
            type="button"
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
            disabled={!instruction.trim()}
            onClick={submitRefine}
          >
            다듬기
          </button>
        </div>
      )}
    </div>
  );
}
