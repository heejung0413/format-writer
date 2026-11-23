// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { OptionBar } from "@/components/OptionBar";
import type { Format } from "@/lib/types";

const formats: Format[] = [
  { id: "mail", name: "메일", instruction: "m" },
  { id: "chat", name: "채팅", instruction: "c" },
];

function setup(overrides: Partial<Parameters<typeof OptionBar>[0]> = {}) {
  const handlers = {
    onFormatChange: vi.fn(),
    onRecipientChange: vi.fn(),
    onToneChange: vi.fn(),
    onLengthChange: vi.fn(),
    onManage: vi.fn(),
  };
  render(
    <OptionBar
      formats={formats}
      formatId="mail"
      recipient="없음"
      tone="보통"
      length="보통"
      disabled={false}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe("OptionBar", () => {
  test("포맷 목록과 현재 선택값을 보여 준다", () => {
    setup({ formatId: "chat" });
    const select = screen.getByLabelText("포맷");
    expect(screen.getByRole("option", { name: "메일" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "채팅" })).toBeInTheDocument();
    expect(select).toHaveValue("chat");
  });

  test("받는 사람, 말투, 길이 선택지를 모두 보여 준다", () => {
    setup();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "메일",
      "채팅",
      "없음",
      "상사",
      "동료",
      "고객",
      "격식",
      "보통",
      "편하게",
      "짧게",
      "보통",
      "자세히",
    ]);
    expect(screen.getByLabelText("길이")).toHaveValue("보통");
    expect(screen.getByLabelText("받는 사람")).toHaveValue("없음");
    expect(screen.getByLabelText("말투")).toHaveValue("보통");
  });

  test("포맷을 바꾸면 id로 onFormatChange를 부른다", async () => {
    const h = setup();
    await userEvent.selectOptions(screen.getByLabelText("포맷"), "채팅");
    expect(h.onFormatChange).toHaveBeenCalledExactlyOnceWith("chat");
  });

  test("받는 사람을 바꾸면 onRecipientChange를 부른다", async () => {
    const h = setup();
    await userEvent.selectOptions(screen.getByLabelText("받는 사람"), "상사");
    expect(h.onRecipientChange).toHaveBeenCalledExactlyOnceWith("상사");
  });

  test("말투를 바꾸면 onToneChange를 부른다", async () => {
    const h = setup();
    await userEvent.selectOptions(screen.getByLabelText("말투"), "격식");
    expect(h.onToneChange).toHaveBeenCalledExactlyOnceWith("격식");
  });

  test("길이를 바꾸면 onLengthChange를 부른다", async () => {
    const h = setup();
    await userEvent.selectOptions(screen.getByLabelText("길이"), "자세히");
    expect(h.onLengthChange).toHaveBeenCalledExactlyOnceWith("자세히");
  });

  test("길이 선택창은 말투 선택창 바로 다음에 있다", () => {
    setup();
    const selects = screen.getAllByRole("combobox");
    expect(selects).toHaveLength(4);
    expect(selects[2]).toBe(screen.getByLabelText("말투"));
    expect(selects[3]).toBe(screen.getByLabelText("길이"));
  });

  test("포맷 관리 버튼을 누르면 onManage를 부른다", async () => {
    const h = setup();
    await userEvent.click(screen.getByRole("button", { name: "포맷 관리" }));
    expect(h.onManage).toHaveBeenCalledOnce();
  });

  test("disabled이면 네 선택창이 모두 잠기고 포맷 관리는 눌린다", () => {
    setup({ disabled: true });
    expect(screen.getByLabelText("포맷")).toBeDisabled();
    expect(screen.getByLabelText("받는 사람")).toBeDisabled();
    expect(screen.getByLabelText("말투")).toBeDisabled();
    expect(screen.getByLabelText("길이")).toBeDisabled();
    expect(screen.getByRole("button", { name: "포맷 관리" })).toBeEnabled();
  });

  test("disabled가 아니면 선택창이 활성 상태다", () => {
    setup();
    expect(screen.getByLabelText("포맷")).toBeEnabled();
    expect(screen.getByLabelText("받는 사람")).toBeEnabled();
    expect(screen.getByLabelText("말투")).toBeEnabled();
    expect(screen.getByLabelText("길이")).toBeEnabled();
  });
});
