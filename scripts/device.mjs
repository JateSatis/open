// Управление устройством для самопроверки агентом: дерево экрана, тапы по testID и тексту,
// скриншоты, запись экрана, диагностика Metro. Все вызовы adb — с таймаутом: зависший сервер
// adb отвечает молчанием, и без ограничения команда висит бесконечно.
//
//   node scripts/device.mjs help
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 8081;
const ADB_TIMEOUT_MS = 20_000;
// Сколько tap/swipe ждут появления цели: экран после перехода дорисовывается не сразу.
const TARGET_WAIT_MS = 10_000;
const { expo } = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8"));
const APP_ID = expo.android.package;
const DEV_CLIENT_URL = `${expo.scheme}://expo-development-client/?url=${encodeURIComponent(
  `http://127.0.0.1:${PORT}`,
)}`;
const OUT_DIR = process.env.OPEN_DEVICE_OUT ?? join(tmpdir(), "open-device");
const TOOLS_DIR = join(process.env.LOCALAPPDATA ?? tmpdir(), "open-tools");
const SCRCPY_VERSION = "3.1";
const SCRCPY_URL = `https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/scrcpy-win64-v${SCRCPY_VERSION}.zip`;

const HELP = `node scripts/device.mjs <команда> [-s <serial>] ...

Устройство: -s <serial>, иначе ANDROID_SERIAL, иначе единственное подключённое.

  up [--second]                 всё окружение одной командой и только недостающее: эмулятор
                                open_test (--second — и open_test_2), Metro, прогрев бандла,
                                adb reverse, Open открыт на «Чатах». С -s — только это устройство
  devices                       подключённые устройства: модель, Android, что на экране
  doctor [--fix]                adb, Metro (статус и манифест), adb reverse, приложение наверху;
                                --fix пробрасывает порт и открывает dev build
  open                          открыть dev build на Metro (или запустить release-сборку)
  ui [--all]                    дерево экрана: подписи, testID, центр; --all — и пустые узлы
  tap <цель> [--long] [--n N]   тап по цели; ждёт её появления до 10 с; несколько совпадений —
                                список и выход, уточни --n
  wait <цель> [--gone] [--timeout сек]
                                ждать, пока цель появится (--gone — исчезнет), по умолчанию 15 с.
                                Вместо sleep: возвращается сразу, как только экран готов
  swipe <цель> <left|right|up|down> [px] [ms]
                                жест от центра цели; px — длина (по умолчанию 300), ms — 250
  swipe x1,y1 x2,y2 [ms]        жест по координатам
  text <ascii>                  ввод в поле в фокусе (adb умеет только латиницу)
  key <back|enter|del>          клавиша; back на корне стека выводит на рабочий стол
  shot [имя]                    скриншот, печатает путь к PNG
  record <сек> [имя]            запись экрана через scrcpy (скачивается сам), путь к MP4
  frames <mp4> [fps]            разложить запись на кадры, печатает папку

