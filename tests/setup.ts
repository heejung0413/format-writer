import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// 기본 대기 시간 1초는 느린 CI 러너에서 부족하다(기록 200건 화면에서 역할 조회가 1초를 넘긴다).
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});
