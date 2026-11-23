import { rmSync } from "node:fs";

export default function globalTeardown() {
  const dir = process.env.E2E_TMP_DIR;
  if (dir) rmSync(dir, { recursive: true, force: true });
}