Цель: id:<testID> | text:<текст> | desc:<подпись> | <подстрока где угодно> | x,y.
Перед каждым жестом проверяется, что ${APP_ID} наверху: на чужом рабочем столе слепой тап
может поменять обои или удалить виджет. Файлы — в ${OUT_DIR} (OPEN_DEVICE_OUT).`;

// ---------- adb ----------

function run(cmd, args, { timeout = ADB_TIMEOUT_MS, input, binary = false } = {}) {
  const res = spawnSync(cmd, args, {
    encoding: binary ? "buffer" : "utf8",
    timeout,
    input,
    maxBuffer: 64 * 1024 * 1024,
  });

  if (res.error?.code === "ETIMEDOUT") {
    fail(
      `${cmd} ${args.join(" ")} не ответил за ${timeout / 1000} с.` +
        (cmd === "adb" ? " Залипший сервер: taskkill /F /IM adb.exe, затем adb start-server." : ""),
    );
  }
  if (res.error) fail(`${cmd}: ${res.error.message}`);

  return res;
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

let serial = null;

function adb(args, opts) {
  return run("adb", serial ? ["-s", serial, ...args] : args, opts);
}

function shell(command, opts) {
  return adb(["shell", command], opts).stdout ?? "";
}

function attached() {
  return run("adb", ["devices"])
    .stdout.split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([s, state]) => s && state)
    .map(([s, state]) => ({ serial: s, state }));
}

function pickDevice(flag) {
  const ready = attached().filter((d) => d.state === "device").map((d) => d.serial);
  const wanted = flag ?? process.env.ANDROID_SERIAL;

  if (wanted) {
    if (!ready.includes(wanted)) fail(`${wanted} не подключён. Готовы: ${ready.join(", ") || "нет"}`);
    return wanted;
  }
  if (ready.length === 1) return ready[0];
  fail(
    ready.length === 0
      ? "Ни одного устройства. node scripts/device.mjs devices — проверить состояние."
      : `Подключено несколько: ${ready.join(", ")}. Укажи -s <serial>.`,
  );
}

function topActivity() {
  const out = shell("dumpsys activity activities");
  const line =
    out.split(/\r?\n/).find((l) => l.includes("topResumedActivity")) ??
    out.split(/\r?\n/).find((l) => l.includes("mResumedActivity")) ??
    "";

  return line.match(/\{[^}]*\s(\S+\/\S+)/)?.[1] ?? "";
}

function appOnTop() {
  return topActivity().startsWith(`${APP_ID}/`);
}

function guard() {
  if (!appOnTop()) {
    fail(
      `Наверху не Open, а ${topActivity() || "неизвестно"}. Жест отменён.` +
        " Открыть приложение: node scripts/device.mjs open",
      3,
    );
  }
}

// ---------- дерево экрана ----------

function dumpUi() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const out = adb(["exec-out", "uiautomator", "dump", "/dev/tty"], { timeout: 15_000 }).stdout;
    const xml = out.slice(out.indexOf("<?xml"), out.lastIndexOf("</hierarchy>") + "</hierarchy>".length);

    if (xml.includes("<node")) return xml;
    // «could not get idle state» — экран ещё анимируется; через секунду обычно проходит.
    spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 1000)"]);
  }
  fail("uiautomator не отдал дерево экрана: экран непрерывно анимируется или занят диалогом.");
}

const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

function parseNodes(xml) {
  return [...xml.matchAll(/<node [^>]*?>/g)].map(([tag]) => {
    const attr = (name) => decode(tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1] ?? "");
    const [x1, y1, x2, y2] = attr("bounds").match(/\d+/g)?.map(Number) ?? [0, 0, 0, 0];
    const rawId = attr("resource-id");

    return {
      text: attr("text"),
      desc: attr("content-desc"),
      // testID приходит как resource-id без пакета; нативные id — с пакетом, их режем.
      id: rawId.includes(":id/") ? rawId.split(":id/")[1] : rawId,
      clickable: attr("clickable") === "true",
      focused: attr("focused") === "true",
      cx: Math.round((x1 + x2) / 2),
      cy: Math.round((y1 + y2) / 2),
      w: x2 - x1,
      h: y2 - y1,
    };
  });
}

// Служебные узлы нижней навигации: подпись вкладки и так видна на кликабельном родителе.
const NOISE = /^navigation_bar_item_|^action_bar_root$|^content$/;
// Глифы иконочного шрифта (приватная область Unicode) ничего не говорят агенту.
const isGlyph = (s) => /^[\u{E000}-\u{F8FF}]+$/u.test(s);

function describe(node) {
  const parts = [];
  if (node.id) parts.push(`#${node.id}`);
  if (node.text && !isGlyph(node.text)) parts.push(JSON.stringify(node.text.slice(0, 60)));
  if (node.desc && node.desc !== node.text) parts.push(`[${node.desc.slice(0, 60)}]`);
  if (node.clickable) parts.push("tap");
  if (node.focused) parts.push("focus");

  return `${parts.join(" ")}  @${node.cx},${node.cy}`;
}

function cmdUi(all) {
  const nodes = parseNodes(dumpUi()).filter(
    (n) =>
      all ||
      (((n.text && !isGlyph(n.text)) || n.desc || n.id || n.clickable) &&
        !NOISE.test(n.id) &&
        n.w > 0 &&
        n.h > 0),
  );

  console.log(`${topActivity()}`);
  nodes.forEach((n, i) => console.log(`${String(i).padStart(3)} ${describe(n)}`));
}

