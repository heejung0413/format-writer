// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import Home from "@/app/page";
import { advance, fakeSaveTimers } from "./fake-timers";
import type { ChatMessage, Format, HistoryItem, StreamLine } from "@/lib/types";

const FORMATS: Format[] = [
  { id: "mail", name: "메일", instruction: "메일 지시" },
  { id: "chat", name: "채팅", instruction: "채팅 지시" },
  { id: "report", name: "보고", instruction: "보고 지시" },
];

function historyItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id: "h-old",
    createdAt: new Date(2026, 9, 3, 14, 5).toISOString(),
    formatId: "chat",
    formatName: "채팅",
    recipient: "동료",
    tone: "편하게",
    input: "예전에 쓴 메모",
    output: "예전에 만든 글",
    ...overrides,
  };
}

const encoder = new TextEncoder();

function ndjson(lines: StreamLine[], rawTail = ""): ReadableStream<Uint8Array> {
  const text = lines.map((l) => JSON.stringify(l)).join("\n") + (lines.length ? "\n" : "") + rawTail;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function streamResponse(lines: StreamLine[]): Response {
  return new Response(ndjson(lines), { headers: { "Content-Type": "application/x-ndjson" } });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const text = (t: string): StreamLine => ({ type: "text", text: t });
const done: StreamLine = { type: "done" };

type Call = {
  url: string;
  method: string;
  body: unknown;
  signal: AbortSignal | null | undefined;
  keepalive: boolean;
};

type Backend = {
  formats: Format[];
  history: HistoryItem[];
  generate: (call: Call) => Response | Promise<Response>;
  patch?: (call: Call) => Response | Promise<Response>;
  historyPostResponse?: () => Response;
  formatsResponse?: () => Response;
  signature: string;
};

let backend: Backend;
let calls: Call[];
let nextId: number;

function callsTo(url: string, method: string): Call[] {
  return calls.filter((c) => c.url === url && c.method === method);
}

function bodyOf<T>(call: Call): T {
  return call.body as T;
}

beforeEach(() => {
  calls = [];
  nextId = 1;
  backend = {
    formats: [...FORMATS],
    history: [],
    generate: () => streamResponse([text("기본 결과"), done]),
    signature: "",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const raw = init?.body;
      const call: Call = {
        url,
        method,
        body: typeof raw === "string" ? JSON.parse(raw) : undefined,
        signal: init?.signal,
        keepalive: init?.keepalive === true,
      };
      calls.push(call);

      if (url === "/api/formats" && method === "GET") {
        return backend.formatsResponse ? backend.formatsResponse() : json(backend.formats);
      }
      if (url === "/api/history" && method === "GET") return json(backend.history);
      if (url === "/api/generate") return backend.generate(call);
      if (url === "/api/settings" && method === "GET") return json({ signature: backend.signature });
      if (url === "/api/settings" && method === "PUT") {
        backend.signature = (call.body as { signature: string }).signature;
        return json({ signature: backend.signature });
      }
      if (url === "/api/history" && method === "POST") {
        if (backend.historyPostResponse) return backend.historyPostResponse();
        const created: HistoryItem = {
          ...(call.body as Omit<HistoryItem, "id" | "createdAt">),
          id: `h-new-${nextId++}`,
          createdAt: new Date(2026, 10, 5, 9, 7).toISOString(),
        };
        backend.history.unshift(created);
        return json(created, 201);
      }
      const historyMatch = url.match(/^\/api\/history\/(.+)$/);
      if (historyMatch && method === "PATCH") {
        if (backend.patch) return backend.patch(call);
        const output = (call.body as { output: string }).output;
        const base = backend.history.find((h) => h.id === historyMatch[1]) ?? historyItem();
        const updated = { ...base, id: historyMatch[1], output };
        backend.history = backend.history.map((h) => (h.id === updated.id ? updated : h));
        return json(updated);
      }
      if (historyMatch && method === "DELETE") return new Response(null, { status: 204 });
      const formatMatch = url.match(/^\/api\/formats\/(.+)$/);
      if (formatMatch && method === "DELETE") return new Response(null, { status: 204 });
      if (url === "/api/formats" && method === "POST") {
        return json({ id: "new-fmt", ...(call.body as object) }, 201);
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

let unmountHome: () => void = () => {};
const screenUnmount = () => unmountHome();

const inputPlaceholder = /전하고 싶은 내용을/;
const refinePlaceholder = /수정 지시를 입력하세요/;

async function renderLoaded() {
  const view = render(<Home />);
  unmountHome = view.unmount;
  await screen.findByRole("option", { name: "메일" });
  return userEvent.setup();
}

async function writeAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  memo = "내일 회의를 30분 미룹니다",
) {
  await user.type(screen.getByPlaceholderText(inputPlaceholder), memo);
  await user.click(screen.getByRole("button", { name: "작성하기" }));
}

describe("Home 초기 로드", () => {
  test("포맷과 기록을 불러오고 첫 포맷을 선택한다", async () => {
    backend.history = [historyItem()];
    render(<Home />);
    expect(await screen.findByRole("option", { name: "채팅" })).toBeInTheDocument();
    expect(await screen.findByText("예전에 쓴 메모")).toBeInTheDocument();
    expect(screen.getByLabelText("포맷")).toHaveValue("mail");
    expect(callsTo("/api/formats", "GET")).toHaveLength(1);
    expect(callsTo("/api/history", "GET")).toHaveLength(1);
    expect(screen.queryByText(/불러오지 못했습니다/)).not.toBeInTheDocument();
  });

  test("기록이 없으면 빈 기록 안내를 보여 준다", async () => {
    await renderLoaded();
    expect(screen.getByText("아직 기록이 없습니다.")).toBeInTheDocument();
  });

  test("불러오기에 실패하면 오류 메시지를 보여 준다", async () => {
    backend.formatsResponse = () => {
      throw new TypeError("network down");
    };
    render(<Home />);
    expect(await screen.findByText("저장된 포맷과 기록을 불러오지 못했습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "메일" })).not.toBeInTheDocument();
  });

  test("불러오기 오류의 다시 시도는 포맷과 기록을 다시 불러온다", async () => {
    let failing = true;
    backend.formatsResponse = () => {
      if (failing) throw new TypeError("network down");
      return json(backend.formats);
    };
    const user = userEvent.setup();
    render(<Home />);
    await screen.findByText("저장된 포맷과 기록을 불러오지 못했습니다.");
    failing = false;
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("option", { name: "메일" })).toBeInTheDocument();
  });

  test("내용이 비어 있으면 작성하기가 비활성이고 입력하면 활성이 된다", async () => {
    const user = await renderLoaded();
    const submit = screen.getByRole("button", { name: "작성하기" });
    expect(submit).toBeDisabled();
    await user.type(screen.getByPlaceholderText(inputPlaceholder), "   ");
    expect(submit).toBeDisabled();
    await user.type(screen.getByPlaceholderText(inputPlaceholder), "내용");
    expect(submit).toBeEnabled();
  });

  test("포맷이 하나도 없으면 입력해도 작성하기가 비활성이다", async () => {
    backend.formats = [];
    const user = userEvent.setup();
    render(<Home />);
    await waitFor(() => expect(callsTo("/api/history", "GET")).toHaveLength(1));
    await user.type(screen.getByPlaceholderText(inputPlaceholder), "내용");
    expect(screen.getByRole("button", { name: "작성하기" })).toBeDisabled();
  });
});

describe("Home 작성", () => {
  test("스트림 텍스트를 이어 붙여 보여 주고 끝나면 기록에 저장한다", async () => {
    backend.generate = () => streamResponse([text("제목: 회의 "), text("연기 안내"), done]);
    const user = await renderLoaded();
    await user.selectOptions(screen.getByLabelText("포맷"), "채팅");
    await user.selectOptions(screen.getByLabelText("받는 사람"), "상사");
    await user.selectOptions(screen.getByLabelText("말투"), "격식");
    await writeAndSubmit(user, "  내일 회의를 30분 미룹니다  ");

    expect(await screen.findByText("제목: 회의 연기 안내")).toBeInTheDocument();
    await waitFor(() => expect(callsTo("/api/history", "POST")).toHaveLength(1));

    expect(bodyOf(callsTo("/api/history", "POST")[0])).toEqual({
      formatId: "chat",
      formatName: "채팅",
      recipient: "상사",
      tone: "격식",
      length: "보통",
      input: "내일 회의를 30분 미룹니다",
      output: "제목: 회의 연기 안내",
    });
    expect(await screen.findByText("11/5 09:07 · 채팅")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /내일 회의를 30분 미룹니다/ })).toBeInTheDocument();
    expect(screen.queryByText("아직 기록이 없습니다.")).not.toBeInTheDocument();
  });

  test("/api/generate에는 입력·포맷·받는 사람·말투·메시지를 JSON으로 보낸다", async () => {
    const user = await renderLoaded();
    await user.selectOptions(screen.getByLabelText("포맷"), "보고");
    await user.selectOptions(screen.getByLabelText("받는 사람"), "고객");
    await user.selectOptions(screen.getByLabelText("말투"), "편하게");
    await writeAndSubmit(user, "  메모 내용  ");
    await screen.findByText("기본 결과");

    const [call] = callsTo("/api/generate", "POST");
    expect(call.body).toEqual({
      input: "  메모 내용  ",
      formatId: "report",
      recipient: "고객",
      tone: "편하게",
      length: "보통",
      messages: [{ role: "user", content: "메모 내용" }],
    });
    expect(call.signal).toBeInstanceOf(AbortSignal);
  });

  test("길이를 고르면 생성 요청과 기록 저장 요청에 길이를 실어 보낸다", async () => {
    const user = await renderLoaded();
    await user.selectOptions(screen.getByLabelText("길이"), "짧게");
    await writeAndSubmit(user);
    await screen.findByText("기본 결과");
    await waitFor(() => expect(callsTo("/api/history", "POST")).toHaveLength(1));
    expect(bodyOf<{ length: string }>(callsTo("/api/generate", "POST")[0]).length).toBe("짧게");
    expect(bodyOf<{ length: string }>(callsTo("/api/history", "POST")[0]).length).toBe("짧게");
  });

  test("길이 기본값은 보통이다", async () => {
    await renderLoaded();
    expect(screen.getByLabelText("길이")).toHaveValue("보통");
  });

  test("받는 사람 기본값은 없음, 말투 기본값은 보통이다", async () => {
    const user = await renderLoaded();
    await writeAndSubmit(user);
    await screen.findByText("기본 결과");
    const body = bodyOf<{ recipient: string; tone: string; formatId: string }>(
      callsTo("/api/generate", "POST")[0],
    );
    expect(body).toMatchObject({ recipient: "없음", tone: "보통", formatId: "mail" });
  });

  test("작성 중에는 중단 버튼과 잠긴 입력을 보이고 끝나면 복사·다듬기가 나온다", async () => {
    let release: () => void = () => {};
    backend.generate = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(encoder.encode(JSON.stringify(text("쓰는 중")) + "\n"));
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            controller.enqueue(encoder.encode(JSON.stringify(done) + "\n"));
            controller.close();
          },
        }),
      );
    const user = await renderLoaded();
    await writeAndSubmit(user);

    expect(await screen.findByText("쓰는 중")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "중단" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "작성하기" })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(inputPlaceholder)).toBeDisabled();
    expect(screen.getByLabelText("포맷")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "복사" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "더 짧게" })).not.toBeInTheDocument();

    release();
    expect(await screen.findByRole("button", { name: "복사" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "더 짧게" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "작성하기" })).toBeEnabled();
  });
});

