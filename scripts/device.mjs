// Управление устройством для самопроверки агентом: дерево экрана, тапы по testID и тексту,
// скриншоты, запись экрана, диагностика Metro. Все вызовы adb — с таймаутом: зависший сервер
// adb отвечает молчанием, и без ограничения команда висит бесконечно.
//
//   node scripts/device.mjs help
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureMetro,
  metroStatus,
  checkManifest,
  stopOwnedMetro,
  packageInfo,
  classifyUi,
  backendStatus,
  saveDiagnostic,
} from './dev-runtime.mjs';
import { installedCompatibility } from './dev-build.mjs';
import { deviceSelection, resolveDevices } from './device-selection.mjs';
import { ensureScrcpy } from './visual-tools.mjs';

const PORT = 8081;
const ADB_TIMEOUT_MS = 20_000;
// Сколько tap/swipe ждут появления цели: экран после перехода дорисовывается не сразу.
const TARGET_WAIT_MS = 10_000;
const { expo } = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
const APP_ID = expo.android.package;
const DEV_CLIENT_URL = `${expo.scheme}://expo-development-client/?url=${encodeURIComponent(
  `http://127.0.0.1:${PORT}`,
)}`;
const OUT_DIR = process.env.OPEN_DEVICE_OUT ?? join(tmpdir(), 'open-device');

const HELP = `node scripts/device.mjs <команда> [-s <serial>] ...

up/reset: --phone по умолчанию (ANDROID_SERIAL не используется), --emulator, --both или -s SERIAL.
Остальные команды: -s SERIAL, иначе ANDROID_SERIAL, иначе единственное подключённое.
Без команды --phone/--emulator/--both означают up.

  up [--phone|--emulator|--both] только недостающее; телефон по умолчанию, выход 4 при недоступности.
                                --both: телефон + один OPEN_AVD (по умолчанию open_test).
                                -s SERIAL: ровно одно устройство; с режимами не совмещается.
                                Metro проверяется по проекту и переиспользуется. Экран входа и
                                пустой список допустимы. Нет автоматического полного reset.
  reset [--phone|--emulator|--both] [--component app|driver|metro|adb|all]
                                по умолчанию перезапуск только Open; all — явное восстановление
                                выбранных устройств; выключенные эмуляторы не запускаются.
                                Metro/adb — общие службы, их явный reset влияет на все соединения.
  devices                       подключённые устройства: модель, Android, что на экране
  doctor [--fix]                сборка, Metro, reverse, часы, бэкенд; --fix чинит reverse/часы
                                и открывает Open. Полная диагностика сохраняется в .expo/agent-runtime.
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

function run(cmd, args, { timeout = ADB_TIMEOUT_MS, input, binary = false, stdio } = {}) {
  const res = spawnSync(cmd, args, {
    encoding: binary ? 'buffer' : 'utf8',
    timeout,
    input,
    stdio,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });

  if (res.error?.code === 'ETIMEDOUT') {
    fail(
      `${cmd} ${args.join(' ')} не ответил за ${timeout / 1000} с.` +
        (cmd === 'adb' ? ' Проверь adb; адресное восстановление: reset --component adb.' : ''),
    );
  }
  if (res.error) fail(`${cmd}: ${res.error.message}`);

  return res;
}

function fail(message, code = 1) {
  throw Object.assign(new Error(message), { exitCode: code });
}

let serial = null;

function adb(args, opts) {
  return run('adb', serial ? ['-s', serial, ...args] : args, opts);
}

function shell(command, opts) {
  return adb(['shell', command], opts).stdout ?? '';
}

function attached() {
  const result = run('adb', ['devices']);
  if (result.status !== 0)
    fail('adb devices: ошибка; используй reset --component adb только после диагностики.');
  return parseAttachedDevices(result.stdout);
}

function parseAttachedDevices(stdout) {
  return stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([s, state]) => s && state)
    .map(([s, state]) => ({ serial: s, state }));
}