function matchTarget(target) {
  const [, kind, value] = target.match(/^(id|text|desc):(.*)$/s) ?? [null, "any", target];
  const nodes = parseNodes(dumpUi()).filter((n) => n.w > 0 && n.h > 0);
  const match = {
    id: (n) => n.id === value,
    text: (n) => n.text === value,
    desc: (n) => n.desc === value,
    any: (n) => [n.id, n.text, n.desc].some((s) => s.includes(value)),
  }[kind];
  const found = nodes.filter(match);

  // Подпись часто стоит на некликабельном потомке: предпочитаем кликабельные совпадения.
  return found.length > 1 && found.some((n) => n.clickable) ? found.filter((n) => n.clickable) : found;
}

const pause = (ms) => spawnSync(process.execPath, ["-e", `setTimeout(() => {}, ${ms})`]);

/**
 * Ждёт, пока цель появится (или исчезнет). Опрос — дампом экрана подряд, без пауз: сам
 * дамп идёт ~2–3 с, а угаданный `sleep` в команде агента стоил дороже, чем любой опрос.
 */
function pollTarget(target, { gone = false, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let found = matchTarget(target);

  while ((gone ? found.length > 0 : found.length === 0) && Date.now() < deadline) {
    pause(300);
    found = matchTarget(target);
  }

  return found;
}

function findTarget(target, nth, timeoutMs = TARGET_WAIT_MS) {
  const coords = target.match(/^(\d+),(\d+)$/);
  if (coords) return { cx: Number(coords[1]), cy: Number(coords[2]), label: target };

  const found = pollTarget(target, { timeoutMs });

  if (found.length === 0) {
    fail(`Не нашёл «${target}» за ${timeoutMs / 1000} с. Посмотри: node scripts/device.mjs ui`, 2);
  }
  if (found.length > 1 && nth === undefined) {
    console.error(`«${target}» — ${found.length} совпадений, уточни --n:`);
    found.forEach((n, i) => console.error(`  --n ${i}  ${describe(n)}`));
    process.exit(2);
  }

  const node = found[nth ?? 0];
  if (!node) fail(`--n ${nth}: совпадений всего ${found.length}.`, 2);

  return { ...node, label: describe(node) };
}

function cmdWait(target, { gone, timeoutMs }) {
  if (!target) fail("wait <цель> [--gone] [--timeout сек]");
  const started = Date.now();
  const found = pollTarget(target, { gone, timeoutMs });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (gone ? found.length > 0 : found.length === 0) {
    fail(`«${target}» ${gone ? "не исчезло" : "не появилось"} за ${timeoutMs / 1000} с.`, 2);
  }
  console.log(gone ? `«${target}» исчезло за ${seconds} с` : `${describe(found[0])}  (за ${seconds} с)`);
}

// ---------- жесты ----------

function cmdTap(target, { long, nth }) {
  guard();
  const t = findTarget(target, nth);

  if (long) {
    shell(`input swipe ${t.cx} ${t.cy} ${t.cx} ${t.cy} 700`);
  } else {
    shell(`input tap ${t.cx} ${t.cy}`);
  }
  console.log(`${long ? "долгое нажатие" : "тап"}: ${t.label}`);
}

function cmdSwipe(args, nth) {
  guard();
  const from = args[0]?.match(/^(\d+),(\d+)$/);
  const to = args[1]?.match(/^(\d+),(\d+)$/);

  if (from && to) {
    const ms = Number(args[2] ?? 250);
    shell(`input swipe ${from[1]} ${from[2]} ${to[1]} ${to[2]} ${ms}`);
    console.log(`жест ${args[0]} → ${args[1]} за ${ms} мс`);
    return;
  }

  const [target, dir, px = "300", ms = "250"] = args;
  const delta = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir];
  if (!target || !delta) fail("swipe <цель> <left|right|up|down> [px] [ms]  или  swipe x1,y1 x2,y2 [ms]");

  const t = findTarget(target, nth);
  const x2 = t.cx + delta[0] * Number(px);
  const y2 = t.cy + delta[1] * Number(px);

  shell(`input swipe ${t.cx} ${t.cy} ${x2} ${y2} ${ms}`);
  console.log(`жест ${dir} на ${px} px за ${ms} мс от ${t.label}`);
}