describe("Home 오류 처리", () => {
  test("error 줄이 오면 그 메시지를 보여 주고 기록에 저장하지 않는다", async () => {
    backend.generate = () =>
      streamResponse([
        text("쓰던 글"),
        { type: "error", code: "rate_limit", message: "요청이 너무 많습니다." },
      ]);
    const user = await renderLoaded();
    await writeAndSubmit(user);

    expect(await screen.findByText("요청이 너무 많습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    expect(callsTo("/api/history", "POST")).toHaveLength(0);
    expect(callsTo("/api/history", "PATCH")).toHaveLength(0);
    expect(screen.getByText("아직 기록이 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "더 짧게" })).not.toBeInTheDocument();
  });

  test("done 없이 스트림이 끝나면 작성이 중간에 끊겼다고 알리고 저장하지 않는다", async () => {
    backend.generate = () => streamResponse([text("반쪽")]);
    const user = await renderLoaded();
    await writeAndSubmit(user);

    expect(await screen.findByText("작성이 중간에 끊겼습니다.")).toBeInTheDocument();
    expect(callsTo("/api/history", "POST")).toHaveLength(0);
  });

  test("비정상 응답이면 서버가 준 메시지를 보여 준다", async () => {
    backend.generate = () =>
      json({ error: { code: "auth", message: "API 키가 올바르지 않습니다." } }, 401);
    const user = await renderLoaded();
    await writeAndSubmit(user);
    expect(await screen.findByText("API 키가 올바르지 않습니다.")).toBeInTheDocument();
    expect(callsTo("/api/history", "POST")).toHaveLength(0);
  });

  test("비정상 응답에 메시지가 없으면 기본 문구를 보여 준다", async () => {
    backend.generate = () => new Response("not json", { status: 502 });
    const user = await renderLoaded();
    await writeAndSubmit(user);
    expect(await screen.findByText("요청에 실패했습니다.")).toBeInTheDocument();
  });

  test("네트워크 오류(TypeError)는 중간에 끊겼다는 문구로 보여 준다", async () => {
    backend.generate = () => {
      throw new TypeError("Failed to fetch");
    };
    const user = await renderLoaded();
    await writeAndSubmit(user);
    expect(await screen.findByText("작성이 중간에 끊겼습니다.")).toBeInTheDocument();
  });

  test("다시 시도는 같은 요청을 다시 보내 성공하면 오류를 지운다", async () => {
    let attempt = 0;
    backend.generate = () => {
      attempt += 1;
      return attempt === 1
        ? streamResponse([{ type: "error", code: "api_error", message: "일시 오류" }])
        : streamResponse([text("재시도 성공"), done]);
    };
    const user = await renderLoaded();
    await writeAndSubmit(user, "원래 메모");
    await screen.findByText("일시 오류");

    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("재시도 성공")).toBeInTheDocument();
    expect(screen.queryByText("일시 오류")).not.toBeInTheDocument();

    const [first, second] = callsTo("/api/generate", "POST");
    expect(second.body).toEqual(first.body);
    await waitFor(() => expect(callsTo("/api/history", "POST")).toHaveLength(1));
  });

  test("기록 저장 요청이 실패해도 결과는 그대로 보이고 기록만 추가되지 않는다", async () => {
    const original = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/history" && init?.method === "POST") {
          return new Response(null, { status: 500 });
        }
        return original(input, init);
      }),
    );
    const user = await renderLoaded();
    await writeAndSubmit(user);
    expect(await screen.findByText("기본 결과")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "작성하기" })).toBeEnabled());
    expect(screen.getByText("아직 기록이 없습니다.")).toBeInTheDocument();
    expect(screen.queryByText(/실패|끊겼/)).not.toBeInTheDocument();
  });
});

