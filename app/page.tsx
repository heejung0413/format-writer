"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { FormatManager } from "@/components/FormatManager";
import { HistoryList } from "@/components/HistoryList";
import { InputPanel } from "@/components/InputPanel";
import { OptionBar } from "@/components/OptionBar";
import { ResultPanel } from "@/components/ResultPanel";
import { SettingsModal } from "@/components/SettingsModal";
import { LENGTHS, RECIPIENTS, TONES } from "@/lib/defaults";
import { readStreamLines } from "@/lib/ndjson";
import type { ChatMessage, Format, HistoryItem } from "@/lib/types";

const JSON_HEADERS = { "Content-Type": "application/json" };
const INTERRUPTED = "작성이 중간에 끊겼습니다.";
const LOAD_FAILED = "저장된 포맷과 기록을 불러오지 못했습니다.";
const SAVE_DELAY_MS = 1000;

type PendingSave = { id: string; text: string; timer: ReturnType<typeof setTimeout> };
type SaveStatus = { id: string; ok: boolean };

function fetchSaved(): Promise<[Format[], HistoryItem[]]> {
  return Promise.all([
    fetch("/api/formats").then((r) => r.json() as Promise<Format[]>),
    fetch("/api/history").then((r) => r.json() as Promise<HistoryItem[]>),
  ]);
}

