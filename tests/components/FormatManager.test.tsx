// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { FormatManager } from "@/components/FormatManager";
import type { Format } from "@/lib/types";

const mail: Format = { id: "mail", name: "메일", instruction: "메일 지시", example: "예시 글" };
const chat: Format = { id: "chat", name: "채팅", instruction: "채팅 지시" };

const namePlaceholder = /이름 \(예: 주간보고\)/;
const instructionPlaceholder = /지시문:/;
const examplePlaceholder = /예시 글 \(선택\)/;

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(formats: Format[] = [mail, chat]) {
  const handlers = { onChange: vi.fn(), onClose: vi.fn() };
  render(<FormatManager formats={formats} {...handlers} />);
  return handlers;
}

function row(name: string): HTMLElement {
  const li = screen.getByText(name, { selector: "span" }).closest("li");
  if (!li) throw new Error(`row not found: ${name}`);
  return li;
}

function lastCall(): { url: string; init: RequestInit; body: unknown } {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  const raw = init?.body;
  return {
    url: String(url),
    init: init ?? {},
    body: typeof raw === "string" ? JSON.parse(raw) : undefined,
  };
}

describe("FormatManager 목록", () => {
  test("포맷마다 이름과 지시문을 보여 준다", () => {
    setup();
    expect(screen.getByRole("heading", { name: "포맷 관리" })).toBeInTheDocument();
    expect(within(row("메일")).getByText("메일 지시")).toBeInTheDocument();
    expect(within(row("채팅")).getByText("채팅 지시")).toBeInTheDocument();
  });

  test("닫기를 누르면 onClose를 부른다", async () => {
    const h = setup();
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(h.onClose).toHaveBeenCalledOnce();
  });

  test("포맷이 둘 이상이면 삭제 버튼이 활성이다", () => {
    setup();
    expect(within(row("메일")).getByRole("button", { name: "삭제" })).toBeEnabled();
    expect(within(row("채팅")).getByRole("button", { name: "삭제" })).toBeEnabled();
  });

  test("포맷이 하나 남으면 삭제 버튼이 비활성이고 눌러도 요청하지 않는다", async () => {
    setup([mail]);
    const button = within(row("메일")).getByRole("button", { name: "삭제" });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("FormatManager 추가", () => {
  test("처음에는 새 포맷 폼이고 이름·지시문이 비면 추가가 비활성이다", async () => {
    setup();
    expect(screen.getByRole("heading", { name: "새 포맷" })).toBeInTheDocument();
    const add = screen.getByRole("button", { name: "추가" });
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText(namePlaceholder), "주간보고");
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText(instructionPlaceholder), "   ");
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText(instructionPlaceholder), "요약해서");
    expect(add).toBeEnabled();
  });

  test("추가하면 POST /api/formats로 JSON을 보내고 새 포맷을 덧붙여 onChange를 부른다", async () => {
    const created: Format = { id: "weekly", name: "주간보고", instruction: "요약", example: "예" };
    fetchMock.mockResolvedValueOnce(respond(created, 201));
    const h = setup();

    await userEvent.type(screen.getByPlaceholderText(namePlaceholder), "주간보고");
    await userEvent.type(screen.getByPlaceholderText(instructionPlaceholder), "요약");
    await userEvent.type(screen.getByPlaceholderText(examplePlaceholder), "예");
    await userEvent.click(screen.getByRole("button", { name: "추가" }));

    await vi.waitFor(() => expect(h.onChange).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = lastCall();
    expect(call.url).toBe("/api/formats");
    expect(call.init.method).toBe("POST");
    expect(call.init.headers).toEqual({ "Content-Type": "application/json" });
    expect(call.body).toEqual({ id: null, name: "주간보고", instruction: "요약", example: "예" });
    expect(h.onChange).toHaveBeenCalledWith([mail, chat, created]);
  });

  test("추가에 성공하면 입력창이 비워진다", async () => {
    fetchMock.mockResolvedValueOnce(respond({ id: "x", name: "새", instruction: "지시" }, 201));
    const h = setup();
    await userEvent.type(screen.getByPlaceholderText(namePlaceholder), "새");
    await userEvent.type(screen.getByPlaceholderText(instructionPlaceholder), "지시");
    await userEvent.click(screen.getByRole("button", { name: "추가" }));
    await vi.waitFor(() => expect(h.onChange).toHaveBeenCalled());
    expect(screen.getByPlaceholderText(namePlaceholder)).toHaveValue("");
    expect(screen.getByPlaceholderText(instructionPlaceholder)).toHaveValue("");
    expect(screen.getByPlaceholderText(examplePlaceholder)).toHaveValue("");
  });

  test("서버가 실패하면 서버 메시지를 보여 주고 onChange를 부르지 않으며 입력을 남긴다", async () => {
    fetchMock.mockResolvedValueOnce(
      respond({ error: { code: "bad_request", message: "이름이 중복됩니다." } }, 400),
    );
    const h = setup();
    await userEvent.type(screen.getByPlaceholderText(namePlaceholder), "메일");
    await userEvent.type(screen.getByPlaceholderText(instructionPlaceholder), "지시");
    await userEvent.click(screen.getByRole("button", { name: "추가" }));

    expect(await screen.findByText("이름이 중복됩니다.")).toBeInTheDocument();
    expect(h.onChange).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText(namePlaceholder)).toHaveValue("메일");
  });

  test("실패 응답에 메시지가 없거나 JSON이 아니면 기본 메시지를 보여 준다", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>oops</html>", { status: 500 }));
    setup();
    await userEvent.type(screen.getByPlaceholderText(namePlaceholder), "a");
    await userEvent.type(screen.getByPlaceholderText(instructionPlaceholder), "b");
    await userEvent.click(screen.getByRole("button", { name: "추가" }));
    expect(await screen.findByText("저장에 실패했습니다.")).toBeInTheDocument();
  });

  test("다시 저장을 시도하면 이전 오류 메시지를 지운다", async () => {
    fetchMock
      .mockResolvedValueOnce(respond({ error: { message: "첫 실패" } }, 400))
      .mockResolvedValueOnce(respond({ id: "x", name: "a", instruction: "b" }, 201));
    const h = setup();
    await userEvent.type(screen.getByPlaceholderText(namePlaceholder), "a");
    await userEvent.type(screen.getByPlaceholderText(instructionPlaceholder), "b");
    await userEvent.click(screen.getByRole("button", { name: "추가" }));
    expect(await screen.findByText("첫 실패")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "추가" }));
    await vi.waitFor(() => expect(h.onChange).toHaveBeenCalledOnce());
    expect(screen.queryByText("첫 실패")).not.toBeInTheDocument();
  });
});