function cmdText(value) {
  guard();
  if (!/^[\x20-\x7E]*$/.test(value)) {
    fail("adb input text понимает только латиницу и ASCII. Для кириллицы — тестовое сообщение латиницей.");
  }
  // Пробел для input text — %s; спецсимволы оболочки экранируем.
  const escaped = value.replace(/ /g, "%s").replace(/(["'`\\$&|;<>()])/g, "\\$1");
  shell(`input text ${escaped}`);
  console.log(`введено: ${value}`);
}

function cmdKey(name) {
  const code = { back: 4, enter: 66, del: 67 }[name];
  if (code === undefined) fail("key <back|enter|del>");
  guard();
  shell(`input keyevent ${code}`);
  if (!appOnTop()) console.error(`Внимание: после «${name}» Open больше не наверху (${topActivity()}).`);
  console.log(`клавиша ${name}`);
}

// ---------- файлы ----------

function outPath(name, ext) {
  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  return join(OUT_DIR, `${name ? `${name}-` : ""}${stamp}.${ext}`);
}

function cmdShot(name) {
  const png = adb(["exec-out", "screencap", "-p"], { binary: true, timeout: 30_000 }).stdout;
  if (!png || png.length < 1000) fail("screencap вернул пустой кадр.");

  const file = outPath(name, "png");
  writeFileSync(file, png);
  console.log(file);
}

function ensureScrcpy() {
  const dir = join(TOOLS_DIR, `scrcpy-win64-v${SCRCPY_VERSION}`);
  const exe = join(dir, "scrcpy.exe");
  if (existsSync(exe)) return exe;
  if (process.platform !== "win32") return "scrcpy";

  mkdirSync(TOOLS_DIR, { recursive: true });
  const zip = join(TOOLS_DIR, "scrcpy.zip");
  console.error(`Скачиваю scrcpy ${SCRCPY_VERSION}...`);
  run("curl", ["-sSL", "-o", zip, SCRCPY_URL], { timeout: 120_000 });
  // Именно системный bsdtar: GNU tar из Git Bash, первый в PATH, zip не читает.
  const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  run(tar, ["-xf", zip, "-C", TOOLS_DIR], { timeout: 60_000 });
  if (!existsSync(exe)) fail(`scrcpy не распаковался в ${dir}`);

  return exe;
}

function cmdRecord(seconds, name) {
  const sec = Number(seconds);
  if (!sec || sec > 120) fail("record <сек> [имя], от 1 до 120 секунд.");

  const file = outPath(name, "mp4");
  // Своя реализация захвата: adb screenrecord на realme запрещён.
  run(
    ensureScrcpy(),
    ["-s", serial, "--no-audio", "--no-playback", "--no-window", `--record=${file}`, `--time-limit=${sec}`],
    { timeout: (sec + 30) * 1000 },
  );
  if (!existsSync(file)) fail("scrcpy не записал файл.");
  console.log(file);
}

function cmdFrames(file, fps) {
  if (!file || !existsSync(file)) fail("frames <mp4> [fps]");
  const dir = file.replace(/\.mp4$/i, "-frames");
  mkdirSync(dir, { recursive: true });
  // Без fps — каждый кадр как есть: частота scrcpy переменная, времена — из ffprobe.
  const filter = fps ? ["-vf", `fps=${fps}`] : ["-vsync", "0"];
  run("ffmpeg", ["-loglevel", "error", "-i", file, ...filter, join(dir, "%04d.png")], { timeout: 120_000 });
  console.log(dir);
  if (!fps) console.log(`времена кадров: ffprobe -v error -select_streams v -show_entries frame=pts_time -of csv=p=0 "${file}"`);
}

// ---------- окружение ----------

async function fetchText(url, headers = {}, ms = 4000) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(ms) });
    return { ok: res.ok, text: await res.text() };
  } catch (error) {
    return { ok: false, text: String(error.message ?? error) };
  }
}

