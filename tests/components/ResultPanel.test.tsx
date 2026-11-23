// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ResultPanel } from "@/components/ResultPanel";

function setup(overrides: Partial<Parameters<typeof ResultPanel>[0]> = {}) {
  const handlers = { onRetry: vi.fn(), onRefine: vi.fn(), onEdit: vi.fn() };
  render(
    <ResultPanel
      output=""
      busy={false}
      error={null}
      canRefine={false}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

const refinePlaceholder = /수정 지시를 입력하세요/;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const resultBox = () => screen.getByRole("textbox", { name: "결과" });

describe("ResultPanel 표시", () => {
  test("출력이 없고 busy가 아니면 빈 상태 안내를 보여 준다", () => {
    setup();
    expect(screen.getByText("작성한 글이 여기에 나옵니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "복사" })).not.toBeInTheDocument();
  });

  test("출력이 없고 busy이면 작성 중 문구를 보여 준다", () => {
    setup({ busy: true });
    expect(screen.getByText("작성 중...")).toBeInTheDocument();
    expect(screen.queryByText("작성한 글이 여기에 나옵니다.")).not.toBeInTheDocument();
  });

  test("출력이 있으면 줄바꿈을 그대로 담은 결과 입력 칸을 보여 준다", () => {
    setup({ output: "제목: 안내\n\n본문" });
    expect(resultBox().tagName).toBe("TEXTAREA");
    expect(resultBox()).toHaveValue("제목: 안내\n\n본문");
    expect(screen.queryByText("작성한 글이 여기에 나옵니다.")).not.toBeInTheDocument();
  });

  test("출력이 없으면 결과 입력 칸 없이 안내 문구만 보인다", () => {
    setup();
    expect(screen.queryByRole("textbox", { name: "결과" })).not.toBeInTheDocument();
  });

  test("에러가 없으면 배너와 다시 시도가 없다", () => {
    setup();
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
  });

  test("에러가 있으면 메시지와 다시 시도를 보여 주고 누르면 onRetry를 부른다", async () => {
    const h = setup({ error: "요청에 실패했습니다." });
    expect(screen.getByText("요청에 실패했습니다.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(h.onRetry).toHaveBeenCalledOnce();
  });
});

describe("ResultPanel 복사", () => {
  test("출력이 있고 busy가 아니면 복사 버튼이 있다", () => {
    setup({ output: "본문" });
    expect(screen.getByRole("button", { name: "복사" })).toBeInTheDocument();
  });

  test("busy이면 출력이 있어도 복사 버튼이 없다", () => {
    setup({ output: "쓰는 중", busy: true });
    expect(screen.queryByRole("button", { name: "복사" })).not.toBeInTheDocument();
  });

  test("복사를 누르면 출력을 클립보드에 쓰고 복사됨을 보여 준다", async () => {
    const user = userEvent.setup();
    setup({ output: "복사할 본문" });
    await user.click(screen.getByRole("button", { name: "복사" }));
    expect(await screen.findByRole("button", { name: "복사됨" })).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe("복사할 본문");
  });

  test("복사됨은 1.5초 뒤 다시 복사로 돌아온다", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    setup({ output: "본문" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "복사" }));
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith("본문");
    expect(screen.getByRole("button", { name: "복사됨" })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1400);
    });
    expect(screen.getByRole("button", { name: "복사됨" })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole("button", { name: "복사" })).toBeInTheDocument();
  });
});

describe("ResultPanel 다듬기", () => {
  test("canRefine이 false이면 다듬기 영역이 없다", () => {
    setup({ output: "본문" });
    expect(screen.queryByRole("button", { name: "더 짧게" })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(refinePlaceholder)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다듬기" })).not.toBeInTheDocument();
  });

  test("canRefine이면 빠른 버튼과 입력창이 보인다", () => {
    setup({ output: "본문", canRefine: true });
    expect(screen.getByRole("button", { name: "더 짧게" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "더 공손하게" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(refinePlaceholder)).toBeInTheDocument();
  });

  test("더 짧게 / 더 공손하게는 그 문구로 onRefine을 부른다", async () => {
    const h = setup({ output: "본문", canRefine: true });
    await userEvent.click(screen.getByRole("button", { name: "더 짧게" }));
    await userEvent.click(screen.getByRole("button", { name: "더 공손하게" }));
    expect(h.onRefine).toHaveBeenNthCalledWith(1, "더 짧게");
    expect(h.onRefine).toHaveBeenNthCalledWith(2, "더 공손하게");
  });

  test("지시가 비어 있거나 공백뿐이면 다듬기가 비활성이다", async () => {
    setup({ output: "본문", canRefine: true });
    const button = screen.getByRole("button", { name: "다듬기" });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText(refinePlaceholder), "   ");
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText(refinePlaceholder), "x");
    expect(button).toBeEnabled();
  });

  test("다듬기를 누르면 앞뒤 공백을 자른 지시로 onRefine을 부르고 입력창을 비운다", async () => {
    const h = setup({ output: "본문", canRefine: true });
    const input = screen.getByPlaceholderText(refinePlaceholder);
    await userEvent.type(input, "  마지막 문단 빼 줘  ");
    await userEvent.click(screen.getByRole("button", { name: "다듬기" }));
    expect(h.onRefine).toHaveBeenCalledExactlyOnceWith("마지막 문단 빼 줘");
    expect(input).toHaveValue("");
    expect(screen.getByRole("button", { name: "다듬기" })).toBeDisabled();
  });

  test("Enter를 누르면 다듬기와 같이 제출한다", async () => {
    const h = setup({ output: "본문", canRefine: true });
    const input = screen.getByPlaceholderText(refinePlaceholder);
    await userEvent.type(input, "더 부드럽게{Enter}");
    expect(h.onRefine).toHaveBeenCalledExactlyOnceWith("더 부드럽게");
    expect(input).toHaveValue("");
  });

  test("입력이 비어 있을 때 Enter는 아무것도 하지 않는다", async () => {
    const h = setup({ output: "본문", canRefine: true });
    await userEvent.type(screen.getByPlaceholderText(refinePlaceholder), "{Enter}");
    expect(h.onRefine).not.toHaveBeenCalled();
  });

  test("한글 조합 중(isComposing)인 Enter는 제출하지 않는다", () => {
    const h = setup({ output: "본문", canRefine: true });
    const input = screen.getByPlaceholderText(refinePlaceholder);
    fireEvent.change(input, { target: { value: "한글" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(h.onRefine).not.toHaveBeenCalled();
    expect(input).toHaveValue("한글");

    fireEvent.keyDown(input, { key: "Enter", isComposing: false });
    expect(h.onRefine).toHaveBeenCalledExactlyOnceWith("한글");
  });

  test("Enter 이외의 키는 제출하지 않는다", () => {
    const h = setup({ output: "본문", canRefine: true });
    const input = screen.getByPlaceholderText(refinePlaceholder);
    fireEvent.change(input, { target: { value: "지시" } });
    fireEvent.keyDown(input, { key: "a" });
    expect(h.onRefine).not.toHaveBeenCalled();
  });
});

function Controlled(props: { initial: string; onEdit: (text: string) => void; busy?: boolean }) {
  const [output, setOutput] = useState(props.initial);
  return (
    <ResultPanel
      output={output}
      busy={props.busy ?? false}
      error={null}
      canRefine={false}
      onRetry={() => {}}
      onRefine={() => {}}
      onEdit={(text) => {
        setOutput(text);
        props.onEdit(text);
      }}
    />
  );
}

describe("ResultPanel 편집", () => {
  test("작성이 끝나면 고칠 수 있고 입력할 때마다 onEdit에 전체 글을 넘긴다", async () => {
    const onEdit = vi.fn();
    render(<Controlled initial="초안" onEdit={onEdit} />);
    expect(resultBox()).not.toHaveAttribute("readonly");
    await userEvent.type(resultBox(), "!{Enter}둘째 줄");
    expect(onEdit).toHaveBeenNthCalledWith(1, "초안!");
    expect(onEdit).toHaveBeenLastCalledWith("초안!\n둘째 줄");
    expect(resultBox()).toHaveValue("초안!\n둘째 줄");
  });

  test("작성 중에는 읽기 전용이라 입력해도 onEdit을 부르지 않는다", async () => {
    const h = setup({ output: "쓰는 중", busy: true });
    expect(resultBox()).toHaveAttribute("readonly");
    await userEvent.type(resultBox(), "추가");
    expect(h.onEdit).not.toHaveBeenCalled();
    expect(resultBox()).toHaveValue("쓰는 중");
  });

  test("hasResult가 true이면 글을 모두 지워 빈 칸이 되어도 입력 칸이 남아 다시 쓸 수 있다", async () => {
    const h = setup({ output: "", hasResult: true });
    expect(resultBox()).toHaveValue("");
    await userEvent.type(resultBox(), "새");
    expect(h.onEdit).toHaveBeenCalledWith("새");
    expect(screen.queryByRole("button", { name: "복사" })).not.toBeInTheDocument();
  });

  test("저장 상태가 saved이면 저장됨, failed이면 저장하지 못했습니다를 결과 칸 아래에 보인다", () => {
    const view = render(
      <ResultPanel output="본문" busy={false} error={null} canRefine={false} saveStatus="saved" onRetry={() => {}} onRefine={() => {}} onEdit={() => {}} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("저장됨");
    view.rerender(
      <ResultPanel output="본문" busy={false} error={null} canRefine={false} saveStatus="failed" onRetry={() => {}} onRefine={() => {}} onEdit={() => {}} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("저장하지 못했습니다.");
    view.rerender(
      <ResultPanel output="본문" busy={false} error={null} canRefine={false} saveStatus={null} onRetry={() => {}} onRefine={() => {}} onEdit={() => {}} />,
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
