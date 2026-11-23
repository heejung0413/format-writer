import { expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import Home from "@/app/page";

export type User = ReturnType<typeof userEvent.setup>;

export const INPUT = /전하고 싶은 내용을/;

/** Home을 그리고 포맷·기록 불러오기가 끝날 때까지 기다린다. */
export async function openHome(): Promise<{ user: User; unmount: () => void }> {
  const view = render(createElement(Home));
  const select = screen.getByLabelText("포맷");
  await waitFor(() => expect(within(select).queryAllByRole("option").length).toBeGreaterThan(0));
  const advanceTimers = (ms: number) => {
    if (vi.isFakeTimers()) vi.advanceTimersByTime(ms);
  };
  return { user: userEvent.setup({ advanceTimers }), unmount: view.unmount };
}

export const formatNames = () =>
  within(screen.getByLabelText("포맷"))
    .getAllByRole("option")
    .map((o) => o.textContent);

export async function write(user: User, notes: string) {
  const box = screen.getByPlaceholderText(INPUT);
  await user.clear(box);
  await user.type(box, notes);
}

export const submit = (user: User) => user.click(screen.getByRole("button", { name: "작성하기" }));

export async function choose(user: User, label: "포맷" | "받는 사람" | "말투" | "길이", value: string) {
  await user.selectOptions(screen.getByLabelText(label), value);
}

/** 결과 칸(textarea, 이름 "결과")에 지금 보이는 글. */
export const resultText = () =>
  (screen.queryByRole("textbox", { name: "결과" }) as HTMLTextAreaElement | null)?.value ?? "";

export const resultBox = () => screen.getByRole("textbox", { name: "결과" });

/** 왼쪽 작성 기록 영역. */
export const sidebar = () => within(screen.getByRole("complementary"));

export const banner = (text: string) => screen.findByText(text);
