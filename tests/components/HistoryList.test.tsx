// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { HistoryList } from "@/components/HistoryList";
import type { HistoryItem } from "@/lib/types";

function item(overrides: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id: "h1",
    createdAt: new Date(2026, 10, 5, 9, 7).toISOString(),
    formatId: "mail",
    formatName: "메일",
    recipient: "상사",
    tone: "격식",
    input: "회의 연기 안내",
    output: "본문",
    ...overrides,
  };
}

function setup(items: HistoryItem[], activeId: string | null = null) {
  const handlers = { onSelect: vi.fn(), onDelete: vi.fn() };
  render(<HistoryList items={items} activeId={activeId} {...handlers} />);
  return handlers;
}

describe("HistoryList", () => {
  test("기록이 없으면 안내 문구를 보여 주고 목록은 없다", () => {
    setup([]);
    expect(screen.getByText("작성 기록")).toBeInTheDocument();
    expect(screen.getByText("아직 기록이 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  test("기록이 있으면 안내 문구를 숨기고 항목마다 하나씩 보여 준다", () => {
    setup([item(), item({ id: "h2", input: "두번째" })]);
    expect(screen.queryByText("아직 기록이 없습니다.")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  test("날짜 · 포맷 이름과 입력 내용을 보여 준다 (한 자리 월·일, 두 자리 시·분)", () => {
    setup([item()]);
    expect(screen.getByText("11/5 09:07 · 메일")).toBeInTheDocument();
    expect(screen.getByText("회의 연기 안내")).toBeInTheDocument();
  });

  test("항목을 누르면 그 기록으로 onSelect를 부른다", async () => {
    const target = item({ id: "h2", input: "두번째 글" });
    const h = setup([item(), target]);
    await userEvent.click(screen.getByRole("button", { name: /두번째 글/ }));
    expect(h.onSelect).toHaveBeenCalledExactlyOnceWith(target);
  });

  test("삭제 버튼은 해당 항목의 id로 onDelete를 부르고 선택은 부르지 않는다", async () => {
    const h = setup([item(), item({ id: "h2", input: "두번째 글" })]);
    const second = screen.getAllByRole("listitem")[1];
    await userEvent.click(within(second).getByRole("button", { name: "기록 삭제" }));
    expect(h.onDelete).toHaveBeenCalledExactlyOnceWith("h2");
    expect(h.onSelect).not.toHaveBeenCalled();
  });

  test("activeId와 같은 항목만 강조한다", () => {
    setup([item(), item({ id: "h2", input: "두번째 글" })], "h2");
    const [first, second] = screen.getAllByRole("listitem");
    expect(second).toHaveClass("bg-blue-50");
    expect(first).not.toHaveClass("bg-blue-50");
  });

  test("activeId가 null이면 강조 항목이 없다", () => {
    setup([item()], null);
    expect(screen.getByRole("listitem")).not.toHaveClass("bg-blue-50");
  });
});
