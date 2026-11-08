// Прогон сценариев Maestro: выбор набора, предпосылки и уборка перед прогоном, один повтор
// упавшего, журнал стабильности в .maestro/stats.json. CLI скачивается сам в
// %LOCALAPPDATA%/open-tools, аналитика выключена.
//
//   npm run e2e -- smoke                       дым: запуск, сообщение, комментарии
//   npm run e2e -- changed                     дым + области, которые трогает ветка
//   npm run e2e -- --tags chats,comments       дым + эти области
//   npm run e2e -- full                        все сценарии
//   npm run e2e -- .maestro/swipe-reply.yaml   конкретные файлы
//   npm run e2e -- stats                       журнал: что падает, когда был полный прогон
//   npm run e2e -- raw <аргументы maestro>     maestro как есть (hierarchy, --help…)
//
// Флаги: --device <serial>, --no-reset (без уборки), --no-retry, --plan, --preflight,
// --video (сценарии с видео и на эмуляторе), -e KEY=VALUE (в maestro).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  openSync,
  closeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFixtures, cleanupFixtures, shouldStopRun } from './e2e-prepare.mjs';
import { saveDiagnostic } from './dev-runtime.mjs';

const VERSION = '2.11.0';
const BASE = `https://github.com/mobile-dev-inc/Maestro/releases/download/cli-${VERSION}`;
const TOOLS_DIR = join(process.env.LOCALAPPDATA ?? tmpdir(), 'open-tools');
const HOME = join(TOOLS_DIR, `maestro-${VERSION}`);
const isWindows = process.platform === 'win32';
const BIN = join(HOME, 'maestro', 'bin', isWindows ? 'maestro.bat' : 'maestro');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FLOWS_DIR = join(ROOT, '.maestro');
const STATS_FILE = join(FLOWS_DIR, 'stats.json');
const APP_ID = 'com.openger.app';