export default function Home() {
  const [formats, setFormats] = useState<Format[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [formatId, setFormatId] = useState("");
  const [recipient, setRecipient] = useState<string>(RECIPIENTS[0]);
  const [tone, setTone] = useState<string>(TONES[1]);
  const [length, setLength] = useState<string>(LENGTHS[1]);
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showManager, setShowManager] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastRunRef = useRef<{ messages: ChatMessage[]; refine: boolean } | null>(null);
  const pendingSaveRef = useRef<PendingSave | null>(null);
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const mountedRef = useRef(false);

  function applyLoaded([formatList, historyList]: [Format[], HistoryItem[]]) {
    setFormats(formatList);
    setHistory(historyList);
    setFormatId((current) => current || formatList[0]?.id || "");
  }

  useEffect(() => {
    fetchSaved()
      .then(applyLoaded)
      .catch(() => setError(LOAD_FAILED));
  }, []);

  const onShortcut = useEffectEvent((e: KeyboardEvent) => {
    const generateKey = e.key === "Enter" && !e.shiftKey && !e.altKey && !e.repeat && !e.isComposing;
    if (!generateKey || !(e.metaKey || e.ctrlKey)) return;
    if (busy || showManager || showSettings || input.trim() === "" || formatId === "") return;
    e.preventDefault();
    generate();
  });

  const flushOnUnload = useEffectEvent(() => {
    const pending = pendingSaveRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingSaveRef.current = null;
    void fetch(`/api/history/${pending.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ output: pending.text }),
      keepalive: true,
    }).catch(() => {});
  });

  useEffect(() => {
    mountedRef.current = true;
    const onKeyDown = (e: KeyboardEvent) => onShortcut(e);
    const onPageHide = () => flushOnUnload();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pagehide", onPageHide);
      flushOnUnload();
    };
  }, []);

  /** 기록 PATCH는 한 줄로 세워 보낸다. 고친 글 저장이 다듬은 결과 저장을 뒤늦게 덮어쓰지 못한다. */
  function enqueueSave<T>(task: () => Promise<T>): Promise<T> {
    const next = saveChainRef.current.then(task);
    saveChainRef.current = next.catch(() => {});
    return next;
  }

  function patchOutput(id: string, text: string): Promise<HistoryItem | null> {
    return enqueueSave(async () => {
      const res = await fetch(`/api/history/${id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ output: text }),
      });
      return res.ok ? ((await res.json()) as HistoryItem) : null;
    });
  }

  function applySaved(updated: HistoryItem) {
    setHistory((list) => list.map((h) => (h.id === updated.id ? updated : h)));
  }

  function cancelPendingSave() {
    if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current.timer);
    pendingSaveRef.current = null;
  }

  /** 기다리던 저장을 그 자리에서 보낸다. 결과는 저장하려던 기록(id)에 대해서만 반영하고, 저장됨 표시는 report일 때만 한다. */
  function flushPendingSave(report = false) {
    const pending = pendingSaveRef.current;
    if (!pending) return;
    cancelPendingSave();
    const before = history.find((h) => h.id === pending.id);
    setHistory((list) => list.map((h) => (h.id === pending.id ? { ...h, output: pending.text } : h)));
    patchOutput(pending.id, pending.text)
      .catch(() => null)
      .then((updated) => {
        if (!mountedRef.current) return;
        if (updated) applySaved(updated);
        else if (before) applySaved(before);
        if (report) setSaveStatus({ id: pending.id, ok: updated !== null });
      });
  }

  function editOutput(text: string) {
    setOutput(text);
    setMessages((list) => {
      const last = list[list.length - 1];
      return last?.role === "assistant" ? [...list.slice(0, -1), { role: "assistant", content: text }] : list;
    });
    setSaveStatus(null);
    cancelPendingSave();
    if (!historyId || text.trim() === "") return;
    const id = historyId;
    const timer = setTimeout(() => flushPendingSave(true), SAVE_DELAY_MS);
    pendingSaveRef.current = { id, text, timer };
  }

  async function saveHistory(text: string, refine: boolean) {
    if (refine && historyId) {
      const updated = await patchOutput(historyId, text);
      if (updated) applySaved(updated);
      return;
    }
    const format = formats.find((f) => f.id === formatId);
    const res = await fetch("/api/history", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        formatId,
        formatName: format?.name ?? "",
        recipient,
        tone,
        length,
        input: input.trim(),
        output: text,
      }),
    });
    if (!res.ok) return;
    const created = (await res.json()) as HistoryItem;
    setHistory((list) => [created, ...list]);
    setHistoryId(created.id);
  }

  async function run(nextMessages: ChatMessage[], refine: boolean) {
    lastRunRef.current = { messages: nextMessages, refine };
    flushPendingSave();
    setSaveStatus(null);
    const previous = output;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setOutput("");

    let text = "";
    let finished = false;
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ input, formatId, recipient, tone, length, messages: nextMessages }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message ?? "요청에 실패했습니다.");
      }
      for await (const line of readStreamLines(res.body)) {
        if (line.type === "text") {
          text += line.text;
          setOutput(text);
        } else if (line.type === "error") {
          throw new Error(line.message);
        } else {
          finished = true;
        }
      }
      if (!finished) throw new Error(INTERRUPTED);

      setMessages([...nextMessages, { role: "assistant", content: text }]);
      await saveHistory(text, refine);
    } catch (err) {
      if (controller.signal.aborted) {
        if (refine) setOutput(previous);
        return;
      }
      if (refine) setOutput(previous);
      setError(err instanceof TypeError ? INTERRUPTED : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function generate() {
    setHistoryId(null);
    setMessages([]);
    run([{ role: "user", content: input.trim() }], false);
  }

  function refine(instruction: string) {
    run([...messages, { role: "user", content: instruction }], true);
  }

  function retry() {
    const last = lastRunRef.current;
    if (last?.refine) {
      run([...messages, last.messages[last.messages.length - 1]], true);
      return;
    }
    if (last) {
      run(last.messages, last.refine);
      return;
    }
    setError(null);
    fetchSaved()
      .then(applyLoaded)
      .catch(() => setError(LOAD_FAILED));
  }

  function restore(item: HistoryItem) {
    flushPendingSave();
    setSaveStatus(null);
    setInput(item.input);
    setOutput(item.output);
    setRecipient(item.recipient);
    setTone(item.tone);
    setLength(item.length && LENGTHS.some((l) => l === item.length) ? item.length : LENGTHS[1]);
    if (formats.some((f) => f.id === item.formatId)) setFormatId(item.formatId);
    setMessages([
      { role: "user", content: item.input },
      { role: "assistant", content: item.output },
    ]);
    setHistoryId(item.id);
    setError(null);
  }

  async function removeHistory(id: string) {
    const res = await fetch(`/api/history/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setHistory((list) => list.filter((h) => h.id !== id));
    if (pendingSaveRef.current?.id === id) cancelPendingSave();
    if (historyId === id) setHistoryId(null);
  }

  function updateFormats(next: Format[]) {
    setFormats(next);
    if (!next.some((f) => f.id === formatId)) setFormatId(next[0]?.id ?? "");
  }

  return (
    <div className="flex h-screen">
      <HistoryList items={history} activeId={historyId} onSelect={restore} onDelete={removeHistory} />
      <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
        <div className="flex items-center">
          <h1 className="flex-1 text-lg font-semibold">포맷 글 작성기</h1>
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-100"
            onClick={() => setShowSettings(true)}
          >
            설정
          </button>
        </div>
        <OptionBar
          formats={formats}
          formatId={formatId}
          recipient={recipient}
          tone={tone}
          length={length}
          disabled={busy}
          onFormatChange={setFormatId}
          onRecipientChange={setRecipient}
          onToneChange={setTone}
          onLengthChange={setLength}
          onManage={() => setShowManager(true)}
        />
        <InputPanel
          value={input}
          busy={busy}
          canSubmit={input.trim() !== "" && formatId !== ""}
          onChange={setInput}
          onSubmit={generate}
          onStop={() => abortRef.current?.abort()}
        />
        <ResultPanel
          output={output}
          busy={busy}
          error={error}
          hasResult={output !== "" || (!busy && messages.length > 0)}
          saveStatus={saveStatus && saveStatus.id === historyId ? (saveStatus.ok ? "saved" : "failed") : null}
          canRefine={!busy && output !== "" && messages.length > 0}
          onRetry={retry}
          onRefine={refine}
          onEdit={editOutput}
        />
      </main>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showManager && (
        <FormatManager
          formats={formats}
          onChange={updateFormats}
          onClose={() => setShowManager(false)}
        />
      )}
    </div>
  );
}