describe("Home 다듬기", () => {
  async function generated(user: ReturnType<typeof userEvent.setup>) {
    backend.generate = () => streamResponse([text("초안 글"), done]);
    await writeAndSubmit(user, "원래 메모");
    await screen.findByText("초안 글");
    await waitFor(() => expect(callsTo("/api/history", "POST")).toHaveLength(1));
    await screen.findByRole("button", { name: "더 짧게" });
  }

  test("다듬기는 누적 대화를 보내고 같은 기록을 PATCH한다", async () => {
    const user = await renderLoaded();
    await generated(user);
    backend.generate = () => streamResponse([text("짧은 글"), done]);

    await user.click(screen.getByRole("button", { name: "더 짧게" }));
    expect(await screen.findByText("짧은 글")).toBeInTheDocument();

    const refineCall = callsTo("/api/generate", "POST")[1];
    const messages: ChatMessage[] = [
      { role: "user", content: "원래 메모" },
      { role: "assistant", content: "초안 글" },
      { role: "user", content: "더 짧게" },
    ];
    expect(refineCall.body).toMatchObject({ messages, input: "원래 메모" });

    await waitFor(() => expect(callsTo("/api/history/h-new-1", "PATCH")).toHaveLength(1));
    expect(callsTo("/api/history/h-new-1", "PATCH")[0].body).toEqual({ output: "짧은 글" });
    expect(callsTo("/api/history", "POST")).toHaveLength(1);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  test("PATCH가 실패하면 새 글은 보이지만 목록은 그대로다", async () => {
    const user = await renderLoaded();
    await generated(user);
    const original = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "PATCH" ? new Response(null, { status: 500 }) : original(input, init),
      ),
    );
    backend.generate = () => streamResponse([text("짧은 글"), done]);
    await user.click(screen.getByRole("button", { name: "더 짧게" }));
    expect(await screen.findByText("짧은 글")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "더 짧게" })).toBeEnabled());
    expect(screen.queryByText(/실패|끊겼/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  test("두 번 이어서 다듬으면 대화가 계속 쌓인다", async () => {
    const user = await renderLoaded();
    await generated(user);
    backend.generate = () => streamResponse([text("1차"), done]);
    await user.click(screen.getByRole("button", { name: "더 짧게" }));
    await screen.findByText("1차");
    await screen.findByRole("button", { name: "더 공손하게" });

    backend.generate = () => streamResponse([text("2차"), done]);
    await user.type(screen.getByPlaceholderText(refinePlaceholder), "존댓말로{Enter}");
    await screen.findByText("2차");

    const third = callsTo("/api/generate", "POST")[2];
    expect((third.body as { messages: ChatMessage[] }).messages).toEqual([
      { role: "user", content: "원래 메모" },
      { role: "assistant", content: "초안 글" },
      { role: "user", content: "더 짧게" },
      { role: "assistant", content: "1차" },
      { role: "user", content: "존댓말로" },
    ]);
    await waitFor(() => expect(callsTo("/api/history/h-new-1", "PATCH")).toHaveLength(2));
  });

  test("자유 입력 + 다듬기도 그 지시를 대화에 넣는다", async () => {
    const user = await renderLoaded();
    await generated(user);
    backend.generate = () => streamResponse([text("마지막 문단 뺀 글"), done]);
    await user.type(screen.getByPlaceholderText(refinePlaceholder), "마지막 문단 빼 줘");
    await user.click(screen.getByRole("button", { name: "다듬기" }));
    await screen.findByText("마지막 문단 뺀 글");
    const messages = (callsTo("/api/generate", "POST")[1].body as { messages: ChatMessage[] })
      .messages;
    expect(messages[messages.length - 1]).toEqual({ role: "user", content: "마지막 문단 빼 줘" });
  });

  test("다듬기 중에는 이전 글이 사라지고 실패하면 이전 글로 되돌아간다", async () => {
    const user = await renderLoaded();
    await generated(user);
    backend.generate = () =>
      streamResponse([text("망가진 "), { type: "error", code: "api_error", message: "다듬기 실패" }]);

    await user.click(screen.getByRole("button", { name: "더 짧게" }));
    expect(await screen.findByText("다듬기 실패")).toBeInTheDocument();
    expect(screen.getByText("초안 글")).toBeInTheDocument();
    expect(screen.queryByText(/망가진/)).not.toBeInTheDocument();
    expect(callsTo("/api/history/h-new-1", "PATCH")).toHaveLength(0);
  });

  test("다듬기 실패 후 다시 시도하면 같은 대화로 다시 보내 PATCH한다", async () => {
    const user = await renderLoaded();
    await generated(user);
    backend.generate = () => json({ error: { message: "잠시 후 다시" } }, 503);
    await user.click(screen.getByRole("button", { name: "더 짧게" }));
    await screen.findByText("잠시 후 다시");

    backend.generate = () => streamResponse([text("성공한 짧은 글"), done]);
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await screen.findByText("성공한 짧은 글");

    const refineCalls = callsTo("/api/generate", "POST").slice(1);
    expect(refineCalls).toHaveLength(2);
    expect(refineCalls[1].body).toEqual(refineCalls[0].body);
    await waitFor(() => expect(callsTo("/api/history/h-new-1", "PATCH")).toHaveLength(1));
    expect(callsTo("/api/history", "POST")).toHaveLength(1);
  });

  test("새로 작성하면 이전 대화와 기록 연결을 버리고 새 기록을 만든다", async () => {
    const user = await renderLoaded();
    await generated(user);
    backend.generate = () => streamResponse([text("두번째 글"), done]);
    await user.clear(screen.getByPlaceholderText(inputPlaceholder));
    await user.type(screen.getByPlaceholderText(inputPlaceholder), "다른 메모");
    await user.click(screen.getByRole("button", { name: "작성하기" }));
    await screen.findByText("두번째 글");

    const second = callsTo("/api/generate", "POST")[1];
    expect((second.body as { messages: ChatMessage[] }).messages).toEqual([
      { role: "user", content: "다른 메모" },
    ]);
    await waitFor(() => expect(callsTo("/api/history", "POST")).toHaveLength(2));
    expect(callsTo("/api/history/h-new-1", "PATCH")).toHaveLength(0);
  });
});

describe("Home 중단", () => {
  function hangingStream(first: string) {
    backend.generate = (call) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(JSON.stringify(text(first)) + "\n"));
            call.signal?.addEventListener("abort", () => {
              controller.error(new DOMException("The operation was aborted.", "AbortError"));
            });
          },
        }),
      );
  }

  test("중단하면 fetch를 abort하고 받은 글을 남기며 저장하지 않는다", async () => {
    hangingStream("받은 부분");
    const user = await renderLoaded();
    await writeAndSubmit(user);
    await screen.findByText("받은 부분");

    await user.click(screen.getByRole("button", { name: "중단" }));

    const [call] = callsTo("/api/generate", "POST");
    expect(call.signal?.aborted).toBe(true);
    expect(await screen.findByRole("button", { name: "작성하기" })).toBeEnabled();
    expect(screen.getByText("받은 부분")).toBeInTheDocument();
    expect(screen.queryByText(/끊겼|실패/)).not.toBeInTheDocument();
    expect(callsTo("/api/history", "POST")).toHaveLength(0);
    expect(screen.getByText("아직 기록이 없습니다.")).toBeInTheDocument();
  });

  test("다듬는 도중 중단하면 이전 글로 돌아가고 PATCH하지 않는다", async () => {
    const user = await renderLoaded();
    backend.generate = () => streamResponse([text("초안 글"), done]);
    await writeAndSubmit(user);
    await screen.findByRole("button", { name: "더 짧게" });
    await waitFor(() => expect(callsTo("/api/history", "POST")).toHaveLength(1));

    hangingStream("다듬는 중간");
    await user.click(screen.getByRole("button", { name: "더 짧게" }));
    await screen.findByText("다듬는 중간");
    await user.click(screen.getByRole("button", { name: "중단" }));

    expect(await screen.findByText("초안 글")).toBeInTheDocument();
    expect(screen.queryByText("다듬는 중간")).not.toBeInTheDocument();
    expect(callsTo("/api/history/h-new-1", "PATCH")).toHaveLength(0);
  });
});