function cmdDevices() {
  const list = attached();
  if (list.length === 0) console.log("Ни одного устройства.");

  for (const d of list) {
    if (d.state !== "device") {
      console.log(`${d.serial}  ${d.state}`);
      continue;
    }
    serial = d.serial;
    const model = shell("getprop ro.product.model").trim();
    const android = shell("getprop ro.build.version.release").trim();
    console.log(`${d.serial}  ${model}, Android ${android}, наверху: ${topActivity() || "?"}`);
  }
}

function cmdOpen() {
  const installed = shell(`pm list packages ${APP_ID}`).includes(APP_ID);
  if (!installed) fail(`${APP_ID} не установлен на ${serial}.`);

  // В манифесте dev build есть активности dev-лаунчера; у release их нет.
  const isDevBuild = shell(`dumpsys package ${APP_ID}`).includes("devlauncher");
  if (isDevBuild) {
    adb(["reverse", `tcp:${PORT}`, `tcp:${PORT}`]);
    shell(`am start -a android.intent.action.VIEW -d "${DEV_CLIENT_URL}"`);
  } else {
    shell(`monkey -p ${APP_ID} -c android.intent.category.LAUNCHER 1`);
  }
  console.log(`открыт ${APP_ID} на ${serial}${isDevBuild ? " (dev build → Metro)" : ""}`);
}

// ---------- часы ----------

const clockDrift = () => Math.abs(Date.now() / 1000 - Number(shell("date +%s").trim()));

/**
 * Часы эмулятора после сна ПК отстают на часы — и Supabase отвергает токены. root на
 * образе нет, но принудительная сверка с сетевым временем выравнивает их без перезагрузки.
 */
function fixClock() {
  shell("cmd network_time_update_service force_refresh");
  return clockDrift() <= 120;
}

// ---------- up: окружение одной командой ----------

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BUNDLE_URL = `http://127.0.0.1:${PORT}/node_modules/expo-router/entry.bundle?platform=android&dev=true&minify=false`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findEmulator() {
  const roots = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Android", "Sdk"),
    "D:/Programs/Android/Sdk",
  ].filter(Boolean);

  return roots.map((r) => join(r, "emulator", "emulator.exe")).find((p) => existsSync(p)) ?? null;
}

/**
 * Отдельный процесс через Start-Process: запущенное из сессии агента напрямую умирает по
 * лимиту времени команды. Окно — свёрнутое, не скрытое: со скрытым окном у Metro падает
 * дочерний expo-updates cli (0xC0000142), и манифест отдаёт ошибку.
 */
