import { act } from "@testing-library/react";
import { vi } from "vitest";

/**
 * 저장 대기(setTimeout)만 가짜 시계로 바꾼다. Testing Library는 jest 전역이 있어야 가짜 타이머를 알아보고
 * 자기 대기(user-event, waitFor)를 가짜 시계로 흘려 보내므로 같이 둔다. 끝나면 vi.useRealTimers()와 vi.unstubAllGlobals()로 되돌린다.
 */
export function fakeSaveTimers(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("jest", { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
}

export const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** 가짜 시계를 끝내고 진짜 시계로 돌아간다. 이미 시작된 파일 입출력을 waitFor로 기다리려면 진짜 시계가 필요하다. */
export function realSaveTimers(): void {
  vi.useRealTimers();
  vi.stubGlobal("jest", undefined);
}
