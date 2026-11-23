// 진짜 claude CLI를 쓰는 선택 실행용 설정. `npm run test:e2e:real`(E2E_REAL_CLAUDE=1)로만 쓴다.
// 가짜 claude를 PATH에 넣지 않고, 임시 데이터 폴더와 별도 포트(4312)로 서버를 띄운다.
import { defineConfig } from "@playwright/test";
import path from "node:path";
import { tempRoot } from "./e2e/env";

const PORT = 4312;
const tmp = tempRoot();

export default defineConfig({
  testDir: "e2e/real",
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "real-claude" }],
  webServer: {
    command: `node e2e/serve.mjs ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: { DATA_DIR: path.join(tmp, "data"), CLAUDE_PROVIDER: "" },
  },
});