function startDetached(file, args, cwd) {
  const list = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(",");
  run(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Start-Process -FilePath '${file}' -ArgumentList ${list} -WorkingDirectory '${cwd}' -WindowStyle Minimized`,
    ],
    { timeout: 30_000 },
  );
}

function healAdb() {
  const res = spawnSync("adb", ["devices"], { encoding: "utf8", timeout: 10_000 });
  if (res.error?.code !== "ETIMEDOUT") return false;

  spawnSync("taskkill", ["/F", "/IM", "adb.exe"], { stdio: "ignore" });
  spawnSync("adb", ["start-server"], { stdio: "ignore", timeout: 20_000 });
  return true;
}

const readyDevices = () => attached().filter((d) => d.state === "device").map((d) => d.serial);

function runningAvd(s) {
  return (run("adb", ["-s", s, "emu", "avd", "name"]).stdout ?? "").split(/\r?\n/)[0].trim();
}

async function waitUntil(check, timeoutMs, stepMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(stepMs);
  }
  return false;
}

async function cmdUp({ second, only }) {
  const started = Date.now();
  const log = (m) => console.log(`[${String(Math.round((Date.now() - started) / 1000)).padStart(3)} с] ${m}`);

  if (healAdb()) log("adb не отвечал — перезапустил сервер");

  // 1. Эмуляторы — запускаем, но не ждём: пока грузятся, поднимается Metro.
  const wantedAvds = only ? [] : [process.env.OPEN_AVD ?? "open_test", ...(second ? ["open_test_2"] : [])];
  const running = new Set(readyDevices().filter((s) => s.startsWith("emulator-")).map(runningAvd));
  const toStart = wantedAvds.filter((avd) => !running.has(avd));

  if (toStart.length > 0) {
    const emulator = findEmulator();
    if (!emulator) fail("emulator.exe не найден: задай ANDROID_HOME.");
    for (const avd of toStart) startDetached(emulator, ["-avd", avd, "-no-boot-anim"], ROOT);
    log(`запускаю эмулятор: ${toStart.join(", ")}`);
  }

  // 2. Metro. Порт занят мёртвым node — снимаем; живой — переиспользуем.
  let metroUp = (await fetchText(`http://127.0.0.1:${PORT}/status`)).text.includes("packager-status:running");
  if (!metroUp) {
    const netstat = spawnSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" }).stdout ?? "";
    const pid = netstat
      .split(/\r?\n/)
      .find((l) => /LISTENING/.test(l) && new RegExp(`:${PORT}\\s`).test(l))
      ?.trim()
      .split(/\s+/)
      .pop();
    if (pid) {
      spawnSync("taskkill", ["/F", "/T", "/PID", pid], { stdio: "ignore" });
      log(`порт ${PORT} держал зависший процесс ${pid} — снял`);
    }
    startDetached("cmd.exe", ["/k", `cd /d ${ROOT} && npx expo start --dev-client`], ROOT);
    log("запускаю Metro");
    metroUp = await waitUntil(
      async () => (await fetchText(`http://127.0.0.1:${PORT}/status`)).text.includes("packager-status:running"),
      120_000,
    );
    if (!metroUp) fail("Metro не поднялся за 2 минуты — посмотри его свёрнутое окно.");
    log("Metro отвечает");
  }

  const manifest = await fetchText(
    `http://127.0.0.1:${PORT}/`,
    { "expo-platform": "android", accept: "application/expo+json" },
    60_000,
  );
  if (!manifest.ok || manifest.text.includes('"error"')) {
    fail(`Манифест Metro с ошибкой — перезапусти Metro (не скрытым окном): ${manifest.text.slice(0, 200)}`);
  }

  // 3. Прогрев бандла параллельно с загрузкой эмулятора: холодная сборка идёт минуты, и
  // лучше, чтобы она шла сейчас, а не когда агент впервые откроет приложение.
  const bundleStarted = Date.now();
  const warm = fetchText(BUNDLE_URL, {}, 400_000).then((r) => {
    log(r.ok ? `бандл собран (${Math.round((Date.now() - bundleStarted) / 1000)} с)` : `бандл: ${r.text.slice(0, 200)}`);
    return r.ok;
  });

  // 4. Ждём эмуляторы.
  if (wantedAvds.length > 0) {
    const booted = await waitUntil(() => {
      const ready = readyDevices().filter((s) => s.startsWith("emulator-"));
      const avds = new Set(
        ready.filter((s) => run("adb", ["-s", s, "shell", "getprop", "sys.boot_completed"]).stdout.trim() === "1").map(runningAvd),
      );
      return wantedAvds.every((avd) => avds.has(avd));
    }, 300_000, 3000);
    if (!booted) fail("Эмулятор не загрузился за 5 минут.");
    if (toStart.length > 0) log("эмуляторы загружены");
  }

  if (!(await warm)) fail("Metro не отдал бандл — белый экран обеспечен; перезапусти Metro с --clear.");

  // 5. Каждое устройство: порт, часы, приложение наверху и живое.
  const targets = only
    ? [only]
    : readyDevices().filter((s) => s.startsWith("emulator-") && wantedAvds.includes(runningAvd(s)));

  for (const s of targets) {
    serial = s;
    adb(["reverse", `tcp:${PORT}`, `tcp:${PORT}`]);

    const drift = clockDrift();
    if (drift > 120) {
      log(`${s}: часы расходятся на ${Math.round(drift / 60)} мин — ${fixClock() ? "синхронизировал" : "не вышло, лечит adb reboot"}`);
    }

    if (!appOnTop() || matchTarget("Чаты").length === 0) cmdOpen();
    const found = pollTarget("Чаты", { timeoutMs: 120_000 });
    if (found.length === 0) fail(`${s}: приложение не дошло до вкладки «Чаты» за 2 минуты — node scripts/device.mjs shot`);
    log(`${s} (${runningAvd(s) || "телефон"}): Open открыт, готов`);
  }

  log(`готово. Устройства: ${targets.join(", ")}`);
}

async function cmdDoctor(fix) {
  const problems = [];
  const status = await fetchText(`http://127.0.0.1:${PORT}/status`);
  const metroUp = status.text.includes("packager-status:running");
  console.log(`Metro /status: ${metroUp ? "работает" : "не отвечает"}`);
  if (!metroUp) problems.push("Metro не запущен — см. память metro-start-detached");

  if (metroUp) {
    // /status бывает жив, когда манифест уже отдаёт ошибку (упавший expo-updates cli).
    const manifest = await fetchText(`http://127.0.0.1:${PORT}/`, {
      "expo-platform": "android",
      accept: "application/expo+json",
    }, 30_000);
    const manifestOk = manifest.ok && !manifest.text.includes('"error"');
    console.log(`Metro манифест: ${manifestOk ? "в порядке" : `ошибка: ${manifest.text.slice(0, 200)}`}`);
    if (!manifestOk) problems.push("манифест Metro с ошибкой — перезапустить Metro не скрытым окном");
  }

  const reverse = adb(["reverse", "--list"]).stdout ?? "";
  const reversed = reverse.includes(`tcp:${PORT}`);
  console.log(`adb reverse ${PORT}: ${reversed ? "есть" : "нет"}`);

  const installed = shell(`pm list packages ${APP_ID}`).includes(APP_ID);
  console.log(`${APP_ID}: ${installed ? "установлен" : "не установлен"}`);
  if (!installed) problems.push("приложение не установлено");

  const drift = clockDrift();
  const clockOk = drift <= 120 || (fix && fixClock());
  console.log(
    `часы устройства: ${drift <= 120 ? "в порядке" : `расходятся на ${Math.round(drift / 60)} мин${clockOk ? ", синхронизировал" : ""}`}`,
  );
  if (!clockOk) problems.push("часы отстают — запросы к Supabase падают; doctor --fix или adb reboot");

  const onTop = appOnTop();
  console.log(`наверху: ${topActivity() || "?"}`);

  if (fix && installed) {
    if (!reversed) adb(["reverse", `tcp:${PORT}`, `tcp:${PORT}`]);
    if (!onTop || !reversed) cmdOpen();
  } else if (!reversed) {
    problems.push("нет adb reverse — node scripts/device.mjs doctor --fix");
  }

  if (problems.length > 0) {
    console.log(`\nПроблемы:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nВсё в порядке.");
}

// ---------- разбор аргументов ----------

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const [, value] = argv.splice(i, 2);
  return value;
};
const bool = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return false;
  argv.splice(i, 1);
  return true;
};

const serialFlag = flag("-s");
const nthFlag = flag("--n");
const nth = nthFlag === undefined ? undefined : Number(nthFlag);
const long = bool("--long");
const all = bool("--all");
const fix = bool("--fix");
const gone = bool("--gone");
const second = bool("--second");
const timeoutFlag = flag("--timeout");
const timeoutMs = timeoutFlag === undefined ? 15_000 : Number(timeoutFlag) * 1000;
const [command, ...rest] = argv;

if (!command || command === "help" || command === "--help") {
  console.log(HELP);
  process.exit(0);
}

if (command === "devices") {
  cmdDevices();
  process.exit(0);
}
if (command === "up") {
  await cmdUp({ second, only: serialFlag });
  process.exit(0);
}
if (command === "frames") {
  cmdFrames(rest[0], rest[1]);
  process.exit(0);
}

serial = pickDevice(serialFlag);

const commands = {
  doctor: () => cmdDoctor(fix),
  open: () => cmdOpen(),
  ui: () => cmdUi(all),
  tap: () => cmdTap(rest.join(" "), { long, nth }),
  wait: () => cmdWait(rest.join(" "), { gone, timeoutMs }),
  swipe: () => cmdSwipe(rest, nth),
  text: () => cmdText(rest.join(" ")),
  key: () => cmdKey(rest[0]),
  shot: () => cmdShot(rest[0]),
  record: () => cmdRecord(rest[0], rest[1]),
};

if (!commands[command]) fail(`Неизвестная команда «${command}».\n\n${HELP}`);
await commands[command]();
