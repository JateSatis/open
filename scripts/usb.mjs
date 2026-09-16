import { spawn, spawnSync } from "node:child_process";

const PORT = 8081;
const opts = { stdio: "inherit", shell: true };

// 1. Пробрасываем порт на телефон
const reverse = spawnSync(
  "adb",
  ["reverse", `tcp:${PORT}`, `tcp:${PORT}`],
  opts,
);
if (reverse.status !== 0) {
  console.error(
    "\nadb reverse не сработал. Телефон подключён, отладка по USB включена?",
  );
  process.exit(1);
}

// 2. Поднимаем Metro
const metro = spawn("npx", ["expo", "start"], opts);
metro.on("exit", (code) => process.exit(code ?? 0));

// 3. Ждём готовности и открываем Expo Go
const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/status`);
    if (res.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

spawnSync(
  "adb",
  [
    "shell",
    "am",
    "start",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    `exp://127.0.0.1:${PORT}`,
  ],
  opts,
);
