import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * 이번 실행에서 쓰는 임시 폴더. 설정 파일은 워커에서도 다시 읽히므로,
 * 처음 만든 경로를 환경 변수에 적어 두고 이후에는 그대로 쓴다.
 */
export function tempRoot(): string {
  const existing = process.env.E2E_TMP_DIR;
  if (existing) return existing;
  const created = mkdtempSync(path.join(tmpdir(), "format-writer-e2e-"));
  process.env.E2E_TMP_DIR = created;
  return created;
}

export const FAKE_BIN_DIR = path.join(__dirname, "bin");
