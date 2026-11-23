import { defineConfig } from "@playwright/test";
import path from "node:path";
import { FAKE_BIN_DIR, tempRoot } from "./e2e/env";

const PORT = 4311;
const tmp = tempRoot();

export default defineConfig({
  testDir: "e2e",
  testIgnore: "real/**",
  fullyParallel: false,
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
  projects: [{ name: "chrome" }],
  webServer: {
    command: `node e2e/serve.mjs ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: `${FAKE_BIN_DIR}${path.delimiter}${process.env.PATH ?? ""}`,
      DATA_DIR: path.join(tmp, "data"),
      E2E_FAKE_LOG: path.join(tmp, "fake-claude.log"),
      E2E_FAKE_STATE_DIR: path.join(tmp, "fake-state"),
      // 서버가 자식 프로세스로 넘기지 않는지 확인하려고 일부러 넣는 가짜 값. .env.local의 실제 키보다 우선한다.
      ANTHROPIC_API_KEY: "e2e-canary-must-not-leak",
      CLAUDE_E2E_CANARY: "1",
      // .env.local에 CLAUDE_PROVIDER=api가 있어도 Claude Code 방식으로 돌도록 빈 값으로 덮는다.
      CLAUDE_PROVIDER: "",
      CLAUDE_MODEL: "",
    },
  },
});
