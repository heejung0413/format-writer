"use client";

import { useEffect, useState } from "react";
import type { Settings } from "@/lib/types";

type Props = {
  onClose: () => void;
};

const SIGNATURE_MAX = 500;
const LOAD_FAILED = "설정을 불러오지 못했습니다.";

export function SettingsModal({ onClose }: Props) {
  const [signature, setSignature] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((res) => {
        if (!res.ok) throw new Error(LOAD_FAILED);
        return res.json() as Promise<Settings>;
      })
      .then((settings) => {
        if (cancelled) return;
        setSignature(settings.signature);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setError(LOAD_FAILED);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? "저장하지 못했습니다.");
        return;
      }
      onClose();
    } catch {
      setError("저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="flex max-h-full w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-lg bg-white p-5"
      >
        <div className="flex items-center">
          <h2 id="settings-title" className="flex-1 text-base font-semibold">
            설정
          </h2>
          <button type="button" className="text-sm text-slate-500 hover:text-slate-900" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="settings-signature" className="text-sm font-medium">
            서명
          </label>
          <textarea
            id="settings-signature"
            className="h-28 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
            placeholder="메일 끝에 넣을 서명을 적어 주세요 (예: 이름, 소속, 연락처)"
            maxLength={SIGNATURE_MAX}
            disabled={!loaded}
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
          />
          <p className="text-xs text-slate-500">
            서명이 어울리는 글(메일 등)에만 들어갑니다. 최대 {SIGNATURE_MAX}자.
          </p>
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end">
          <button
            type="button"
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
            disabled={!loaded || saving}
            onClick={save}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
