"use client";

import { useState } from "react";

type Props = {
  output: string;
  busy: boolean;
  error: string | null;
  canRefine: boolean;
  onRetry: () => void;
  onRefine: (instruction: string) => void;
};

const QUICK = ["더 짧게", "더 공손하게"];

export function ResultPanel({ output, busy, error, canRefine, onRetry, onRefine }: Props) {
  const [instruction, setInstruction] = useState("");
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

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
        {output ? (
          <pre className="whitespace-pre-wrap pr-14 font-sans text-sm">{output}</pre>
        ) : (
          <p className="text-sm text-slate-400">
            {busy ? "작성 중..." : "작성한 글이 여기에 나옵니다."}
          </p>
        )}
        {output && !busy && (
          <button
            type="button"
            className="absolute right-2 top-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100"
            onClick={copy}
          >
            {copied ? "복사됨" : "복사"}
          </button>
        )}
      </div>
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
              if (e.key === "Enter" && !e.nativeEvent.isComposing) submitRefine();
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
