"use client";

import { useEffect, useRef, useState } from "react";
import { FormatManager } from "@/components/FormatManager";
import { HistoryList } from "@/components/HistoryList";
import { InputPanel } from "@/components/InputPanel";
import { OptionBar } from "@/components/OptionBar";
import { ResultPanel } from "@/components/ResultPanel";
import { RECIPIENTS, TONES } from "@/lib/defaults";
import { readStreamLines } from "@/lib/ndjson";
import type { ChatMessage, Format, HistoryItem } from "@/lib/types";

const JSON_HEADERS = { "Content-Type": "application/json" };
const INTERRUPTED = "작성이 중간에 끊겼습니다.";
const LOAD_FAILED = "저장된 포맷과 기록을 불러오지 못했습니다.";

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
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showManager, setShowManager] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const lastRunRef = useRef<{ messages: ChatMessage[]; refine: boolean } | null>(null);

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

  async function saveHistory(text: string, refine: boolean) {
    if (refine && historyId) {
      const res = await fetch(`/api/history/${historyId}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ output: text }),
      });
      if (!res.ok) return;
      const updated = (await res.json()) as HistoryItem;
      setHistory((list) => list.map((h) => (h.id === updated.id ? updated : h)));
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
        body: JSON.stringify({ input, formatId, recipient, tone, messages: nextMessages }),
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
    setInput(item.input);
    setOutput(item.output);
    setRecipient(item.recipient);
    setTone(item.tone);
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
        <h1 className="text-lg font-semibold">포맷 글 작성기</h1>
        <OptionBar
          formats={formats}
          formatId={formatId}
          recipient={recipient}
          tone={tone}
          disabled={busy}
          onFormatChange={setFormatId}
          onRecipientChange={setRecipient}
          onToneChange={setTone}
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
          canRefine={!busy && output !== "" && messages.length > 0}
          onRetry={retry}
          onRefine={refine}
        />
      </main>
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