describe("FormatManager 수정", () => {
  test("수정을 누르면 그 행의 값이 폼에 채워지고 제목·버튼이 바뀐다", async () => {
    setup();
    await userEvent.click(within(row("메일")).getByRole("button", { name: "수정" }));
    expect(screen.getByRole("heading", { name: "포맷 수정" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(namePlaceholder)).toHaveValue("메일");
    expect(screen.getByPlaceholderText(instructionPlaceholder)).toHaveValue("메일 지시");
    expect(screen.getByPlaceholderText(examplePlaceholder)).toHaveValue("예시 글");
    expect(screen.getByRole("button", { name: "수정 저장" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "추가" })).not.toBeInTheDocument();
  });

  test("예시가 없는 포맷은 예시 칸이 빈 채로 채워진다", async () => {
    setup();
    await userEvent.click(within(row("채팅")).getByRole("button", { name: "수정" }));
    expect(screen.getByPlaceholderText(examplePlaceholder)).toHaveValue("");
  });

  test("수정 저장은 PUT /api/formats/:id로 보내고 해당 행만 바꿔 onChange를 부른다", async () => {
    const saved: Format = { id: "mail", name: "메일(수정)", instruction: "메일 지시", example: "예시 글" };
    fetchMock.mockResolvedValueOnce(respond(saved));
    const h = setup();

    await userEvent.click(within(row("메일")).getByRole("button", { name: "수정" }));
    await userEvent.type(screen.getByPlaceholderText(namePlaceholder), "(수정)");
    await userEvent.click(screen.getByRole("button", { name: "수정 저장" }));

    await vi.waitFor(() => expect(h.onChange).toHaveBeenCalledOnce());
    const call = lastCall();
    expect(call.url).toBe("/api/formats/mail");
    expect(call.init.method).toBe("PUT");
    expect(call.init.headers).toEqual({ "Content-Type": "application/json" });
    expect(call.body).toEqual({
      id: "mail",
      name: "메일(수정)",
      instruction: "메일 지시",
      example: "예시 글",
    });
    expect(h.onChange).toHaveBeenCalledWith([saved, chat]);
    expect(screen.getByRole("heading", { name: "새 포맷" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(namePlaceholder)).toHaveValue("");
  });

  test("수정 저장이 실패하면 오류를 보여 주고 수정 모드를 유지한다", async () => {
    fetchMock.mockResolvedValueOnce(respond({ error: { message: "저장 불가" } }, 400));
    const h = setup();
    await userEvent.click(within(row("메일")).getByRole("button", { name: "수정" }));
    await userEvent.click(screen.getByRole("button", { name: "수정 저장" }));
    expect(await screen.findByText("저장 불가")).toBeInTheDocument();
    expect(h.onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "포맷 수정" })).toBeInTheDocument();
  });

  test("취소를 누르면 폼이 비워지고 새 포맷 모드로 돌아가며 요청하지 않는다", async () => {
    setup();
    expect(screen.queryByRole("button", { name: "취소" })).not.toBeInTheDocument();
    await userEvent.click(within(row("메일")).getByRole("button", { name: "수정" }));
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.getByRole("heading", { name: "새 포맷" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(namePlaceholder)).toHaveValue("");
    expect(screen.queryByRole("button", { name: "취소" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("FormatManager 삭제", () => {
  test("삭제는 DELETE /api/formats/:id를 보내고 그 포맷을 뺀 목록으로 onChange를 부른다", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const h = setup();
    await userEvent.click(within(row("메일")).getByRole("button", { name: "삭제" }));
    await vi.waitFor(() => expect(h.onChange).toHaveBeenCalledOnce());
    const call = lastCall();
    expect(call.url).toBe("/api/formats/mail");
    expect(call.init.method).toBe("DELETE");
    expect(h.onChange).toHaveBeenCalledWith([chat]);
  });

  test("서버가 실패하면 삭제 실패 메시지를 보여 주고 onChange를 부르지 않는다", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    const h = setup();
    await userEvent.click(within(row("메일")).getByRole("button", { name: "삭제" }));
    expect(await screen.findByText("삭제에 실패했습니다.")).toBeInTheDocument();
    expect(h.onChange).not.toHaveBeenCalled();
  });

  test("수정 중인 포맷을 지우면 폼이 비워진다", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const h = setup();
    await userEvent.click(within(row("메일")).getByRole("button", { name: "수정" }));
    await userEvent.click(within(row("메일")).getByRole("button", { name: "삭제" }));
    await vi.waitFor(() => expect(h.onChange).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "새 포맷" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(namePlaceholder)).toHaveValue("");
  });

  test("다른 포맷을 수정 중일 때 지워도 폼은 그대로다", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const h = setup();
    await userEvent.click(within(row("메일")).getByRole("button", { name: "수정" }));
    await userEvent.click(within(row("채팅")).getByRole("button", { name: "삭제" }));
    await vi.waitFor(() => expect(h.onChange).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "포맷 수정" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(namePlaceholder)).toHaveValue("메일");
  });
});
