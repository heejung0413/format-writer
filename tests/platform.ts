import { vi } from "vitest";

/** navigator.platform을 바꾼다. 호출한 테스트 파일의 afterEach에서 vi.restoreAllMocks()로 되돌린다. */
export function mockPlatform(platform: string): void {
  vi.spyOn(window.navigator, "platform", "get").mockReturnValue(platform);
}
