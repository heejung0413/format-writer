// 앱 코드를 하나도 import하지 않는다. vi.mock 팩토리가 이 파일만 불러와 순환 로딩을 피한다.
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

type SpawnOptions = { cwd?: string; env?: Record<string, string | undefined> };

export class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  killed = false;
  written = "";
  private resolveKilled: () => void = () => {};
  private killedPromise = new Promise<void>((resolve) => {
    this.resolveKilled = resolve;
  });

  constructor() {
    super();
    this.stdin.on("data", (chunk) => (this.written += chunk.toString()));
  }

  /** kill()이 불릴 때까지 기다린다. 중단 시나리오의 스크립트가 쓴다. */
  untilKilled(): Promise<void> {
    return this.killedPromise;
  }

  kill(): boolean {
    this.killed = true;
    this.resolveKilled();
    this.finish(null);
    return true;
  }

  /** stream-json의 text_delta 이벤트 한 줄. */
  say(text: string): void {
    this.stdout.write(
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text } },
      }) + "\n",
    );
  }

  /** 마지막 result 이벤트 한 줄. */
  result(fields: Record<string, unknown> = {}): void {
    this.stdout.write(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        stop_reason: "end_turn",
        ...fields,
      }) + "\n",
    );
  }

  err(text: string): void {
    this.stderr.write(text);
  }

  close(code: number | null = 0): void {
    this.finish(code);
  }

  /** spawn 자체가 실패한 경우처럼 error 이벤트를 내고 입출력을 닫는다. */
  fail(error: NodeJS.ErrnoException): void {
    this.emit("error", error);
    this.stdout.end();
    this.stderr.end();
  }

  private finish(code: number | null): void {
    if (this.exitCode !== null || this.stdout.writableEnded) return;
    this.exitCode = code ?? 143;
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit("close", code));
  }
}

export type ClaudeRun = {
  command: string;
  args: string[];
  cwd: string | undefined;
  env: Record<string, string | undefined>;
  child: FakeChild;
  /** claude가 stdin으로 받은 프롬프트 전체. */
  readonly stdin: string;
  /** `--system-prompt` 다음 인자. */
  readonly system: string;
};

export type Script = (child: FakeChild, run: ClaudeRun) => void | Promise<void>;

/** delta들을 차례로 내고 정상 종료한다. */
export function reply(...parts: string[]): Script {
  return replyWith(parts, {});
}

export function replyWith(parts: string[], resultFields: Record<string, unknown>): Script {
  return (child) => {
    for (const part of parts) child.say(part);
    child.result(resultFields);
    child.close(0);
  };
}

class ClaudeRegistry {
  runs: ClaudeRun[] = [];
  /** 스크립트 없이 spawn이 불렸거나 claude가 아닌 명령이 실행된 횟수. */
  unexpected = 0;
  scriptErrors: unknown[] = [];
  private scripts: Script[] = [];

  reset(): void {
    this.runs = [];
    this.unexpected = 0;
    this.scriptErrors = [];
    this.scripts = [];
  }

  /** 다음 spawn 한 번이 따를 동작을 등록한다. */
  script(...next: Script[]): void {
    this.scripts.push(...next);
  }

  get pendingScripts(): number {
    return this.scripts.length;
  }

  take(): Script | undefined {
    return this.scripts.shift();
  }
}

export const claude = new ClaudeRegistry();

export function fakeSpawn(
  command: string,
  args: string[],
  options: SpawnOptions = {},
): ChildProcessWithoutNullStreams {
  const script = claude.take();
  if (command !== "claude" || !script) {
    claude.unexpected += 1;
    throw new Error(`예상하지 못한 spawn: ${command} (스크립트가 없거나 claude가 아님)`);
  }
  const child = new FakeChild();
  const run: ClaudeRun = {
    command,
    args,
    cwd: options.cwd,
    env: { ...options.env },
    child,
    get stdin() {
      return child.written;
    },
    get system() {
      const at = args.indexOf("--system-prompt");
      return at >= 0 ? args[at + 1] : "";
    },
  };
  claude.runs.push(run);
  setImmediate(() => {
    void Promise.resolve(script(child, run)).catch((e: unknown) => claude.scriptErrors.push(e));
  });
  return child as unknown as ChildProcessWithoutNullStreams;
}
