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

// Сколько устройств нужно для проверки переписки: два собеседника. Телефон,
// если он подключён, занимает одно место — эмулятор поднимается только на
// недостающие.
const WANTED_DEVICES = 2;

// Схема приложения из app.json: по ней dev build ловит ссылку на Metro.
// В Expo Go это был exp://, но Expo Go нам больше не подходит — в нём нет
// нативных модулей проекта (вход через Apple и Google, камера, WebRTC).
const { expo } = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8"));
const appId = expo.android.package;
const devClientUrl = `${expo.scheme}://expo-development-client/?url=${encodeURIComponent(
  `http://127.0.0.1:${PORT}`,
)}`;

const exe = process.platform === "win32" ? ".exe" : "";
// Зависший сервер adb отвечает не ошибкой, а молчанием: без ограничения любая
// команда висит бесконечно, и скрипт выглядит сломанным.
const ADB_TIMEOUT_MS = 15_000;

/**
 * Снимает сервер adb средствами системы. `adb kill-server` для этого не
 * годится: он сам ходит в тот же залипший сервер и виснет вместе с ним.
 */
function killAdbServer() {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/F", "/IM", `adb${exe}`], { stdio: "ignore" });
  } else {
    spawnSync("pkill", ["-x", "adb"], { stdio: "ignore" });
  }
}

/** Поднимаем залипший сервер один раз за запуск: не помогло — дальше без толку. */
let adbHealed = false;

function adb(args, extra = {}, { allowHeal = true } = {}) {
  const res = spawnSync("adb", args, {
    encoding: "utf8",
    timeout: ADB_TIMEOUT_MS,
    ...extra,
  });

  if (res.error?.code !== "ETIMEDOUT") {
    return res;
  }

  // Залипший сервер лечится только перезапуском, и просить об этом человека
  // незачем — скрипт умеет это сам.
  if (allowHeal && !adbHealed) {
    adbHealed = true;
    console.log(
      `adb не ответил за ${ADB_TIMEOUT_MS / 1000} с — снимаю залипший сервер и поднимаю заново...`,
    );
    killAdbServer();
    adb(["start-server"], { stdio: "ignore" }, { allowHeal: false });

    return adb(args, extra, { allowHeal: false });
  }

  console.error(
    `\nadb не ответил за ${ADB_TIMEOUT_MS / 1000} с даже после перезапуска сервера.` +
      "\nПереткни кабель и повтори команду.",
  );
  process.exit(1);
}

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

/** Все устройства, которые adb вообще видит, вместе с их состоянием. */
function listAttached() {
  const res = adb(["devices"]);

  if (res.status !== 0) {
    return [];
  }

  return res.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(/\s+/))
    .filter(([serial, state]) => serial && state)
    .map(([serial, state]) => ({ serial, state }));
}

/**
 * Устройство в `offline` — это оборвавшаяся сессия adb, а не отключённый
 * кабель: помогает `adb reconnect`, после которого оно возвращается за
 * пару секунд. Перезапуск сервера тут не нужен и только дольше.
 */
function reconnectOffline() {
  const offline = listAttached().filter(({ state }) => state === "offline");

  if (offline.length === 0) return false;

  console.log(`Связь с ${offline.map((d) => d.serial).join(", ")} оборвалась, переподключаю...`);

  for (const { serial } of offline) {
    adb(["-s", serial, "reconnect"], { stdio: "ignore" });
  }

  return true;
}

/** Только те, с которыми можно работать: offline и authorizing ещё не готовы. */
function listDevices() {
  const ready = listAttached()
    .filter(({ state }) => state === "device")
    .map(({ serial }) => serial);

  if (ready.length > 0 || !reconnectOffline()) return ready;

  // Переподключение занимает секунду-две, и ждать его дешевле, чем считать,
  // что телефона нет.
  spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 3000)"]);

  return listAttached()
    .filter(({ state }) => state === "device")
    .map(({ serial }) => serial);
}

/** Перезапуск сервера adb: лечит устройства, застрявшие в authorizing. */
function restartAdbServer() {
  console.log("adb не может договориться с устройством, перезапускаю его сервер...");
  killAdbServer();
  // stdio: ignore обязателен — демон adb держит открытыми унаследованные
  // потоки, и spawnSync с перехватом вывода ждал бы его завершения вечно.
  adb(["start-server"], { stdio: "ignore" });
}

const isEmulator = (serial) => serial.startsWith("emulator-");

/** Имя AVD, на котором работает запущенный эмулятор: по нему видно, что поднимать не надо. */
function runningAvdName(serial) {
  const res = adb(["-s", serial, "emu", "avd", "name"]);

  return (res.stdout ?? "").split(/\r?\n/)[0]?.trim() ?? "";
}

/** Телефонные AVD в порядке предпочтения: телевизоры, часы и планшеты не подходят. */
function phoneAvds(binary) {
  const res = spawnSync(binary, ["-list-avds"], { encoding: "utf8" });
  const all = (res.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const phones = all.filter((name) => !/tv|television|wear|watch|tablet/i.test(name));
  const preferred = process.env.OPEN_AVD;

  // Свои устройства идут первыми: на чужом AVD может не быть ни Play Services,
  // ни установленного приложения, и проверка упрётся в это на ровном месте.
  const ours = phones.filter((name) => name.startsWith("open")).sort();
  const rest = phones.filter((name) => !name.startsWith("open")).sort();

  return [
    ...(preferred && phones.includes(preferred) ? [preferred] : []),
    ...[...ours, ...rest].filter((name) => name !== preferred),
  ];
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
  const res = adb(["-s", serial, "shell", "getprop", "sys.boot_completed"]);

  return (res.stdout ?? "").trim() === "1";
}

async function startEmulators(count, wanted) {
  const binary = findEmulatorBinary();

  if (binary === null) {
    console.error('\nЭмулятор не найден. Укажи путь к SDK: setx ANDROID_HOME "путь\\к\\Android\\Sdk"');
    return;
  }

  const busy = new Set(listDevices().filter(isEmulator).map(runningAvdName));
  const free = phoneAvds(binary).filter((name) => !busy.has(name));

  if (free.length < count) {
    console.error(
      `\nНужно ещё ${count} эмулятор(а), а свободных AVD — ${free.length}.` +
        `\nСоздай устройство в Android Studio → Device Manager.`,
    );
  }

  const starting = free.slice(0, count);

  for (const avd of starting) {
    console.log(`Запускаю эмулятор ${avd}...`);

    // detached + unref: эмулятор должен пережить остановку Metro по Ctrl+C,
    // иначе каждая перезагрузка скрипта убивала бы устройство вместе с сессией.
    spawn(binary, ["-avd", avd, "-no-boot-anim"], { detached: true, stdio: "ignore" }).unref();
  }

  if (starting.length === 0) return;

  console.log("Жду загрузки системы...");

  let healed = false;
  let lastReport = 0;

  // Одно условие вместо двух: во время загрузки устройство то появляется в
  // adb, то снова пропадает, поэтому ждём сразу нужное количество полностью
  // загруженных, а не «появилось» и «загрузилось» по отдельности.
  const allReady = await waitFor(() => {
    const attached = listAttached();
    const usable = attached.filter(({ state }) => state === "device");
    const stuck = attached.filter(({ state }) => state !== "device");

    if (Date.now() - lastReport > 20_000) {
      lastReport = Date.now();
      console.log(
        `Готовы: ${usable.length}/${wanted}` +
          (stuck.length > 0
            ? `, ждут: ${stuck.map((d) => `${d.serial} (${d.state})`).join(", ")}`
            : ""),
      );
    }

    // Устройство, застрявшее в authorizing, само из него не выйдет: adb должен
    // заново предъявить ключ. Пробуем один раз — дальше перезапуск сервера уже
    // не помогает, и молчать об этом нельзя.
    if (!healed && stuck.some(({ state }) => state === "authorizing")) {
      healed = true;
      restartAdbServer();
      return false;
    }

    return usable.length >= wanted && usable.every((d) => isBooted(d.serial));
  }, 300_000);

  if (!allReady) {
    const stuck = listAttached().filter(({ state }) => state !== "device");

    console.error(
      "\nЭмулятор не пришёл в рабочее состояние за пять минут." +
        (stuck.length > 0
          ? `\nЗастряли: ${stuck.map((d) => `${d.serial} (${d.state})`).join(", ")}.` +
            "\nПомогает закрыть окно эмулятора и запустить команду заново."
          : ""),
    );
  }
}

function reversePort(serial) {
  // Порт пробрасывается на каждое устройство отдельно: телефон и эмулятор
  // тянут бандл с одного Metro, но туннель у каждого свой.
  return adb(["-s", serial, "reverse", `tcp:${PORT}`, `tcp:${PORT}`]).status === 0;
}

function hasApp(serial) {
  const res = adb(["-s", serial, "shell", "pm", "list", "packages", appId]);

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

  const open = adb(
    [
      "-s",
      serial,
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      devClientUrl,
    ],
  );

  return open.status === 0;
}

/** Живой ли Metro на порту: отвечает он не чем попало, а своим статусом. */
async function metroIsRunning() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/status`, {
      signal: AbortSignal.timeout(2000),
    });

    return (await res.text()).includes("packager-status:running");
  } catch {
    return false;
  }
}