function pickDevice(flag) {
  const devices = attached();
  const ready = devices.filter((d) => d.state === 'device').map((d) => d.serial);
  const wanted = flag ?? process.env.ANDROID_SERIAL;

  if (wanted) {
    if (!ready.includes(wanted)) {
      const state = devices.find((d) => d.serial === wanted)?.state;
      fail(
        `${wanted} недоступен${state ? ` (состояние adb: ${state})` : ''}. Готовы: ${ready.join(', ') || 'нет'}`,
      );
    }
    return wanted;
  }
  if (ready.length === 1) return ready[0];
  if (ready.length === 0 && devices.length === 0) {
    fail(
      'Устройств не обнаружено; adb не перезапускался. Проверьте USB и отладку: node scripts/device.mjs devices.',
    );
  }
  if (ready.length === 0) {
    fail(
      `ADB видит устройства, но ни одно не готово: ${devices.map((d) => `${d.serial} (${d.state})`).join(', ')}. Проверьте разрешение отладки на телефоне.`,
    );
  }
  fail(
    ready.length === 0
      ? 'Ни одного устройства. node scripts/device.mjs devices — проверить состояние.'
      : `Подключено несколько: ${ready.join(', ')}. Укажи -s <serial>.`,
  );
}

function topActivity() {
  const out = shell('dumpsys activity activities');
  const line =
    out.split(/\r?\n/).find((l) => l.includes('topResumedActivity')) ??
    out.split(/\r?\n/).find((l) => l.includes('mResumedActivity')) ??
    '';

  return line.match(/\{[^}]*\s(\S+\/\S+)/)?.[1] ?? '';
}

function appOnTop() {
  return topActivity().startsWith(`${APP_ID}/`);
}

function guard() {
  if (!appOnTop()) {
    fail(
      `Наверху не Open, а ${topActivity() || 'неизвестно'}. Жест отменён.` +
        ' Открыть приложение: node scripts/device.mjs open',
      3,
    );
  }
}

// ---------- дерево экрана ----------

/** soft: вместо выхода вернуть null — для ожиданий, где «экран ещё грузится» не ошибка. */
function dumpUi({ soft = false } = {}) {
  for (let attempt = 0; attempt < (soft ? 1 : 3); attempt += 1) {
    const out = adb(['exec-out', 'uiautomator', 'dump', '/dev/tty'], { timeout: 15_000 }).stdout;
    const xml = out.slice(
      out.indexOf('<?xml'),
      out.lastIndexOf('</hierarchy>') + '</hierarchy>'.length,
    );

    if (xml.includes('<node')) return xml;
    // Драйвер Maestro от прерванного прогона держит UiAutomation, и дамп молча пустой.
    if (attempt === 0) {
      shell('am force-stop dev.mobile.maestro; am force-stop dev.mobile.maestro.test');
    }
    // «could not get idle state» — экран ещё анимируется; через секунду обычно проходит.
    spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 1000)']);
  }
  if (soft) return null;
  fail(
    'uiautomator не отдал дерево экрана: экран непрерывно анимируется (видео) или занят диалогом.' +
      ' Сделай shot; при занятом драйвере — reset --component driver.',
  );
}

const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

