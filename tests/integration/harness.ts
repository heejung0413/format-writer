import { cleanup } from "@testing-library/react";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, vi } from "vitest";
import * as formatItem from "@/app/api/formats/[id]/route";
import * as formats from "@/app/api/formats/route";
import * as generate from "@/app/api/generate/route";
import * as historyItem from "@/app/api/history/[id]/route";
import * as history from "@/app/api/history/route";
import { claude } from "./fake-claude";

type Context = { params: Promise<{ id: string }> };
type Handler = (req: Request, ctx: Context) => Response | Promise<Response>;

const ROUTES: { method: string; pattern: RegExp; handler: Handler }[] = [
  { method: "GET", pattern: /^\/api\/formats$/, handler: () => formats.GET() },
  { method: "POST", pattern: /^\/api\/formats$/, handler: (req) => formats.POST(req) },
  { method: "PUT", pattern: /^\/api\/formats\/([^/]+)$/, handler: formatItem.PUT },
  { method: "DELETE", pattern: /^\/api\/formats\/([^/]+)$/, handler: formatItem.DELETE },
  { method: "POST", pattern: /^\/api\/generate$/, handler: (req) => generate.POST(req) },
  { method: "GET", pattern: /^\/api\/history$/, handler: () => history.GET() },
  { method: "POST", pattern: /^\/api\/history$/, handler: (req) => history.POST(req) },
  { method: "PATCH", pattern: /^\/api\/history\/([^/]+)$/, handler: historyItem.PATCH },
  { method: "DELETE", pattern: /^\/api\/history\/([^/]+)$/, handler: historyItem.DELETE },
];

export type RequestLog = { method: string; path: string };

const ENV_KEYS = ["DATA_DIR", "ANTHROPIC_API_KEY", "CLAUDE_PROVIDER", "CLAUDE_MODEL"] as const;

export type Harness = {
  readonly dir: string;
  readonly claude: typeof claude;
  readonly requests: RequestLog[];
  readJson<T>(name: string): Promise<T>;
  writeJson(name: string, value: unknown): Promise<void>;
  writeRaw(name: string, text: string): Promise<void>;
  files(): Promise<string[]>;
};

/**
 * 화면(jsdom)의 fetch를 실제 라우트 핸들러로 연결한다.
 * 호출마다 진짜 Request를 만들어 메서드와 경로로 핸들러를 고르고, 핸들러가 돌려준 진짜 Response를 그대로 돌려준다.
 * 알 수 없는 경로는 던져서 오타가 조용히 넘어가지 않게 한다.
 * 이 vitest의 jsdom 환경은 AbortController를 Node 것 그대로 두므로 화면이 만든 signal을 Request에 바로 넘길 수 있다.
 */
function createRouter(requests: RequestLog[], inflight: Set<Promise<unknown>>) {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    for (const route of ROUTES) {
      const match = route.pattern.exec(url.pathname);
      if (route.method !== method || !match) continue;
      requests.push({ method, path: url.pathname });
      const request = new Request(url, {
        method,
        headers: init?.headers,
        body: init?.body,
        signal: init?.signal,
      });
      const id = match[1] === undefined ? "" : decodeURIComponent(match[1]);
      const done = Promise.resolve(route.handler(request, { params: Promise.resolve({ id }) }));
      inflight.add(done);
      void done.finally(() => inflight.delete(done)).catch(() => {});
      return done;
    }
    throw new Error(`테스트 라우터에 없는 요청입니다: ${method} ${url.pathname}`);
  };
}

/**
 * 테스트마다 임시 DATA_DIR, 가짜 fetch, 가짜 claude를 준비하고 끝나면 모두 되돌린다.
 * describe 바깥(파일 최상위)에서 한 번 부른다.
 */
export function setupHarness(): Harness {
  const state = { dir: "", requests: [] as RequestLog[] };
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};
  const inflight = new Set<Promise<unknown>>();

  beforeEach(async () => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    state.dir = await mkdtemp(path.join(tmpdir(), "fw-integration-"));
    state.requests = [];
    process.env.DATA_DIR = state.dir;
    process.env.ANTHROPIC_API_KEY = "sk-ant-integration-test";
    delete process.env.CLAUDE_PROVIDER;
    delete process.env.CLAUDE_MODEL;
    claude.reset();
    vi.stubGlobal("fetch", createRouter(state.requests, inflight));
  });

  afterEach(async () => {
    cleanup();
    await Promise.allSettled([...inflight]);
    for (const run of claude.runs) run.child.close(null);
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(state.dir, { recursive: true, force: true });
    const { unexpected, scriptErrors, pendingScripts } = claude;
    expect({ unexpected, scriptErrors, pendingScripts }).toEqual({
      unexpected: 0,
      scriptErrors: [],
      pendingScripts: 0,
    });
  });

  return {
    get dir() {
      return state.dir;
    },
    claude,
    get requests() {
      return state.requests;
    },
    async readJson<T>(name: string) {
      return JSON.parse(await readFile(path.join(state.dir, name), "utf8")) as T;
    },
    writeJson: (name, value) => writeFile(path.join(state.dir, name), JSON.stringify(value), "utf8"),
    writeRaw: (name, text) => writeFile(path.join(state.dir, name), text, "utf8"),
    files: () => readdir(state.dir),
  };
}

export function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
