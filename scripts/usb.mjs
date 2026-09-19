import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = 8081;
const opts = { stdio: "inherit", shell: true };
// --open-only: Metro уже запущен в соседнем терминале, надо лишь открыть приложение.
const openOnly = process.argv.includes("--open-only");
// --no-emulator: работать только с тем, что уже подключено, эмулятор не поднимать.
const noEmulator = process.argv.includes("--no-emulator");
// --device <serial>: работать с одним устройством, а не со всеми подключёнными.
const deviceFlag = process.argv.indexOf("--device");
const onlyDevice = deviceFlag === -1 ? null : process.argv[deviceFlag + 1];

// Схема приложения из app.json: по ней dev build ловит ссылку на Metro.
// В Expo Go это был exp://, но Expo Go нам больше не подходит — в нём нет
// нативных модулей проекта (вход через Apple и Google, камера, WebRTC).
const { expo } = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8"));
const appId = expo.android.package;
const devClientUrl = `${expo.scheme}://expo-development-client/?url=${encodeURIComponent(
  `http://127.0.0.1:${PORT}`,
)}`;

const exe = process.platform === "win32" ? ".exe" : "";

/** Путь к SDK берётся из окружения, но переменная часто указывает не туда, поэтому проверяем. */
function findEmulatorBinary() {
  const candidates = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Android", "Sdk"),
    join(homedir(), "Android", "Sdk"),
    join(homedir(), "Library", "Android", "sdk"),
    "D:/Programs/Android/Sdk",
  ].filter(Boolean);

  for (const root of candidates) {
    const binary = join(root, "emulator", `emulator${exe}`);
    if (existsSync(binary)) {
      return binary;
    }
  }

  return null;
}

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

function pickAvd(binary) {
  const res = spawnSync(binary, ["-list-avds"], { encoding: "utf8" });
  const avds = (res.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (avds.length === 0) {
    return null;
  }

  // Телевизоры и часы не годятся под телефонное приложение, поэтому уходят в конец.
  const phones = avds.filter((name) => !/tv|television|wear|watch|tablet/i.test(name));

  return process.env.OPEN_AVD ?? (phones.includes("open_test") ? "open_test" : (phones[0] ?? avds[0]));
}

async function waitFor(check, timeoutMs, stepMs = 2000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await check()) {
      return true;
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }

  return false;
}

function isBooted(serial) {
  const res = spawnSync("adb", ["-s", serial, "shell", "getprop", "sys.boot_completed"], {
    shell: true,
    encoding: "utf8",
  });

  return (res.stdout ?? "").trim() === "1";
}

async function startEmulator() {
  const binary = findEmulatorBinary();

  if (binary === null) {
    console.error(
      "\nЭмулятор не найден. Укажи путь к SDK: setx ANDROID_HOME \"путь\\к\\Android\\Sdk\"",
    );
    return null;
  }

  const avd = pickAvd(binary);

  if (avd === null) {
    console.error("\nНи одного AVD. Создай устройство в Android Studio → Device Manager.");
    return null;
  }

  console.log(`Запускаю эмулятор ${avd}...`);

  // detached + unref: эмулятор должен пережить остановку Metro по Ctrl+C,
  // иначе каждая перезагрузка скрипта убивала бы устройство вместе с сессией.
  const before = new Set(listDevices());
  spawn(binary, ["-avd", avd, "-no-boot-anim"], { detached: true, stdio: "ignore" }).unref();

  let serial = null;
  const appeared = await waitFor(() => {
    serial = listDevices().find((d) => !before.has(d) && d.startsWith("emulator-")) ?? null;
    return serial !== null;
  }, 120_000);

  if (!appeared) {
    console.error("\nЭмулятор не появился в adb за две минуты.");
    return null;
  }

  console.log(`${serial}: жду загрузки системы...`);

  if (!(await waitFor(() => isBooted(serial), 180_000))) {
    console.error(`\n${serial}: система не загрузилась за три минуты.`);
    return null;
  }

  console.log(`${serial}: готов.`);
  return serial;
}

function reversePort(serial) {
  // Порт пробрасывается на каждое устройство отдельно: телефон и эмулятор
  // тянут бандл с одного Metro, но туннель у каждого свой.
  return (
    spawnSync("adb", ["-s", serial, "reverse", `tcp:${PORT}`, `tcp:${PORT}`], opts).status === 0
  );
}

function hasApp(serial) {
  const res = spawnSync("adb", ["-s", serial, "shell", "pm", "list", "packages", appId], {
    shell: true,
    encoding: "utf8",
  });

  return (res.stdout ?? "").includes(appId);
}

function openDevBuild(serial) {
  if (!hasApp(serial)) {
    console.error(
      `\n${serial}: приложение ${appId} не установлено.` +
        `\nСобери и поставь: npm run build:android, затем adb -s ${serial} install -r <файл.apk>`,
    );
    return false;
  }

  const open = spawnSync(
    "adb",
    [
      "-s",
      serial,
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      `"${devClientUrl}"`,
    ],
    opts,
  );

  return open.status === 0;
}

async function waitForMetro() {
  return waitFor(
    async () => {
      try {
        return (await fetch(`http://127.0.0.1:${PORT}/status`)).ok;
      } catch {
        return false;
      }
    },
    90_000,
    500,
  );
}

// 1. Собираем устройства: телефон по USB, эмулятор, или и то и другое
let devices = listDevices();

if (!noEmulator && !devices.some((d) => d.startsWith("emulator-"))) {
  const started = await startEmulator();
  devices = started === null ? devices : listDevices();
}

if (onlyDevice) {
  devices = devices.filter((d) => d === onlyDevice);
}

if (devices.length === 0) {
  console.error("\nНи одного устройства: эмулятор не поднялся, телефон не подключён.");
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
  process.exit(devices.map((serial) => openDevBuild(serial)).every(Boolean) ? 0 : 1);
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