describe("Home 설정", () => {
  test("상단의 설정 버튼을 누르면 설정 모달이 열리고 닫기로 닫힌다", async () => {
    const user = await renderLoaded();
    expect(screen.queryByRole("dialog", { name: "설정" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "설정" }));
    expect(await screen.findByRole("dialog", { name: "설정" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog", { name: "설정" })).not.toBeInTheDocument();
  });

  test("설정 버튼은 제목과 같은 상단 줄에 있다", async () => {
    await renderLoaded();
    const heading = screen.getByRole("heading", { level: 1, name: "포맷 글 작성기" });
    expect(heading.parentElement).toContainElement(screen.getByRole("button", { name: "설정" }));
  });

  test("서명을 저장하면 모달이 닫히고, 이후 생성 요청에는 서명을 싣지 않는다", async () => {
    const user = await renderLoaded();
    await user.click(screen.getByRole("button", { name: "설정" }));
    const box = await screen.findByLabelText("서명");
    await waitFor(() => expect(box).toBeEnabled());
    await user.type(box, "비밀 서명 홍길동");
    await user.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "설정" })).not.toBeInTheDocument());
    expect(callsTo("/api/settings", "PUT")[0].body).toEqual({ signature: "비밀 서명 홍길동" });

    await writeAndSubmit(user);
    await screen.findByText("기본 결과");
    const [generate] = callsTo("/api/generate", "POST");
    expect(Object.keys(generate.body as object).sort()).toEqual(
      ["formatId", "input", "length", "messages", "recipient", "tone"],
    );
    expect(JSON.stringify(generate.body)).not.toContain("서명");
    const historyPost = callsTo("/api/history", "POST")[0];
    expect(JSON.stringify(historyPost.body)).not.toContain("서명");
  });

  test("처음 화면을 불러올 때는 설정을 요청하지 않는다", async () => {
    await renderLoaded();
    expect(calls.filter((c) => c.url === "/api/settings")).toHaveLength(0);
  });
});