/** PID и имя того, кто слушает порт — чтобы не гадать, чей это Metro. */
function portListener(port) {
  const res =
    process.platform === "win32"
      ? spawnSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" })
      : spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });

  if (res.status !== 0) return null;

  const pid =
    process.platform === "win32"
      ? res.stdout
          .split(/\r?\n/)
          .filter((line) => /LISTENING/.test(line) && new RegExp(`:${port}\\s`).test(line))
          .map((line) => line.trim().split(/\s+/).pop())[0]
      : res.stdout.trim().split(/\r?\n/)[0];

  if (!pid) return null;

  const name =
    process.platform === "win32"
      ? spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"], { encoding: "utf8" })
          .stdout?.split('"')[1]
      : spawnSync("ps", ["-p", pid, "-o", "comm="], { encoding: "utf8" }).stdout?.trim();

  return { pid, name: name ?? "неизвестно" };
}

/**
 * Освобождает порт под Metro. Чаще всего его держит Metro из прошлого
 * запуска, переживший Ctrl+C: он либо ещё отвечает (тогда переиспользуем
 * его), либо висит мёртвым и его надо снять. Всё, что не node, трогать
 * нельзя — под этим PID может быть что угодно.
 */
async function freePort() {
  if (await metroIsRunning()) return "reuse";

  const listener = portListener(PORT);

  if (listener === null) return "free";

  if (!/^node/i.test(listener.name)) {
    console.error(
      `\nПорт ${PORT} занят процессом ${listener.name} (PID ${listener.pid}), и это не Metro.` +
        `\nЗакрой его или освободи порт вручную.`,
    );
    process.exit(1);
  }

  console.log(`Порт ${PORT} держит зависший Metro (PID ${listener.pid}), снимаю его...`);

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/F", "/T", "/PID", listener.pid], { stdio: "ignore" });
  } else {
    spawnSync("kill", ["-9", listener.pid], { stdio: "ignore" });
  }

  return "free";
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

