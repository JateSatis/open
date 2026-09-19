import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PORT = 8081;
const opts = { stdio: "inherit", shell: true };
// --open-only: Metro уже запущен в соседнем терминале, надо лишь открыть приложение.
const openOnly = process.argv.includes("--open-only");
// --device <serial>: работать с одним устройством, а не со всеми подключёнными.
const deviceFlag = process.argv.indexOf("--device");
const onlyDevice = deviceFlag === -1 ? null : process.argv[deviceFlag + 1];

// Схема приложения из app.json: по ней dev build ловит ссылку на Metro.
// В Expo Go это был exp://, но Expo Go нам больше не подходит — в нём нет
// нативных модулей проекта (вход через Apple и Google, камера, WebRTC).
const { expo } = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8"));
const devClientUrl = `${expo.scheme}://expo-development-client/?url=${encodeURIComponent(
  `http://127.0.0.1:${PORT}`,
)}`;

function listDevices() {
  const res = spawnSync("adb", ["devices"], { shell: true, encoding: "utf8" });

  if (res.status !== 0) {
    return [];
  }

  return res.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(/\s+/))
    .filter(([serial, state]) => serial && state === "device")
    .map(([serial]) => serial);
}

function reversePort(serial) {
  // Порт пробрасывается на каждое устройство отдельно: телефон и эмулятор
  // тянут бандл с одного Metro, но туннель у каждого свой.
  return spawnSync("adb", ["-s", serial, "reverse", `tcp:${PORT}`, `tcp:${PORT}`], opts).status === 0;
}

function openDevBuild(serial) {
  const open = spawnSync(
    "adb",
    ["-s", serial, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `"${devClientUrl}"`],
    opts,
  );

  if (open.status !== 0) {
    console.error(
      `\n${serial}: не удалось открыть приложение. Dev build установлен на этом устройстве?` +
        `\nЕсли нет — собери и поставь: npm run build:android`,
    );
  }

  return open.status === 0;
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

// 1. Находим устройства: телефон по USB, эмуляторы, или и то и другое сразу
const allDevices = listDevices();
const devices = onlyDevice ? allDevices.filter((d) => d === onlyDevice) : allDevices;

if (devices.length === 0) {
  console.error(
    onlyDevice
      ? `\nУстройство ${onlyDevice} не найдено. Подключено: ${allDevices.join(", ") || "ничего"}`
      : "\nНи одного устройства. Телефон подключён и отладка по USB включена? Эмулятор запущен?",
  );
  process.exit(1);
}

console.log(`Устройства: ${devices.join(", ")}`);

// 2. Пробрасываем порт на каждое
for (const serial of devices) {
  if (!reversePort(serial)) {
    console.error(`\n${serial}: adb reverse не сработал.`);
    process.exit(1);
  }
}

if (openOnly) {
  const ok = devices.map((serial) => openDevBuild(serial));
  process.exit(ok.every(Boolean) ? 0 : 1);
}

// 3. Поднимаем Metro — один на все устройства
const metro = spawn("npx", ["expo", "start", "--dev-client"], opts);
metro.on("exit", (code) => process.exit(code ?? 0));

// 4. Ждём готовности и открываем dev build везде
if (!(await waitForMetro())) {
  console.error("\nMetro не поднялся за 90 секунд. Открой приложение вручную: npm run usb:open");
} else {
  for (const serial of devices) {
    openDevBuild(serial);
  }
}