describe("Home 기록", () => {
  test("기록 항목을 누르면 입력·옵션·결과를 복원하고 활성 표시를 한다", async () => {
    backend.history = [historyItem(), historyItem({ id: "h-2", input: "다른 메모", formatId: "mail", formatName: "메일", recipient: "상사", tone: "격식", output: "다른 글" })];
    const user = await renderLoaded();
    await user.click(await screen.findByRole("button", { name: /예전에 쓴 메모/ }));

    expect(screen.getByPlaceholderText(inputPlaceholder)).toHaveValue("예전에 쓴 메모");
    expect(screen.getByText("예전에 만든 글")).toBeInTheDocument();
    expect(screen.getByLabelText("포맷")).toHaveValue("chat");
    expect(screen.getByLabelText("받는 사람")).toHaveValue("동료");
    expect(screen.getByLabelText("말투")).toHaveValue("편하게");
    expect(screen.getAllByRole("listitem")[0]).toHaveClass("bg-blue-50");
    expect(screen.getAllByRole("listitem")[1]).not.toHaveClass("bg-blue-50");
    expect(screen.getByRole("button", { name: "더 짧게" })).toBeInTheDocument();
  });

  test("길이가 저장된 기록을 복원하면 길이 선택도 되돌리고 다듬기 요청에 그 길이를 쓴다", async () => {
    backend.history = [historyItem({ length: "자세히" })];
    const user = await renderLoaded();
    await user.selectOptions(screen.getByLabelText("길이"), "짧게");
    await user.click(await screen.findByRole("button", { name: /예전에 쓴 메모/ }));
    expect(screen.getByLabelText("길이")).toHaveValue("자세히");

    backend.generate = () => streamResponse([text("다듬은 글"), done]);
    await user.click(screen.getByRole("button", { name: "더 짧게" }));
    await screen.findByText("다듬은 글");
    expect(bodyOf<{ length: string }>(callsTo("/api/generate", "POST")[0]).length).toBe("자세히");
  });

  test("길이가 없거나 알 수 없는 기록을 복원하면 길이는 보통이 된다", async () => {
    backend.history = [
      historyItem(),
      historyItem({ id: "h-odd", input: "이상한 기록", length: "엄청 길게" }),
    ];
    const user = await renderLoaded();
    await user.selectOptions(screen.getByLabelText("길이"), "짧게");
    await user.click(await screen.findByRole("button", { name: /예전에 쓴 메모/ }));
    expect(screen.getByLabelText("길이")).toHaveValue("보통");

    await user.selectOptions(screen.getByLabelText("길이"), "자세히");
    await user.click(screen.getByRole("button", { name: /이상한 기록/ }));
    expect(screen.getByLabelText("길이")).toHaveValue("보통");
  });

  test("삭제된 포맷의 기록을 복원하면 포맷 선택은 그대로 둔다", async () => {
    backend.history = [historyItem({ formatId: "gone", formatName: "사라진 포맷" })];
    const user = await renderLoaded();
    await user.click(await screen.findByRole("button", { name: /예전에 쓴 메모/ }));
    expect(screen.getByLabelText("포맷")).toHaveValue("mail");
    expect(screen.getByLabelText("받는 사람")).toHaveValue("동료");
  });

  test("복원한 기록을 다듬으면 그 기록을 PATCH하고 목록이 갱신된다", async () => {
    backend.history = [historyItem()];
    const user = await renderLoaded();
    await user.click(await screen.findByRole("button", { name: /예전에 쓴 메모/ }));
    backend.generate = () => streamResponse([text("복원 후 짧은 글"), done]);
    await user.click(screen.getByRole("button", { name: "더 짧게" }));
    await screen.findByText("복원 후 짧은 글");

    const generate = callsTo("/api/generate", "POST")[0];
    expect(generate.body).toMatchObject({
      formatId: "chat",
      recipient: "동료",
      tone: "편하게",
      messages: [
        { role: "user", content: "예전에 쓴 메모" },
        { role: "assistant", content: "예전에 만든 글" },
        { role: "user", content: "더 짧게" },
      ],
    });
    await waitFor(() => expect(callsTo("/api/history/h-old", "PATCH")).toHaveLength(1));
    expect(callsTo("/api/history/h-old", "PATCH")[0].body).toEqual({ output: "복원 후 짧은 글" });
    expect(callsTo("/api/history", "POST")).toHaveLength(0);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  test("복원하면 이전 오류 메시지를 지운다", async () => {
    backend.history = [historyItem()];
    backend.generate = () => streamResponse([{ type: "error", code: "api_error", message: "오류!" }]);
    const user = await renderLoaded();
    await writeAndSubmit(user);
    await screen.findByText("오류!");
    await user.click(await screen.findByRole("button", { name: /예전에 쓴 메모/ }));
    expect(screen.queryByText("오류!")).not.toBeInTheDocument();
  });

  test("기록 삭제는 DELETE를 보내고 목록에서 뺀다", async () => {
    backend.history = [historyItem(), historyItem({ id: "h-2", input: "남길 메모" })];
    const user = await renderLoaded();
    const item = (await screen.findByText("예전에 쓴 메모")).closest("li");
    if (!item) throw new Error("li not found");
    await user.click(within(item).getByRole("button", { name: "기록 삭제" }));

    await waitFor(() => expect(screen.queryByText("예전에 쓴 메모")).not.toBeInTheDocument());
    expect(callsTo("/api/history/h-old", "DELETE")).toHaveLength(1);
    expect(screen.getByText("남길 메모")).toBeInTheDocument();
  });

  test("삭제 요청이 실패하면 목록을 그대로 둔다", async () => {
    backend.history = [historyItem()];
    const original = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "DELETE" ? new Response(null, { status: 500 }) : original(input, init),
      ),
    );
    const user = await renderLoaded();
    await user.click(await screen.findByRole("button", { name: "기록 삭제" }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(3));
    expect(screen.getByText("예전에 쓴 메모")).toBeInTheDocument();
  });

  test("열어 둔 기록을 삭제한 뒤 다듬으면 PATCH하지 않고 새 기록으로 저장한다", async () => {
    backend.history = [historyItem()];
    const user = await renderLoaded();
    await user.click(await screen.findByRole("button", { name: /예전에 쓴 메모/ }));
    await user.click(screen.getByRole("button", { name: "기록 삭제" }));
    await waitFor(() => expect(screen.queryByText("아직 기록이 없습니다.")).toBeInTheDocument());

    backend.generate = () => streamResponse([text("삭제 뒤 글"), done]);
    await user.click(screen.getByRole("button", { name: "더 짧게" }));
    await screen.findByText("삭제 뒤 글");
    await waitFor(() => expect(screen.getByRole("button", { name: "작성하기" })).toBeEnabled());
    expect(callsTo("/api/history/h-old", "PATCH")).toHaveLength(0);
    expect(callsTo("/api/history", "POST")).toHaveLength(1);
  });
});

describe("Home 포맷 관리", () => {
  test("포맷 관리를 열고 닫을 수 있다", async () => {
    const user = await renderLoaded();
    expect(screen.queryByRole("heading", { name: "포맷 관리" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "포맷 관리" }));
    expect(screen.getByRole("heading", { name: "포맷 관리" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("heading", { name: "포맷 관리" })).not.toBeInTheDocument();
  });

  test("포맷을 추가하면 드롭다운에 나타나고 선택은 유지된다", async () => {
    const user = await renderLoaded();
    await user.selectOptions(screen.getByLabelText("포맷"), "채팅");
    await user.click(screen.getByRole("button", { name: "포맷 관리" }));
    await user.type(screen.getByPlaceholderText(/이름 \(예/), "주간보고");
    await user.type(screen.getByPlaceholderText(/지시문:/), "요약");
    await user.click(screen.getByRole("button", { name: "추가" }));

    expect(await screen.findByRole("option", { name: "주간보고" })).toBeInTheDocument();
    expect(screen.getByLabelText("포맷")).toHaveValue("chat");
  });

  test("선택 중인 포맷을 지우면 남은 첫 포맷으로 바뀐다", async () => {
    const user = await renderLoaded();
    await user.selectOptions(screen.getByLabelText("포맷"), "채팅");
    await user.click(screen.getByRole("button", { name: "포맷 관리" }));
    const row = screen.getByText("채팅 지시").closest("li");
    if (!row) throw new Error("row not found");
    await user.click(within(row).getByRole("button", { name: "삭제" }));

    await waitFor(() => expect(screen.queryByRole("option", { name: "채팅" })).not.toBeInTheDocument());
    expect(screen.getByLabelText("포맷")).toHaveValue("mail");
    expect(callsTo("/api/formats/chat", "DELETE")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "닫기" }));
    await writeAndSubmit(user);
    await screen.findByText("기본 결과");
    expect(bodyOf<{ formatId: string }>(callsTo("/api/generate", "POST")[0]).formatId).toBe("mail");
  });

  test("선택하지 않은 포맷을 지워도 선택은 그대로다", async () => {
    const user = await renderLoaded();
    await user.selectOptions(screen.getByLabelText("포맷"), "보고");
    await user.click(screen.getByRole("button", { name: "포맷 관리" }));
    const row = screen.getByText("채팅 지시").closest("li");
    if (!row) throw new Error("row not found");
    await user.click(within(row).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(screen.queryByRole("option", { name: "채팅" })).not.toBeInTheDocument());
    expect(screen.getByLabelText("포맷")).toHaveValue("report");
  });
});

const resultBox = () => screen.getByRole("textbox", { name: "결과" });
const patchesTo = (id: string) => callsTo(`/api/history/${id}`, "PATCH");

/** 작성을 한 번 끝내 기록(h-new-1)을 만든 뒤, 결과 편집의 1초 대기를 가짜 타이머로 제어할 수 있게 준비한다. */
async function generatedForEditing(options: { historyItems?: HistoryItem[] } = {}) {
  backend.history = options.historyItems ?? [];
  backend.generate = () => streamResponse([text("초안 글"), done]);
  await renderLoaded();
  const user = userEvent.setup({ delay: null });
  await user.type(screen.getByPlaceholderText(inputPlaceholder), "원래 메모");
  await user.click(screen.getByRole("button", { name: "작성하기" }));
  await waitFor(() => expect(resultBox()).toHaveValue("초안 글"));
  await waitFor(() => expect(callsTo("/api/history", "POST")).toHaveLength(1));
  await screen.findByRole("button", { name: "더 짧게" });
  fakeSaveTimers();
  return user;
}

describe("Home 결과 편집", () => {
  test("고치면 화면에 바로 반영되고, 마지막 입력 1초 뒤에 한 번만 PATCH한 뒤 저장됨을 보인다", async () => {
    const user = await generatedForEditing();
    await user.type(resultBox(), " 수정");
    expect(resultBox()).toHaveValue("초안 글 수정");

    await advance(999);
    expect(patchesTo("h-new-1")).toHaveLength(0);
    await user.type(resultBox(), "!");
    await advance(999);
    expect(patchesTo("h-new-1")).toHaveLength(0);
    expect(screen.queryByText("저장됨")).not.toBeInTheDocument();

    await advance(1);
    await waitFor(() => expect(patchesTo("h-new-1")).toHaveLength(1));
    expect(patchesTo("h-new-1")[0].body).toEqual({ output: "초안 글 수정!" });
    expect(await screen.findByText("저장됨")).toBeInTheDocument();

    await user.type(resultBox(), "?");
    expect(screen.queryByText("저장됨")).not.toBeInTheDocument();
    await advance(5000);
    await waitFor(() => expect(patchesTo("h-new-1")).toHaveLength(2));
    expect(patchesTo("h-new-1")[1].body).toEqual({ output: "초안 글 수정!?" });
  });

  test("저장에 실패하면 저장하지 못했습니다를 보이고, 다시 고쳐서 성공하면 저장됨으로 바뀐다", async () => {
    const user = await generatedForEditing();
    backend.patch = () => new Response(null, { status: 500 });
    await user.type(resultBox(), " 수정");
    await advance(1000);
    expect(await screen.findByText("저장하지 못했습니다.")).toBeInTheDocument();
    expect(resultBox()).toHaveValue("초안 글 수정");

    backend.patch = undefined;
    await user.type(resultBox(), "!");
    expect(screen.queryByText("저장하지 못했습니다.")).not.toBeInTheDocument();
    await advance(1000);
    expect(await screen.findByText("저장됨")).toBeInTheDocument();
  });

  test("네트워크 오류로 저장이 던져도 저장하지 못했습니다만 보이고 오류 배너는 없다", async () => {
    const user = await generatedForEditing();
    backend.patch = () => {
      throw new TypeError("network down");
    };
    await user.type(resultBox(), " 수정");
    await advance(1000);
    expect(await screen.findByText("저장하지 못했습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
  });

  test("공백뿐인 글은 저장하지 않고, 그 전에 기다리던 저장도 취소한다", async () => {
    const user = await generatedForEditing();
    await user.type(resultBox(), " 수정");
    await user.clear(resultBox());
    expect(resultBox()).toHaveValue("");
    await user.type(resultBox(), "   ");
    await advance(5000);
    expect(patchesTo("h-new-1")).toHaveLength(0);
    expect(resultBox()).toHaveValue("   ");
    expect(screen.queryByText("저장됨")).not.toBeInTheDocument();
  });

  test("글을 모두 지워도 결과 입력 칸은 남아 다시 쓸 수 있고 쓰면 저장한다", async () => {
    const user = await generatedForEditing();
    await user.clear(resultBox());
    await advance(5000);
    expect(patchesTo("h-new-1")).toHaveLength(0);
    await user.type(resultBox(), "새 글");
    await advance(1000);
    await waitFor(() => expect(patchesTo("h-new-1")).toHaveLength(1));
    expect(patchesTo("h-new-1")[0].body).toEqual({ output: "새 글" });
  });

  test("기록 저장에 실패해 기록 id가 없으면 고칠 수는 있지만 저장하지 않는다", async () => {
    backend.history = [];
    backend.generate = () => streamResponse([text("초안 글"), done]);
    backend.historyPostResponse = () => new Response(null, { status: 500 });
    await renderLoaded();
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByPlaceholderText(inputPlaceholder), "원래 메모");
    await user.click(screen.getByRole("button", { name: "작성하기" }));
    await waitFor(() => expect(resultBox()).toHaveValue("초안 글"));
    await screen.findByRole("button", { name: "더 짧게" });
    fakeSaveTimers();

    await user.type(resultBox(), " 수정");
    expect(resultBox()).toHaveValue("초안 글 수정");
    await advance(5000);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    expect(screen.queryByText("저장됨")).not.toBeInTheDocument();
  });

  test("작성 중에는 결과 칸이 읽기 전용이다", async () => {
    let release: () => void = () => {};
    backend.generate = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(encoder.encode(JSON.stringify(text("쓰는 중")) + "\n"));
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            controller.enqueue(encoder.encode(JSON.stringify(done) + "\n"));
            controller.close();
          },
        }),
      );
    const user = await renderLoaded();
    await writeAndSubmit(user);
    await waitFor(() => expect(resultBox()).toHaveValue("쓰는 중"));
    expect(resultBox()).toHaveAttribute("readonly");
    await user.type(resultBox(), "끼어들기");
    expect(resultBox()).toHaveValue("쓰는 중");
    release();
    await waitFor(() => expect(resultBox()).not.toHaveAttribute("readonly"));
  });

  test("고친 글로 복사한다", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = await generatedForEditing();
    vi.stubGlobal("navigator", { clipboard: { writeText }, platform: "" });
    await user.type(resultBox(), " 수정");
    await user.click(screen.getByRole("button", { name: "복사" }));
    expect(writeText).toHaveBeenCalledExactlyOnceWith("초안 글 수정");
  });

  test("기록을 복원한 글도 고쳐서 그 기록에 저장한다", async () => {
    backend.history = [historyItem()];
    await renderLoaded();
    const user = userEvent.setup({ delay: null });
    await user.click(await screen.findByRole("button", { name: /예전에 쓴 메모/ }));
    fakeSaveTimers();
    await user.type(resultBox(), "!");
    await advance(1000);
    await waitFor(() => expect(patchesTo("h-old")).toHaveLength(1));
    expect(patchesTo("h-old")[0].body).toEqual({ output: "예전에 만든 글!" });
  });
});

