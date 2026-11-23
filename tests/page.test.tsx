// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import Home from "@/app/page";
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

type Call = { url: string; method: string; body: unknown; signal: AbortSignal | null | undefined };

type Backend = {
  formats: Format[];
  history: HistoryItem[];
  generate: (call: Call) => Response | Promise<Response>;
  formatsResponse?: () => Response;
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
      };
      calls.push(call);

      if (url === "/api/formats" && method === "GET") {
        return backend.formatsResponse ? backend.formatsResponse() : json(backend.formats);
      }
      if (url === "/api/history" && method === "GET") return json(backend.history);
      if (url === "/api/generate") return backend.generate(call);
      if (url === "/api/history" && method === "POST") {
        const created: HistoryItem = {
          ...(call.body as Omit<HistoryItem, "id" | "createdAt">),
          id: `h-new-${nextId++}`,
          createdAt: new Date(2026, 10, 5, 9, 7).toISOString(),
        };
        return json(created, 201);
      }
      const historyMatch = url.match(/^\/api\/history\/(.+)$/);
      if (historyMatch && method === "PATCH") {
        const output = (call.body as { output: string }).output;
        const base = backend.history.find((h) => h.id === historyMatch[1]) ?? historyItem();
        return json({ ...base, id: historyMatch[1], output });
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
  vi.unstubAllGlobals();
});

const inputPlaceholder = /전하고 싶은 내용을/;
const refinePlaceholder = /수정 지시를 입력하세요/;

async function renderLoaded() {
  render(<Home />);
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
      messages: [{ role: "user", content: "메모 내용" }],
    });
    expect(call.signal).toBeInstanceOf(AbortSignal);
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
