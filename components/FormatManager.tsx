"use client";

import { useState } from "react";
import type { Format } from "@/lib/types";

type Props = {
  formats: Format[];
  onChange: (formats: Format[]) => void;
  onClose: () => void;
};

type Draft = { id: string | null; name: string; instruction: string; example: string };

const EMPTY: Draft = { id: null, name: "", instruction: "", example: "" };
const fieldClass = "w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm";

export function FormatManager({ formats, onChange, onClose }: Props) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [defaultsNotice, setDefaultsNotice] = useState<{ text: string; failed: boolean } | null>(null);

  async function loadDefaults() {
    setDefaultsNotice(null);
    const res = await fetch("/api/formats/defaults", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setDefaultsNotice({ text: data?.error?.message ?? "기본 포맷을 불러오지 못했습니다.", failed: true });
      return;
    }
    const { formats: next, added } = data as { formats: Format[]; added: number };
    onChange(next);
    setDefaultsNotice({
      text: added > 0 ? `기본 포맷 ${added}개를 추가했습니다.` : "추가할 기본 포맷이 없습니다.",
      failed: false,
    });
  }

  async function save() {
    setError(null);
    const res = await fetch(draft.id ? `/api/formats/${draft.id}` : "/api/formats", {
      method: draft.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error?.message ?? "저장에 실패했습니다.");
      return;
    }
    const saved = data as Format;
    onChange(
      draft.id ? formats.map((f) => (f.id === saved.id ? saved : f)) : [...formats, saved],
    );
    setDraft(EMPTY);
  }

  async function remove(id: string) {
    setError(null);
    const res = await fetch(`/api/formats/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("삭제에 실패했습니다.");
      return;
    }
    onChange(formats.filter((f) => f.id !== id));
    if (draft.id === id) setDraft(EMPTY);
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-lg bg-white p-5">
        <div className="flex items-center">
          <h2 className="flex-1 text-base font-semibold">포맷 관리</h2>
          <button type="button" className="text-sm text-slate-500 hover:text-slate-900" onClick={onClose}>
            닫기
          </button>
        </div>

        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {formats.map((f) => (
            <li key={f.id} className="flex items-center gap-2 px-3 py-2">
              <span className="w-24 shrink-0 text-sm font-medium">{f.name}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-500">{f.instruction}</span>
              <button
                type="button"
                className="text-sm text-blue-700 hover:underline"
                onClick={() =>
                  setDraft({
                    id: f.id,
                    name: f.name,
                    instruction: f.instruction,
                    example: f.example ?? "",
                  })
                }
              >
                수정
              </button>
              <button
                type="button"
                className="text-sm text-red-700 hover:underline disabled:opacity-30"
                disabled={formats.length <= 1}
                onClick={() => remove(f.id)}
              >
                삭제
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-100"
            onClick={loadDefaults}
          >
            기본 포맷 불러오기
          </button>
          <p role="status" className={`text-sm ${defaultsNotice?.failed ? "text-red-700" : "text-slate-600"}`}>
            {defaultsNotice?.text}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{draft.id ? "포맷 수정" : "새 포맷"}</h3>
          <input
            className={fieldClass}
            placeholder="이름 (예: 주간보고)"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <textarea
            className={`${fieldClass} h-24`}
            placeholder="지시문: 이 포맷을 어떻게 써야 하는지 적어 주세요"
            value={draft.instruction}
            onChange={(e) => setDraft({ ...draft, instruction: e.target.value })}
          />
          <textarea
            className={`${fieldClass} h-24`}
            placeholder="예시 글 (선택): 이 포맷으로 쓴 글을 붙여 넣으면 구성을 따라 씁니다"
            value={draft.example}
            onChange={(e) => setDraft({ ...draft, example: e.target.value })}
          />
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            {draft.id && (
              <button
                type="button"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                onClick={() => setDraft(EMPTY)}
              >
                취소
              </button>
            )}
            <button
              type="button"
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
              disabled={!draft.name.trim() || !draft.instruction.trim()}
              onClick={save}
            >
              {draft.id ? "수정 저장" : "추가"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
