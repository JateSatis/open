import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PORT = 8081;
const opts = { stdio: "inherit", shell: true };
// --open-only: Metro уже запущен в соседнем терминале, надо лишь открыть приложение.
const openOnly = process.argv.includes("--open-only");

// Схема приложения из app.json: по ней dev build ловит ссылку на Metro.
// В Expo Go это был exp://, но Expo Go нам больше не подходит — в нём нет
// нативных модулей проекта (вход через Apple и Google, камера, WebRTC).
const { expo } = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8"));
const devClientUrl = `${expo.scheme}://expo-development-client/?url=${encodeURIComponent(
  `http://127.0.0.1:${PORT}`,
)}`;

function openDevBuild() {
  const open = spawnSync(
    "adb",
    ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `"${devClientUrl}"`],
    opts,
  );

  if (open.status !== 0) {
    console.error(
      "\nНе удалось открыть приложение. Dev build установлен на телефоне?" +
        "\nЕсли нет — собери его: npm run build:android",
    );
  }

  return open.status ?? 1;
}

async function waitForMetro() {
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/status`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  return false;
}

// 1. Пробрасываем порт на телефон
const reverse = spawnSync("adb", ["reverse", `tcp:${PORT}`, `tcp:${PORT}`], opts);
if (reverse.status !== 0) {
  console.error("\nadb reverse не сработал. Телефон подключён, отладка по USB включена?");
  process.exit(1);
}

if (openOnly) {
  process.exit(openDevBuild());
}

// 2. Поднимаем Metro для dev build
const metro = spawn("npx", ["expo", "start", "--dev-client"], opts);
metro.on("exit", (code) => process.exit(code ?? 0));

// 3. Ждём готовности и открываем dev build
if (!(await waitForMetro())) {
  console.error("\nMetro не поднялся за 90 секунд. Открой приложение вручную: npm run usb:open");
} else {
  openDevBuild();
}
