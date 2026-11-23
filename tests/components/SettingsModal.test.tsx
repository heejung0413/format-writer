// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SettingsModal } from "@/components/SettingsModal";

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

async function setup(saved = { signature: "" }) {
  fetchMock.mockResolvedValueOnce(respond(saved));
  const onClose = vi.fn();
  render(<SettingsModal onClose={onClose} />);
  const box = await screen.findByLabelText("서명");
  await vi.waitFor(() => expect(box).toBeEnabled());
  return { onClose, box };
}

const save = () => screen.getByRole("button", { name: "저장" });

describe("SettingsModal", () => {
  test("설정 대화상자에 서명 입력 칸과 저장·닫기 버튼이 있다", async () => {
    await setup();
    expect(screen.getByRole("dialog", { name: "설정" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "설정" })).toBeInTheDocument();
    expect(screen.getByLabelText("서명").tagName).toBe("TEXTAREA");
    expect(save()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "닫기" })).toBeInTheDocument();
  });

  test("열릴 때 GET /api/settings로 저장된 서명을 읽어 채운다", async () => {
    const { box } = await setup({ signature: "홍길동\n개발팀" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/settings");
    expect(fetchMock.mock.calls[0][1]?.method ?? "GET").toBe("GET");
    expect(box).toHaveValue("홍길동\n개발팀");
  });

  test("불러오는 동안에는 입력과 저장이 잠긴다", async () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    render(<SettingsModal onClose={vi.fn()} />);
    expect(screen.getByLabelText("서명")).toBeDisabled();
    expect(save()).toBeDisabled();
  });

  test("불러오지 못하면 오류를 보여 주고 빈 값으로 덮어쓰지 못하게 저장을 잠근다", async () => {
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 500 }));
    render(<SettingsModal onClose={vi.fn()} />);
    expect(await screen.findByText("설정을 불러오지 못했습니다.")).toBeInTheDocument();
    expect(save()).toBeDisabled();
    expect(screen.getByLabelText("서명")).toBeDisabled();
  });

  test("네트워크 오류로 불러오지 못해도 같은 오류를 보여 준다", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<SettingsModal onClose={vi.fn()} />);
    expect(await screen.findByText("설정을 불러오지 못했습니다.")).toBeInTheDocument();
  });

  test("저장하면 PUT /api/settings로 서명을 JSON으로 보내고 모달을 닫는다", async () => {
    const { box, onClose } = await setup();
    fetchMock.mockResolvedValueOnce(respond({ signature: "홍길동" }));
    await userEvent.type(box, "홍길동{Enter}개발팀");
    await userEvent.click(save());

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toBe("/api/settings");
    expect(init?.method).toBe("PUT");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({ signature: "홍길동\n개발팀" });
  });

  test("서명을 비워 저장할 수도 있다", async () => {
    const { box, onClose } = await setup({ signature: "홍길동" });
    fetchMock.mockResolvedValueOnce(respond({ signature: "" }));
    await userEvent.clear(box);
    await userEvent.click(save());
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ signature: "" });
  });

  test("저장이 실패하면 서버 메시지를 보여 주고 닫지 않으며 입력을 남긴다", async () => {
    const { box, onClose } = await setup();
    fetchMock.mockResolvedValueOnce(
      respond({ error: { code: "bad_request", message: "서명이 너무 깁니다." } }, 400),
    );
    await userEvent.type(box, "내 서명");
    await userEvent.click(save());
    expect(await screen.findByText("서명이 너무 깁니다.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(box).toHaveValue("내 서명");
  });

  test("실패 응답에 메시지가 없으면 기본 문구를 보여 준다", async () => {
    const { box } = await setup();
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 500 }));
    await userEvent.type(box, "x");
    await userEvent.click(save());
    expect(await screen.findByText("저장하지 못했습니다.")).toBeInTheDocument();
  });

  test("입력 칸은 500자까지만 받는다", async () => {
    const { box } = await setup();
    expect(box).toHaveAttribute("maxlength", "500");
  });

  test("닫기를 누르면 저장하지 않고 onClose를 부른다", async () => {
    const { onClose } = await setup();
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