function parseNodes(xml) {
  return [...xml.matchAll(/<node [^>]*?>/g)].map(([tag]) => {
    const attr = (name) => decode(tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1] ?? '');
    const [x1, y1, x2, y2] = attr('bounds').match(/\d+/g)?.map(Number) ?? [0, 0, 0, 0];
    const rawId = attr('resource-id');

    return {
      text: attr('text'),
      desc: attr('content-desc'),
      // testID приходит как resource-id без пакета; нативные id — с пакетом, их режем.
      id: rawId.includes(':id/') ? rawId.split(':id/')[1] : rawId,
      clickable: attr('clickable') === 'true',
      focused: attr('focused') === 'true',
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
  if (node.clickable) parts.push('tap');
  if (node.focused) parts.push('focus');

  return `${parts.join(' ')}  @${node.cx},${node.cy}`;
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

function matchTarget(target, { soft = false } = {}) {
  const [, kind, value] = target.match(/^(id|text|desc):(.*)$/s) ?? [null, 'any', target];
  const xml = dumpUi({ soft });
  if (xml === null) return null;
  const nodes = parseNodes(xml).filter((n) => n.w > 0 && n.h > 0);
  const match = {
    id: (n) => n.id === value,
    text: (n) => n.text === value,
    desc: (n) => n.desc === value,
    any: (n) => [n.id, n.text, n.desc].some((s) => s.includes(value)),
  }[kind];
  const found = nodes.filter(match);

  // Подпись часто стоит на некликабельном потомке: предпочитаем кликабельные совпадения.
  return found.length > 1 && found.some((n) => n.clickable)
    ? found.filter((n) => n.clickable)
    : found;
}

const pause = (ms) => spawnSync(process.execPath, ['-e', `setTimeout(() => {}, ${ms})`]);

/**
 * Ждёт, пока цель появится (или исчезнет). Опрос — дампом экрана подряд, без пауз: сам
 * дамп идёт ~2–3 с, а угаданный `sleep` в команде агента стоил дороже, чем любой опрос.
 */
function pollTarget(target, { gone = false, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  // null — дерево экрана ещё не отдаётся (загрузка с анимацией): ждём дальше, а не падаем.
  const settled = (found) => found !== null && (gone ? found.length === 0 : found.length > 0);
  let found = matchTarget(target, { soft: true });

  while (!settled(found) && Date.now() < deadline) {
    pause(300);
    found = matchTarget(target, { soft: true });
  }

  if (found === null) {
    // Так и не отдалось: цели не видно, а «исчезло» подтвердить нечем.
    return gone
      ? [
          {
            id: '',
            text: target,
            desc: '',
            clickable: false,
            focused: false,
            cx: 0,
            cy: 0,
            w: 0,
            h: 0,
          },
        ]
      : [];
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
  if (!target) fail('wait <цель> [--gone] [--timeout сек]');
  const started = Date.now();
  const found = pollTarget(target, { gone, timeoutMs });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (gone ? found.length > 0 : found.length === 0) {
    fail(`«${target}» ${gone ? 'не исчезло' : 'не появилось'} за ${timeoutMs / 1000} с.`, 2);
  }
  console.log(
    gone ? `«${target}» исчезло за ${seconds} с` : `${describe(found[0])}  (за ${seconds} с)`,
  );
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
  console.log(`${long ? 'долгое нажатие' : 'тап'}: ${t.label}`);
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

  const [target, dir, px = '300', ms = '250'] = args;
  const delta = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir];
  if (!target || !delta)
    fail('swipe <цель> <left|right|up|down> [px] [ms]  или  swipe x1,y1 x2,y2 [ms]');

  const t = findTarget(target, nth);
  const x2 = t.cx + delta[0] * Number(px);
  const y2 = t.cy + delta[1] * Number(px);

  shell(`input swipe ${t.cx} ${t.cy} ${x2} ${y2} ${ms}`);
  console.log(`жест ${dir} на ${px} px за ${ms} мс от ${t.label}`);
}

function cmdText(value) {
  guard();
  if (!/^[\x20-\x7E]*$/.test(value)) {
    fail(
      'adb input text понимает только латиницу и ASCII. Для кириллицы — тестовое сообщение латиницей.',
    );
  }
  // Пробел для input text — %s; спецсимволы оболочки экранируем.
  const escaped = value.replace(/ /g, '%s').replace(/(["'`\\$&|;<>()])/g, '\\$1');
  shell(`input text ${escaped}`);
  console.log(`введено: ${value}`);
}

function cmdKey(name) {
  const code = { back: 4, enter: 66, del: 67 }[name];
  if (code === undefined) fail('key <back|enter|del>');
  guard();
  shell(`input keyevent ${code}`);
  if (!appOnTop())
    console.error(`Внимание: после «${name}» Open больше не наверху (${topActivity()}).`);
  console.log(`клавиша ${name}`);
}

// ---------- файлы ----------

function outPath(name, ext) {
  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  return join(OUT_DIR, `${name ? `${name}-` : ''}${stamp}.${ext}`);
}

function cmdShot(name) {
  const png = adb(['exec-out', 'screencap', '-p'], { binary: true, timeout: 30_000 }).stdout;
  if (!png || png.length < 1000) fail('screencap вернул пустой кадр.');

  const file = outPath(name, 'png');
  writeFileSync(file, png);
  console.log(file);
}

function cmdRecord(seconds, name) {
  const sec = Number(seconds);
  if (!Number.isInteger(sec) || sec < 1 || sec > 120) fail('record <сек> [имя], от 1 до 120 секунд.');

  const file = outPath(name, 'mp4');
  // Своя реализация захвата: adb screenrecord на realme запрещён.
  const recording = run(
    ensureScrcpy(),
    [
      '-s',
      serial,
      '--no-audio',
      '--no-playback',
      '--no-window',
      `--record=${file}`,
      `--time-limit=${sec}`,
    ],
    { timeout: (sec + 30) * 1000 },
  );
  if (recording.status !== 0) fail('scrcpy завершился с ошибкой; запись не подтверждена.');
  if (!existsSync(file)) fail('scrcpy не записал файл.');
  console.log(file);
}

function cmdFrames(file, fps) {
  if (!file || !existsSync(file)) fail('frames <mp4> [fps]');
  const dir = file.replace(/\.mp4$/i, '-frames');
  mkdirSync(dir, { recursive: true });
  // Без fps — каждый кадр как есть: частота scrcpy переменная, времена — из ffprobe.
  const filter = fps ? ['-vf', `fps=${fps}`] : ['-vsync', '0'];
  run('ffmpeg', ['-loglevel', 'error', '-i', file, ...filter, join(dir, '%04d.png')], {
    timeout: 120_000,
  });
  console.log(dir);
  if (!fps)
    console.log(
      `времена кадров: ffprobe -v error -select_streams v -show_entries frame=pts_time -of csv=p=0 "${file}"`,
    );
}

// ---------- окружение ----------

function cmdDevices() {
  const list = attached();
  if (list.length === 0) console.log('Ни одного устройства.');

  for (const d of list) {
    if (d.state !== 'device') {
      console.log(`${d.serial}  ${d.state}`);
      continue;
    }
    serial = d.serial;
    const model = shell('getprop ro.product.model').trim();
    const android = shell('getprop ro.build.version.release').trim();
    console.log(`${d.serial}  ${model}, Android ${android}, наверху: ${topActivity() || '?'}`);
  }
}

function cmdOpen() {
  const installed = shell(`pm list packages ${APP_ID}`).includes(APP_ID);
  if (!installed) fail(`${APP_ID} не установлен на ${serial}.`);

  // В манифесте dev build есть активности dev-лаунчера; у release их нет.
  const isDevBuild = shell(`dumpsys package ${APP_ID}`).includes('devlauncher');
  if (isDevBuild) {
    adb(['reverse', `tcp:${PORT}`, `tcp:${PORT}`]);
    shell(`am start -a android.intent.action.VIEW -d "${DEV_CLIENT_URL}"`);
  } else {
    shell(`monkey -p ${APP_ID} -c android.intent.category.LAUNCHER 1`);
  }
  console.log(`открыт ${APP_ID} на ${serial}${isDevBuild ? ' (dev build → Metro)' : ''}`);
}

// ---------- часы ----------

/** Расхождение в секундах; null — устройство ещё не отдаёт время (только загрузилось). */
function clockDrift() {
  const deviceTime = Number(shell('date +%s').trim());
  return Number.isFinite(deviceTime) && deviceTime > 1_600_000_000
    ? Math.abs(Date.now() / 1000 - deviceTime)
    : null;
}

/**
 * Часы эмулятора после сна ПК отстают на часы — и Supabase отвергает токены. root на
 * образе нет, но принудительная сверка с сетевым временем выравнивает их без перезагрузки.
 */
function fixClock() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    shell('cmd network_time_update_service force_refresh');
    const drift = clockDrift();
    if (drift !== null && drift <= 120) return true;
    // Сразу после загрузки сеть ещё не поднялась — сверка проходит через пару секунд.
    pause(3000);
  }
  return false;
}

// ---------- up: окружение одной командой ----------

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findEmulator() {
  const roots = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    'D:/Programs/Android/Sdk',
  ].filter(Boolean);

  return roots.map((r) => join(r, 'emulator', 'emulator.exe')).find((p) => existsSync(p)) ?? null;
}

// Скрытый независимый процесс для явно выбранного эмулятора.
function startDetached(file, args, cwd) {
  const quote = (value) => `'${value.replace(/'/g, "''")}'`;
  const list = args.map(quote).join(',');
  run(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Start-Process -FilePath ${quote(file)} -ArgumentList ${list} -WorkingDirectory ${quote(cwd)} -WindowStyle Hidden`,
    ],
    { timeout: 30_000, stdio: 'ignore' },
  );
}

const readyDevices = () =>
  attached()
    .filter((d) => d.state === 'device')
    .map((d) => d.serial);

function runningAvd(s) {
  return (run('adb', ['-s', s, 'emu', 'avd', 'name']).stdout ?? '').split(/\r?\n/)[0].trim();
}

async function waitUntil(check, timeoutMs, stepMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(stepMs);
  }
  return false;
}

const isEmulatorSerial = (s) => s.startsWith('emulator-');

async function appState(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const xml = dumpUi({ soft: true });
    const state = classifyUi(xml);
    if (state !== 'unknown') return state;
    if (Date.now() >= deadline) return state;
    await sleep(2000);
  } while (Date.now() < deadline);
  return 'unknown';
}

async function selectedTargets(selection, startMissing = false) {
  return resolveDevices(
    selection,
    {
      list: attached,
      avdName: runningAvd,
      start: async (avd) => {
        const binary = findEmulator();
        if (!binary) throw new Error('Эмулятор не найден; задай ANDROID_HOME.');
        const available = run(binary, ['-list-avds']).stdout.trim().split(/\r?\n/);
        if (!available.includes(avd)) throw new Error(`AVD ${avd} не найден. Проверь OPEN_AVD.`);
        startDetached(binary, ['-avd', avd, '-no-boot-anim'], ROOT);
      },
      ready: async (avd) => {
        let found;
        const probe = () => {
          found = readyDevices()
            .filter(isEmulatorSerial)
            .find((s) => runningAvd(s) === avd);
          return (
            found &&
            run('adb', ['-s', found, 'shell', 'getprop', 'sys.boot_completed']).stdout.trim() ===
              '1' &&
            run('adb', ['-s', found, 'shell', 'pm', 'path', 'android']).stdout.includes('package:')
          );
        };
        const ready = startMissing ? await waitUntil(probe, 300000, 3000) : probe();
        return ready ? found : null;
      },
    },
    { startMissing, avd: process.env.OPEN_AVD ?? 'open_test' },
  );
}

async function cmdUp({ selection, openOnly = false }) {
  const result = { command: 'up', selection, devices: [], metro: 'not-needed', backend: null };
  try {
    const targets = await selectedTargets(selection, !openOnly);
    for (const target of targets) {
      serial = target;
      const build = packageInfo(serial);
      if (build.devClient && result.metro === 'not-needed')
        result.metro = await ensureMetro({ start: !openOnly });
      if (build.devClient) {
        const reverse = adb(['reverse', `tcp:${PORT}`, `tcp:${PORT}`]);
        if (reverse.status !== 0) throw new Error(`${serial}: adb reverse не выполнен.`);
      }
      if (!appOnTop()) cmdOpen();
      const compatibility = await installedCompatibility(serial, build);
      if (compatibility.status === 'changed')
        throw new Error(
          'Нативный fingerprint отличается от установленной сборки; проверь dev-build.mjs status перед использованием текущего JS.',
        );
      const state = await appState();
      result.devices.push({ serial, build, compatibility, app: state });
      console.log(
        `${serial}: ${build.devClient ? 'dev' : 'release (локальные JS-правки не загружаются)'} ${build.versionName} (${build.versionCode}); native: ${compatibility.status}; экран: ${state}`,
      );
      if (state === 'error' || state === 'unknown')
        throw new Error(`Open: ${state}; сделай shot/ui. Автоматический reset отключён.`);
    }
    result.backend = await backendStatus();
    console.log(
      `Metro: ${result.metro}. Бэкенд: ${result.backend.ok ? 'доступен' : 'недоступен'} (${result.backend.summary}).`,
    );
    console.log(`Тестовые данные: не проверялись; проверяются для выбранных сценариев Maestro.`);
    if (!result.backend.ok) throw new Error('Сбой бэкенда; локальный reset его не исправляет.');
    console.log(`Диагностика: ${saveDiagnostic('up', result)}`);
  } catch (error) {
    result.error = error.message;
    console.error(`${error.message}\nДиагностика: ${saveDiagnostic('up', result)}`);
    process.exitCode = error.exitCode ?? 1;
  }
}

// Recovery is explicit and scoped. Never kill a process just because it owns port 8081.
async function cmdReset({ selection, component = 'app' }) {
  if (component === 'adb') {
    run('adb', ['kill-server']);
    const result = run('adb', ['start-server']);
    if (result.status !== 0) fail('adb start-server: ошибка.');
    console.log('adb перезапущен; повтори doctor.');
    return;
  }
  if (component === 'metro') {
    stopOwnedMetro();
    console.log(`Metro: ${await ensureMetro()}`);
    return;
  }
  if (!['app', 'driver', 'all'].includes(component))
    fail('reset --component app|driver|metro|adb|all');
  const targets = await selectedTargets(selection);
  if (component === 'all') {
    // Explicit full recovery still does not terminate unrelated emulators or unknown listeners.
    const metro = await metroStatus();
    if (metro.running && !metro.owned) fail('Metro другого проекта; общий сброс остановлен.');
    if (metro.running) {
      stopOwnedMetro();
      await ensureMetro();
    }
    run('adb', ['kill-server']);
    run('adb', ['start-server']);
  }
  for (const target of targets) {
    serial = target;
    if (component === 'driver' || component === 'all') {
      for (const app of ['dev.mobile.maestro', 'dev.mobile.maestro.test'])
        adb(['shell', 'am', 'force-stop', app]);
    }
    if (component !== 'driver') {
      adb(['shell', 'am', 'force-stop', APP_ID]);
      cmdOpen();
    }
    console.log(`Восстановлен компонент: ${component}. Устройство: ${serial}.`);
  }
}

async function cmdDoctor(fix) {
  const result = {
    serial,
    build: packageInfo(serial),
    metro: await metroStatus(),
    backend: await backendStatus(),
  };
  result.compatibility = await installedCompatibility(serial, result.build);
  let reversed = (adb(['reverse', '--list']).stdout ?? '').includes(`tcp:${PORT} tcp:${PORT}`);
  if (fix && result.build.devClient && !reversed)
    reversed = adb(['reverse', `tcp:${PORT}`, `tcp:${PORT}`]).status === 0;
  if (fix && !appOnTop()) cmdOpen();
  result.reverse = reversed;
  result.activity = topActivity();
  result.clockDriftSeconds = clockDrift();
  if (fix && result.clockDriftSeconds !== null && result.clockDriftSeconds > 120 && fixClock())
    result.clockDriftSeconds = clockDrift();
  const problems = [];
  if (result.build.devClient) {
    if (!result.metro.owned) problems.push('Metro не отвечает или другой проект');
    else {
      try {
        await checkManifest();
      } catch (error) {
        problems.push(error.message);
      }
    }
    if (!reversed) problems.push('нет adb reverse');
  }
  if (!result.backend.ok) problems.push('бэкенд недоступен');
  if (result.clockDriftSeconds === null || result.clockDriftSeconds > 120)
    problems.push('часы не проверены/расходятся');
  if (result.compatibility.status === 'changed')
    problems.push('нативные входы изменились; проверь node scripts/dev-build.mjs status -s SERIAL');
  result.problems = problems;
  console.log(
    `Устройство: ${serial}; ${result.build.devClient ? 'dev' : 'release'} ${result.build.versionName} (${result.build.versionCode}); native: ${result.compatibility.status}`,
  );
  console.log(
    `Metro: ${result.metro.owned ? 'наш, готов' : 'не готов'}; reverse: ${reversed}; бэкенд: ${result.backend.summary}`,
  );
  console.log(
    `Тестовые данные: ещё не проверены. Диагностика: ${saveDiagnostic('doctor', result)}`,
  );
  if (problems.length) {
    console.error(problems.join('; '));
    process.exitCode = 1;
  }
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

const serialFlag = flag('-s');
const nthFlag = flag('--n');
const nth = nthFlag === undefined ? undefined : Number(nthFlag);
const long = bool('--long');
const all = bool('--all');
const fix = bool('--fix');
const gone = bool('--gone');
const phoneFlag = bool('--phone');
const bothFlag = bool('--both');
const emulatorFlag = bool('--emulator');
const openOnly = bool('--open-only');
const component = flag('--component');
const timeoutFlag = flag('--timeout');
const timeoutMs = timeoutFlag === undefined ? 15_000 : Number(timeoutFlag) * 1000;
const [requestedCommand, ...rest] = argv;
const command = requestedCommand ?? (phoneFlag || emulatorFlag || bothFlag ? 'up' : undefined);

async function main() {
  if (!command || command === 'help' || command === '--help') {
    console.log(HELP);
    return;
  }

  if (command === 'devices') {
    cmdDevices();
    return;
  }
  const selection = deviceSelection({
    phone: phoneFlag,
    emulator: emulatorFlag,
    both: bothFlag,
    serial: serialFlag,
  });
  if (rest.length && ['up', 'reset'].includes(command))
    fail(`Лишние аргументы: ${rest.join(' ')}. Используй --phone, --emulator или --both.`);
  if ((phoneFlag || emulatorFlag || bothFlag) && !['up', 'reset'].includes(command))
    fail(
      'Выбор --phone/--emulator/--both поддерживается у up и reset; для других команд используй -s SERIAL.',
    );
  if (command === 'up') {
    await cmdUp({ selection, openOnly });
    return;
  }
  if (command === 'reset') {
    await cmdReset({ selection, component });
    return;
  }
  if (command === 'frames') {
    cmdFrames(rest[0], rest[1]);
    return;
  }

  serial = pickDevice(serialFlag);

  const commands = {
    doctor: () => cmdDoctor(fix),
    open: () => cmdOpen(),
    ui: () => cmdUi(all),
    tap: () => cmdTap(rest.join(' '), { long, nth }),
    wait: () => cmdWait(rest.join(' '), { gone, timeoutMs }),
    swipe: () => cmdSwipe(rest, nth),
    text: () => cmdText(rest.join(' ')),
    key: () => cmdKey(rest[0]),
    shot: () => cmdShot(rest[0]),
    record: () => cmdRecord(rest[0], rest[1]),
  };

  if (!commands[command]) fail(`Неизвестная команда «${command}».\n\n${HELP}`);
  await commands[command]();
}
main().catch((error) => {
  console.error(
    `${error.message}\nДиагностика: ${saveDiagnostic('device', { command, serial, error: error.message })}`,
  );
  process.exitCode = error.exitCode ?? 1;
});
