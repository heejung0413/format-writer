// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { InputPanel } from "@/components/InputPanel";

function setup(overrides: Partial<Parameters<typeof InputPanel>[0]> = {}) {
  const handlers = { onChange: vi.fn(), onSubmit: vi.fn(), onStop: vi.fn() };
  render(<InputPanel value="" busy={false} canSubmit={true} {...handlers} {...overrides} />);
  return handlers;
}

const placeholder = /전하고 싶은 내용을/;

describe("InputPanel", () => {
  test("받은 value를 입력창에 보여 준다", () => {
    setup({ value: "회의 연기" });
    expect(screen.getByPlaceholderText(placeholder)).toHaveValue("회의 연기");
  });

  test("타이핑하면 입력창 전체 값으로 onChange를 부른다", async () => {
    const h = setup();
    await userEvent.type(screen.getByPlaceholderText(placeholder), "ab");
    expect(h.onChange).toHaveBeenCalledTimes(2);
    expect(h.onChange).toHaveBeenNthCalledWith(1, "a");
    expect(h.onChange).toHaveBeenNthCalledWith(2, "b");
  });

  test("canSubmit이면 작성하기를 눌러 onSubmit을 부른다", async () => {
    const h = setup();
    await userEvent.click(screen.getByRole("button", { name: "작성하기" }));
    expect(h.onSubmit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "중단" })).not.toBeInTheDocument();
  });

  test("canSubmit이 false이면 작성하기가 비활성이고 눌러도 부르지 않는다", async () => {
    const h = setup({ canSubmit: false });
    const button = screen.getByRole("button", { name: "작성하기" });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(h.onSubmit).not.toHaveBeenCalled();
  });

  test("busy이면 중단 버튼만 보이고 누르면 onStop을 부른다", async () => {
    const h = setup({ busy: true });
    expect(screen.queryByRole("button", { name: "작성하기" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "중단" }));
    expect(h.onStop).toHaveBeenCalledOnce();
    expect(h.onSubmit).not.toHaveBeenCalled();
  });

  test("busy이면 입력창이 잠긴다", () => {
    setup({ busy: true, canSubmit: false });
    expect(screen.getByPlaceholderText(placeholder)).toBeDisabled();
    expect(screen.getByRole("button", { name: "중단" })).toBeEnabled();
  });

  test("busy가 아니면 입력창이 활성이다", () => {
    setup();
    expect(screen.getByPlaceholderText(placeholder)).toBeEnabled();
  });
});