// 1. Собираем устройства: телефон по USB, эмуляторы, или и то и другое
let devices = listDevices();

if (!noEmulator && !onlyDevice) {
  const missing = WANTED_DEVICES - devices.length;

  if (missing > 0) {
    await startEmulators(missing, WANTED_DEVICES);
    devices = listDevices();
  }
}

if (onlyDevice) {
  devices = devices.filter((d) => d === onlyDevice);
}

// Устройство в unauthorized adb видит, но работать с ним не может, и со
// стороны это выглядит как «телефон не подключён» — про запрос на экране
// сказать надо прямо.
const unauthorized = listAttached().filter(({ state }) => state === "unauthorized");

if (unauthorized.length > 0) {
  console.error(
    `\nadb не пустили на ${unauthorized.map((d) => d.serial).join(", ")}.` +
      "\nРазблокируй телефон и подтверди «Разрешить отладку по USB» — там ждёт запрос.",
  );
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

// 3. Освобождаем порт и поднимаем Metro — один на все устройства.
// Уже работающий Metro переиспользуется: перезапускать его ради открытия
// приложения незачем, а два сразу всё равно не поместятся на один порт.
if ((await freePort()) === "reuse") {
  console.log(`Metro уже слушает ${PORT}, переиспользую его.`);
  process.exit(devices.map((serial) => openDevBuild(serial)).every(Boolean) ? 0 : 1);
}

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