// Какие области трогает файл ветки: по ним `changed` добирает сценарии к дыму.
const AREAS = [
  [/^src\/(features\/chats|app\/\(tabs\)\/chats)\//, ['chats']],
  [/^src\/features\/interactions\//, ['comments']],
  [/^src\/features\/saved\//, ['chats', 'saved']],
  [/^src\/features\/channels\//, ['channels', 'subscriptions']],
  [/^src\/(features\/pops|app\/pops|app\/pop-editor)\//, ['pops']],
  [/^src\/features\/media\//, ['media']],
  [/^src\/(features\/profile|app\/\(tabs\)\/profile)\//, ['profile']],
  [/^src\/(features\/search\/|api\/search)|^supabase\/(migrations|tests)\/.*search/, ['search']],
  [/^src\/(api|components|lib|theme|features\/connection)\//, ['chats', 'comments']],
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(cmd, args, { timeout, quiet = false, shell = false } = {}) {
  const res = spawnSync(shell ? [cmd, ...args].join(' ') : cmd, shell ? [] : args, {
    encoding: 'utf8',
    timeout,
    cwd: ROOT,
    shell,
    stdio: quiet ? 'pipe' : 'inherit',
  });
  if (res.error && !quiet) fail(`${cmd}: ${res.error.message}`);
  return res;
}

// ---------- установка ----------

function install() {
  mkdirSync(HOME, { recursive: true });
  const zip = join(HOME, 'maestro.zip');
  const sums = join(HOME, 'checksums.txt');

  console.error(`Скачиваю Maestro ${VERSION}...`);
  run('curl', ['-sSL', '-o', zip, `${BASE}/maestro.zip`], { timeout: 300_000 });
  run('curl', ['-sSL', '-o', sums, `${BASE}/checksums_sha256.txt`], { timeout: 60_000 });

  const expected = readFileSync(sums, 'utf8').match(/^([0-9a-f]{64})\s+maestro\.zip/m)?.[1];
  const actual = createHash('sha256').update(readFileSync(zip)).digest('hex');
  if (!expected || expected !== actual) {
    rmSync(zip, { force: true });
    fail('Контрольная сумма maestro.zip не совпала — архив удалён.');
  }

  // Системный bsdtar: GNU tar из Git Bash, первый в PATH, zip не читает.
  const tar = isWindows
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'unzip';
  run(tar, isWindows ? ['-xf', zip, '-C', HOME] : ['-q', zip, '-d', HOME], { timeout: 120_000 });
  rmSync(zip);
  if (!existsSync(BIN)) fail(`Maestro не распаковался в ${HOME}`);
}

function maestro(args, { timeout, logFile } = {}) {
  const log = logFile ? openSync(logFile, 'w') : null;
  const result = spawnSync(BIN, args, {
    stdio: log === null ? 'inherit' : ['ignore', log, log],
    windowsHide: true,
    timeout,
    // .bat запускается только через оболочку.
    shell: isWindows,
    env: {
      ...process.env,
      MAESTRO_CLI_NO_ANALYTICS: '1',
      MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true',
      MAESTRO_DISABLE_UPDATE_CHECK: 'true',
      // Без этого кириллица из сценариев печатается в кодовой странице Windows — вопросами.
      MAESTRO_OPTS:
        '-Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8',
    },
  });
  if (log !== null) closeSync(log);
  return result;
}

// ---------- сценарии ----------

function catalog() {
  return readdirSync(FLOWS_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .map((file) => {
      // git на Windows выкладывает файлы с CRLF — без нормализации шапка не разбирается.
      const head = readFileSync(join(FLOWS_DIR, file), 'utf8')
        .replace(/\r\n/g, '\n')
        .split(/^---$/m)[0];
      const tags =
        head
          .match(/^tags:\n((?:\s+- .+\n?)+)/m)?.[1]
          .match(/- (\S+)/g)
          ?.map((t) => t.slice(2)) ?? [];
      return {
        id: file.replace(/\.yaml$/, ''),
        file: join(FLOWS_DIR, file),
        name: head.match(/^name: (.+)$/m)?.[1] ?? file,
        tags,
      };
    });
}

function changedAreas() {
  const diff = run('git', ['diff', '--name-only', 'master...HEAD'], { quiet: true }).stdout ?? '';
  const dirty = run('git', ['status', '--porcelain'], { quiet: true }).stdout ?? '';
  const files = [...diff.split(/\r?\n/), ...dirty.split(/\r?\n/).map((l) => l.slice(3))].filter(
    Boolean,
  );
  const tags = new Set(['smoke']);
  const explicit = new Set();

  for (const f of files) {
    for (const [re, t] of AREAS) if (re.test(f)) t.forEach((x) => tags.add(x));
    const flow = f.match(/^\.maestro\/([^/]+)\.yaml$/)?.[1];
    if (flow) explicit.add(flow);
  }

  return { tags, explicit };
}

// ---------- устройство ----------

function adb(serial, args, timeout = 20_000) {
  return run('adb', ['-s', serial, ...args], { timeout, quiet: true });
}

function pickDevice(flag) {
  const ready = (run('adb', ['devices'], { timeout: 15_000, quiet: true }).stdout ?? '')
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter(([, state]) => state === 'device')
    .map(([s]) => s);

  if (flag) {
    if (!ready.includes(flag)) fail(`${flag} не подключён. Готовы: ${ready.join(', ') || 'нет'}`);
    return flag;
  }
  // Телефон — по умолчанию: быстрее эмулятора и честнее для видео.
  const phone = ready.find((s) => !s.startsWith('emulator-'));
  if (phone || ready[0]) return phone ?? ready[0];
  fail('Ни одного устройства: node scripts/device.mjs up');
}

const device = (args) =>
  run(process.execPath, [join(ROOT, 'scripts', 'device.mjs'), ...args], {
    quiet: true,
    timeout: 420000,
  });

function freshApp(serial) {
  const restart = device(['reset', '--component', 'app', '-s', serial]);
  if (restart.status !== 0) throw new Error(`Перезапуск Open не выполнен: ${restart.stderr}`);
  const ready = device(['wait', 'id:tab-bar', '-s', serial, '--timeout', '45']);
  if (ready.status !== 0)
    throw new Error('Open не готов к сценариям: проверь вход/экран. Полный reset не выполнялся.');
}

function prepare(serial, flows, extra, { cleanup = true, preflight = false } = {}) {
  const environment = device(['up', '-s', serial]);
  console.log(environment.stdout?.trim());
  if (environment.status !== 0) throw new Error(`Окружение не готово: ${environment.stderr}`);
  const route = adb(serial, [
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    'openger://chats',
    '-p',
    APP_ID,
  ]);
  if (route.status !== 0 || /Error:/.test(route.stdout ?? ''))
    throw new Error('Не удалось открыть корневой экран чатов.');
  // A sign-in screen is a healthy app state, but it is not a signed-in test fixture.
  const ready = device(['wait', 'id:tab-bar', '-s', serial, '--timeout', '10']);
  if (ready.status !== 0)
    throw new Error(
      'Нужны вход в тестовый аккаунт и корневой экран с вкладками. Сценарии не запускались.',
    );
  const fixtures = checkFixtures(flows, extra);
  console.log(`Тестовые данные: ${fixtures.count}; ${fixtures.scope}.`);
  if (preflight) return fixtures;
  for (const app of ['dev.mobile.maestro', 'dev.mobile.maestro.test'])
    adb(serial, ['shell', 'am', 'force-stop', app]);
  if (cleanup) {
    cleanupFixtures();
    console.log('Тестовые данные убраны одной транзакцией.');
  }
  return fixtures;
}

// ---------- отчёт и журнал ----------

function parseJunit(file) {
  if (!existsSync(file)) return [];
  const xml = readFileSync(file, 'utf8');

  return [...xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)].map(
    ([, attrs, , body = '']) => {
      const attr = (k) => attrs.match(new RegExp(`\\b${k}="([^"]*)"`))?.[1] ?? '';
      const failure =
        body.match(/<failure[^>]*message="([^"]*)"/)?.[1] ??
        body.match(/<failure[^>]*>([\s\S]*?)<\/failure>/)?.[1];
      return {
        id: attr('id'),
        name: attr('name'),
        seconds: Number(attr('time')) || 0,
        ok: !failure && !/<error/.test(body),
        failure,
      };
    },
  );
}

function runFlows(serial, flows, extra, outDir) {
  mkdirSync(outDir, { recursive: true });
  const report = join(outDir, 'report.xml');
  rmSync(report, { force: true });
  const execution = maestro(
    [
      '--device',
      serial,
      'test',
      '--format',
      'JUNIT',
      '--output',
      report,
      '--no-reinstall-driver',
      ...extra,
      ...flows.map((f) => f.file),
    ],
    { timeout: (flows.length * 4 + 2) * 60_000, logFile: join(outDir, 'maestro.log') },
  );
  const cases = parseJunit(report);

  return flows.map((f) => {
    const c = cases.find((x) => x.id === f.id || x.name === f.name);
    return {
      flow: f,
      ok: c?.ok === true && execution.status === 0,
      seconds: c?.seconds ?? 0,
      infrastructureFailure: Boolean(execution.error) || !c || (c.ok && execution.status !== 0),
      failure:
        c?.failure ??
        (execution.status !== 0 || !c
          ? `сценарий не дошёл до отчёта (${execution.error?.code ?? execution.status})`
          : undefined),
    };
  });
}

function loadStats() {
  try {
    return JSON.parse(readFileSync(STATS_FILE, 'utf8'));
  } catch {
    return { lastFullRun: null, flows: {} };
  }
}

function saveStats(stats, results, serial, { full, excluded, seconds }) {
  const now = new Date().toISOString();

  for (const r of results) {
    const s = (stats.flows[r.flow.id] ??= {
      name: r.flow.name,
      runs: 0,
      passed: 0,
      flaky: 0,
      failed: 0,
      history: [],
    });
    s.name = r.flow.name;
    s.runs += 1;
    s[r.status] += 1;
    s.history = [...s.history, r.status].slice(-10);
    s.lastStatus = r.status;
    s.lastRunAt = now;
    s.lastDevice = serial;
    s.avgSeconds = Math.round(((s.avgSeconds ?? r.seconds) * (s.runs - 1) + r.seconds) / s.runs);
    if (r.status !== 'passed') {
      s.lastProblem = { at: now, status: r.status, failure: (r.failure ?? '').slice(0, 300) };
    }
  }

  // Полный — только без пропусков: на эмуляторе видео-сценарии не идут, и такой прогон не
  // должен глушить напоминание о настоящем полном.
  if (full && excluded.length === 0) {
    stats.lastFullRun = {
      at: now,
      device: serial,
      passed: results.filter((r) => r.status === 'passed').length,
      flaky: results.filter((r) => r.status === 'flaky').length,
      failed: results.filter((r) => r.status === 'failed').length,
      excluded,
      minutes: Math.round(seconds / 60),
    };
  }

  writeFileSync(STATS_FILE, `${JSON.stringify(stats, null, 2)}\n`);
}

function daysSince(iso) {
  return iso ? Math.floor((Date.now() - Date.parse(iso)) / 86_400_000) : null;
}

function printStats(stats) {
  const days = daysSince(stats.lastFullRun?.at);
  console.log(
    days === null
      ? 'Полного прогона ещё не было.'
      : `Последний полный прогон: ${days} дн. назад (${stats.lastFullRun.device}): ` +
          `${stats.lastFullRun.passed} ок, ${stats.lastFullRun.flaky} нестабильно, ${stats.lastFullRun.failed} упало.`,
  );
  const rows = Object.entries(stats.flows).sort(
    ([, a], [, b]) => b.failed + b.flaky - (a.failed + a.flaky),
  );
  for (const [id, s] of rows) {
    const bad = s.failed + s.flaky;
    console.log(
      `${id.padEnd(20)} ${String(s.runs).padStart(3)} прогонов, ${String(bad).padStart(2)} проблем, ` +
        `последний: ${s.lastStatus.padEnd(7)} ${s.history.map((h) => ({ passed: '·', flaky: '~', failed: 'x' })[h]).join('')}`,
    );
  }
}

// ---------- главное ----------

const argv = process.argv.slice(2);

if (argv[0] === 'raw') {
  if (!existsSync(BIN)) install();
  process.exit(maestro(argv.slice(1)).status ?? 1);
}

if (argv[0] === 'stats') {
  printStats(loadStats());
  process.exit(0);
}

const take = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv.splice(i, 2)[1];
};
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i !== -1) argv.splice(i, 1);
  return i !== -1;
};

const requestedSerial = take('--device');
const planOnly = flag('--plan');
const preflightOnly = flag('--preflight');
const serial = planOnly ? (requestedSerial ?? 'plan') : pickDevice(requestedSerial);
const tagsArg = take('--tags');
const noReset = flag('--no-reset');
const noRetry = flag('--no-retry');
const withVideo = flag('--video') || !serial.startsWith('emulator-');
const extra = [];
for (let i = argv.indexOf('-e'); i !== -1; i = argv.indexOf('-e')) extra.push(...argv.splice(i, 2));

const all = catalog();
const mode = argv[0] ?? 'smoke';
let chosen;

if (mode === 'full') {
  chosen = all;
} else if (mode === 'smoke') {
  chosen = all.filter((f) => f.tags.includes('smoke'));
} else if (mode === 'changed') {
  const { tags, explicit } = changedAreas();
  chosen = all.filter((f) => f.tags.some((t) => tags.has(t)) || explicit.has(f.id));
  console.log(
    `Ветка трогает: ${[...tags].join(', ')}${explicit.size ? `; сценарии: ${[...explicit].join(', ')}` : ''}`,
  );
} else if (tagsArg || mode === 'tags') {
  const tags = new Set(['smoke', ...(tagsArg ?? '').split(',').filter(Boolean)]);
  chosen = all.filter((f) => f.tags.some((t) => tags.has(t)));
} else {
  const ids = argv.map((a) => a.replace(/^\.maestro[\\/]/, '').replace(/\.yaml$/, ''));
  chosen = all.filter((f) => ids.includes(f.id));
  if (chosen.length !== ids.length)
    fail(`Не нашёл сценарии: ${ids.filter((id) => !all.some((f) => f.id === id)).join(', ')}`);
}

const excluded = withVideo ? [] : chosen.filter((f) => f.tags.includes('video')).map((f) => f.id);
chosen = chosen.filter((f) => !excluded.includes(f.id));
if (excluded.length) {
  console.log(
    `На эмуляторе без видео-сценариев (--video, чтобы включить): ${excluded.join(', ')}` +
      (mode === 'full' ? '. Полным такой прогон не засчитается.' : ''),
  );
}
if (chosen.length === 0) fail('Под выбор не попал ни один сценарий.');

if (planOnly) {
  console.log(
    `Выбрано: ${chosen.map((f) => f.id).join(', ')}. Никакие процессы/данные не менялись.`,
  );
  process.exit(0);
}
const stats = loadStats();
const started = Date.now();
const outDir = join(tmpdir(), 'open-e2e', new Date().toISOString().replace(/[:.]/g, '-'));
console.log(
  `Устройство ${serial}, сценариев: ${chosen.length} (${chosen.map((f) => f.id).join(', ')})`,
);
try {
  prepare(serial, chosen, extra, { cleanup: !noReset, preflight: preflightOnly });
} catch (error) {
  fail(
    `Предпосылка не выполнена: ${error.message}\nДиагностика: ${saveDiagnostic('e2e-prepare', { serial, flows: chosen.map((f) => f.id), error: error.message })}`,
  );
}
if (preflightOnly) process.exit(0);
if (!existsSync(BIN)) install();

const results = [];
let aborted = false;
let previousFailure;
for (const flow of chosen) {
  const [outcome] = runFlows(serial, [flow], extra, join(outDir, flow.id));
  const result = { ...outcome, status: outcome.ok ? 'passed' : 'failed' };
  results.push(result);
  if (shouldStopRun(result, previousFailure)) {
    aborted = true;
    console.error(
      `Общая/повторная ошибка; оставшиеся сценарии и повторы остановлены. Лог: ${join(outDir, flow.id, 'maestro.log')}`,
    );
    break;
  }
  previousFailure = result.ok ? undefined : result.failure;
}

if (!noRetry && !aborted) {
  for (const result of results.filter((x) => x.status === 'failed')) {
    console.log(`Повтор с перезапуском только Open: ${result.flow.id}`);
    try {
      freshApp(serial);
    } catch (error) {
      console.error(error.message);
      aborted = true;
      break;
    }
    const [again] = runFlows(serial, [result.flow], extra, join(outDir, `retry-${result.flow.id}`));
    if (again.ok) result.status = 'flaky';
    result.seconds += again.seconds;
    if (shouldStopRun(again)) {
      aborted = true;
      break;
    }
  }
}
if (aborted)
  console.error(`Не выполнено: ${chosen.length - results.length}; это не успешные проверки.`);

saveStats(stats, results, serial, {
  full: mode === 'full' && !aborted,
  excluded,
  seconds: (Date.now() - started) / 1000,
});

const mark = { passed: 'ок', flaky: 'НЕСТАБИЛЬНО (прошёл со второго раза)', failed: 'УПАЛ' };
console.log(`\n===== Итог за ${Math.round((Date.now() - started) / 60_000)} мин, ${serial} =====`);
for (const r of results) {
  console.log(
    `${mark[r.status].padEnd(38)} ${r.flow.id}${r.status === 'failed' ? `  — ${(r.failure ?? '').slice(0, 160)}` : ''}`,
  );
}
console.log(`Журнал: .maestro/stats.json (npm run e2e -- stats). Артефакты: ${outDir}`);

process.exit(aborted || results.some((r) => r.status === 'failed') ? 1 : 0);
