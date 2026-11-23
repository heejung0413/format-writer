// E2E 서버 실행기: 개발 서버(.next)와 겹치지 않도록 별도 폴더(.next-e2e)에 프로덕션 빌드를 만들고 `next start`로 띄운다.
// 사용법: node e2e/serve.mjs <포트>   (Playwright의 webServer가 호출한다)
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = process.argv[2] ?? "4311";
const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const env = { ...process.env, NEXT_DIST_DIR: ".next-e2e", NODE_ENV: "production" };

// `next build`는 next-env.d.ts를 새 빌드 폴더 기준으로 다시 쓴다. 개발 서버가 쓰는 파일이므로 빌드 뒤에 되돌려 둔다.
const typesFile = `${root}next-env.d.ts`;
const typesBackup = `${root}next-env.d.ts.e2e-backup`;
const hadTypes = existsSync(typesFile);
if (hadTypes) copyFileSync(typesFile, typesBackup);
const build = spawnSync(process.execPath, [nextBin, "build"], { cwd: root, env, stdio: "inherit" });
if (hadTypes) {
  copyFileSync(typesBackup, typesFile);
  spawnSync("rm", ["-f", typesBackup]);
}
if (build.status !== 0) process.exit(build.status ?? 1);

const server = spawn(process.execPath, [nextBin, "start", "-p", port], { cwd: root, env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 0));
