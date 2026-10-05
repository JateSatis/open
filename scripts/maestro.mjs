// Запуск Maestro-сценариев из .maestro/ без ручной установки: CLI скачивается один раз в
// %LOCALAPPDATA%/open-tools, аналитика и баннеры выключены.
//
//   node scripts/maestro.mjs test .maestro/smoke.yaml        один сценарий
//   node scripts/maestro.mjs test .maestro                   все сценарии
//   node scripts/maestro.mjs --device emulator-5554 test ... конкретное устройство
//
// Аргументы передаются в maestro как есть. Нужна Java 17+ в PATH.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const VERSION = "2.11.0";
const BASE = `https://github.com/mobile-dev-inc/Maestro/releases/download/cli-${VERSION}`;
const TOOLS_DIR = join(process.env.LOCALAPPDATA ?? tmpdir(), "open-tools");
const HOME = join(TOOLS_DIR, `maestro-${VERSION}`);
const isWindows = process.platform === "win32";
const BIN = join(HOME, "maestro", "bin", isWindows ? "maestro.bat" : "maestro");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(cmd, args, timeout) {
  const res = spawnSync(cmd, args, { stdio: "inherit", timeout });
  if (res.error) fail(`${cmd}: ${res.error.message}`);
  if (res.status !== 0) fail(`${cmd} завершился с кодом ${res.status}`);
}

function install() {
  mkdirSync(HOME, { recursive: true });
  const zip = join(HOME, "maestro.zip");
  const sums = join(HOME, "checksums.txt");

  console.error(`Скачиваю Maestro ${VERSION}...`);
  run("curl", ["-sSL", "-o", zip, `${BASE}/maestro.zip`], 300_000);
  run("curl", ["-sSL", "-o", sums, `${BASE}/checksums_sha256.txt`], 60_000);

  const expected = readFileSync(sums, "utf8").match(/^([0-9a-f]{64})\s+maestro\.zip/m)?.[1];
  const actual = createHash("sha256").update(readFileSync(zip)).digest("hex");
  if (!expected || expected !== actual) {
    rmSync(HOME, { recursive: true, force: true });
    fail("Контрольная сумма maestro.zip не совпала — архив удалён.");
  }

  // Системный bsdtar: GNU tar из Git Bash, первый в PATH, zip не читает.
  const tar = isWindows ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "unzip";
  run(tar, isWindows ? ["-xf", zip, "-C", HOME] : ["-q", zip, "-d", HOME], 120_000);
  rmSync(zip);
  if (!existsSync(BIN)) fail(`Maestro не распаковался в ${HOME}`);
}

if (!existsSync(BIN)) install();

const res = spawnSync(BIN, process.argv.slice(2), {
  stdio: "inherit",
  // .bat запускается только через оболочку.
  shell: isWindows,
  env: {
    ...process.env,
    MAESTRO_CLI_NO_ANALYTICS: "1",
    MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true",
    MAESTRO_DISABLE_UPDATE_CHECK: "true",
    // Без этого кириллица из сценариев печатается в кодовой странице Windows — вопросами.
    MAESTRO_OPTS: "-Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8",
  },
});

process.exit(res.status ?? 1);