describe("Home 결과 편집과 저장 대기의 정리", () => {
  const OTHER = () =>
    historyItem({ id: "h-other", input: "다른 메모", formatId: "mail", formatName: "메일", output: "다른 글" });

  test("고친 뒤 1초 안에 다른 기록을 열면 그 자리에서 원래 기록에 저장하고 다른 기록은 건드리지 않는다", async () => {
    const user = await generatedForEditing({ historyItems: [OTHER()] });
    await user.type(resultBox(), " 수정");
    await user.click(screen.getByRole("button", { name: /다른 메모/ }));

    await waitFor(() => expect(patchesTo("h-new-1")).toHaveLength(1));
    expect(patchesTo("h-new-1")[0].body).toEqual({ output: "초안 글 수정" });
    expect(resultBox()).toHaveValue("다른 글");
    expect(screen.getByPlaceholderText(inputPlaceholder)).toHaveValue("다른 메모");

    await advance(5000);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    expect(patchesTo("h-other")).toHaveLength(0);
    expect(screen.queryByText("저장됨")).not.toBeInTheDocument();
  });

  test("저장이 끝난 뒤 목록의 그 기록은 저장된 글이고, 다시 열면 고친 글이 보인다", async () => {
    const user = await generatedForEditing({ historyItems: [OTHER()] });
    await user.type(resultBox(), " 수정");
    await user.click(screen.getByRole("button", { name: /다른 메모/ }));
    await waitFor(() => expect(patchesTo("h-new-1")).toHaveLength(1));
    await waitFor(() => expect(backend.history.find((h) => h.id === "h-new-1")?.output).toBe("초안 글 수정"));

    await user.click(screen.getByRole("button", { name: /원래 메모/ }));
    await waitFor(() => expect(resultBox()).toHaveValue("초안 글 수정"));
    expect(screen.getByPlaceholderText(inputPlaceholder)).toHaveValue("원래 메모");
  });

  test("넘어가며 보낸 저장이 실패하면 목록의 그 기록은 저장돼 있던 글로 되돌아간다", async () => {
    const user = await generatedForEditing({ historyItems: [OTHER()] });
    let fail: () => void = () => {};
    backend.patch = () =>
      new Promise<Response>((resolve) => {
        fail = () => resolve(new Response(null, { status: 500 }));
      });
    await user.type(resultBox(), " 수정");
    await user.click(screen.getByRole("button", { name: /다른 메모/ }));
    await waitFor(() => expect(patchesTo("h-new-1")).toHaveLength(1));
    await act(async () => {
      fail();
    });
    await user.click(screen.getByRole("button", { name: /원래 메모/ }));
    await waitFor(() => expect(resultBox()).toHaveValue("초안 글"));
  });

  test("고친 뒤 1초 안에 새로 작성하면 이전 기록에 먼저 저장하고 새 글은 새 기록이 된다", async () => {
    const user = await generatedForEditing();
    await user.type(resultBox(), " 수정");
    backend.generate = () => streamResponse([text("두번째 글"), done]);
    await user.clear(screen.getByPlaceholderText(inputPlaceholder));
    await user.type(screen.getByPlaceholderText(inputPlaceholder), "다른 메모");
    await user.click(screen.getByRole("button", { name: "작성하기" }));

    await waitFor(() => expect(resultBox()).toHaveValue("두번째 글"));
    await waitFor(() => expect(callsTo("/api/history", "POST")).toHaveLength(2));
    expect(patchesTo("h-new-1")).toHaveLength(1);
    expect(patchesTo("h-new-1")[0].body).toEqual({ output: "초안 글 수정" });
    expect(patchesTo("h-new-2")).toHaveLength(0);
    expect(bodyOf<{ output: string }>(callsTo("/api/history", "POST")[1]).output).toBe("두번째 글");
    await advance(5000);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });

  test("고친 뒤 1초 안에 다듬기를 시작하면 고친 글로 요청하고, 고친 글 저장이 끝난 뒤에 다듬은 결과를 저장한다", async () => {
    const user = await generatedForEditing();
    let releaseEdited: () => void = () => {};
    backend.patch = (call) =>
      (call.body as { output: string }).output === "초안 글 수정"
        ? new Promise<Response>((resolve) => {
            releaseEdited = () => resolve(json({ ...historyItem(), id: "h-new-1", output: "초안 글 수정" }));
          })
        : json({ ...historyItem(), id: "h-new-1", output: (call.body as { output: string }).output });
    await user.type(resultBox(), " 수정");
    backend.generate = () => streamResponse([text("짧게 줄인 글"), done]);
    await user.click(screen.getByRole("button", { name: "더 짧게" }));

    await waitFor(() => expect(resultBox()).toHaveValue("짧게 줄인 글"));
    const refineCall = callsTo("/api/generate", "POST")[1];
    expect((refineCall.body as { messages: ChatMessage[] }).messages).toEqual([
      { role: "user", content: "원래 메모" },
      { role: "assistant", content: "초안 글 수정" },
      { role: "user", content: "더 짧게" },
    ]);
    expect(patchesTo("h-new-1").map((c) => c.body)).toEqual([{ output: "초안 글 수정" }]);

    releaseEdited();
    await waitFor(() => expect(patchesTo("h-new-1")).toHaveLength(2));
    expect(patchesTo("h-new-1").map((c) => c.body)).toEqual([
      { output: "초안 글 수정" },
      { output: "짧게 줄인 글" },
    ]);
    await advance(5000);
    expect(patchesTo("h-new-1")).toHaveLength(2);
  });

  test("고친 글로 다듬기를 직접 입력해 보내도 같다", async () => {
    const user = await generatedForEditing();
    await user.type(resultBox(), " 수정");
    backend.generate = () => streamResponse([text("마지막 문단 뺀 글"), done]);
    await user.type(screen.getByPlaceholderText(refinePlaceholder), "마지막 문단 빼 줘{Enter}");
    await waitFor(() => expect(resultBox()).toHaveValue("마지막 문단 뺀 글"));
    const messages = (callsTo("/api/generate", "POST")[1].body as { messages: ChatMessage[] }).messages;
    expect(messages[1]).toEqual({ role: "assistant", content: "초안 글 수정" });
  });

  test("다듬기가 실패하면 고친 글로 돌아가고, 다시 시도도 고친 글로 보낸다", async () => {
    const user = await generatedForEditing();
    await user.type(resultBox(), " 수정");
    backend.generate = () => json({ error: { message: "잠시 후 다시" } }, 503);
    await user.click(screen.getByRole("button", { name: "더 짧게" }));
    await screen.findByText("잠시 후 다시");
    expect(resultBox()).toHaveValue("초안 글 수정");

    await user.type(resultBox(), "!");
    backend.generate = () => streamResponse([text("성공한 짧은 글"), done]);
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(resultBox()).toHaveValue("성공한 짧은 글"));
    const retried = callsTo("/api/generate", "POST")[2];
    expect((retried.body as { messages: ChatMessage[] }).messages).toEqual([
      { role: "user", content: "원래 메모" },
      { role: "assistant", content: "초안 글 수정!" },
      { role: "user", content: "더 짧게" },
    ]);
  });

  test("열어 둔 기록을 지우면 기다리던 저장은 취소되고 다시 만들거나 오류를 내지 않는다", async () => {
    const user = await generatedForEditing();
    await user.type(resultBox(), " 수정");
    await user.click(screen.getByRole("button", { name: "기록 삭제" }));
    await waitFor(() => expect(callsTo("/api/history/h-new-1", "DELETE")).toHaveLength(1));
    await waitFor(() => expect(screen.getByText("아직 기록이 없습니다.")).toBeInTheDocument());
    await advance(5000);

    expect(patchesTo("h-new-1")).toHaveLength(0);
    expect(callsTo("/api/history", "POST")).toHaveLength(1);
    expect(screen.queryByText("저장하지 못했습니다.")).not.toBeInTheDocument();
    expect(resultBox()).toHaveValue("초안 글 수정");
  });

  test("다른 기록을 지워도 열어 둔 기록의 기다리던 저장은 그대로 보낸다", async () => {
    const user = await generatedForEditing({ historyItems: [OTHER()] });
    await user.type(resultBox(), " 수정");
    const other = (await screen.findByText("다른 메모")).closest("li");
    if (!other) throw new Error("li not found");
    await user.click(within(other).getByRole("button", { name: "기록 삭제" }));
    await waitFor(() => expect(callsTo("/api/history/h-other", "DELETE")).toHaveLength(1));
    await advance(1000);
    await waitFor(() => expect(patchesTo("h-new-1")).toHaveLength(1));
  });

  test("기다리는 저장이 있을 때 화면이 사라지면 그 기록에 한 번 보내고, 사라진 뒤에는 상태를 바꾸지 않는다", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = await generatedForEditing();
    await user.type(resultBox(), " 수정");
    const patched = patchesTo("h-new-1");
    expect(patched).toHaveLength(0);
    let release: () => void = () => {};
    backend.patch = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(json({ ...historyItem(), id: "h-new-1", output: "초안 글 수정" }));
      });
    screenUnmount();
    expect(patchesTo("h-new-1")).toHaveLength(1);
    expect(patchesTo("h-new-1")[0].body).toEqual({ output: "초안 글 수정" });
    expect(patchesTo("h-new-1")[0].keepalive).toBe(true);
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(patchesTo("h-new-1")).toHaveLength(1);
    expect(errors).not.toHaveBeenCalled();
  });

  test("기다리는 저장이 없으면 화면이 사라질 때 아무것도 보내지 않는다", async () => {
    await generatedForEditing();
    const before = calls.length;
    screenUnmount();
    expect(calls).toHaveLength(before);
  });

  test("탭을 닫거나 새로고침하는 순간(pagehide)에도 기다리는 저장을 보낸다", async () => {
    const user = await generatedForEditing();
    await user.type(resultBox(), " 수정");
    fireEvent(window, new Event("pagehide"));
    expect(patchesTo("h-new-1")).toHaveLength(1);
    expect(patchesTo("h-new-1")[0].keepalive).toBe(true);
    await advance(5000);
    expect(patchesTo("h-new-1")).toHaveLength(1);
  });
});
