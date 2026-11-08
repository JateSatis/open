// One bounded capture, optional existing Maestro flow, compact report. No global resets.
import { spawn } from 'node:child_process';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_ID, ROOT, STATE, command, packageInfo, sleep } from './dev-runtime.mjs';
import { checkFixtures } from './e2e-prepare.mjs';
import {
  ensureScrcpy,
  ensureTraceProcessor,
  frameSql,
  parseFrameSummary,
  traceConfig,
} from './visual-tools.mjs';

const HELP = `node scripts/visual.mjs capture --mode video|trace --seconds 45 [--flow smoke] [-s SERIAL]
  [--label before|after] [--conditions "release; warm cache; same account/network"] [--gestures]
  Без --flow: ручной маршрут после сообщения READY. По умолчанию только телефон.
  --flow: имя одного существующего .maestro/*.yaml; без уборки данных и повторов.
  --gestures: показать траекторию жеста (только video), временно включив pointer_location.
node scripts/visual.mjs frames <video.mp4>     # один лист, максимум 8 кадров с временем
node scripts/visual.mjs analyze <trace.perfetto-trace>
node scripts/visual.mjs restore <result-dir>  # настройки после аварийного завершения
Артефакты: .expo/agent-runtime/visual/. Читай summary.json, затем нужный лог/кадр.
`;

export function captureOptions(args) {
  const options = { mode: 'video', seconds: 45, label: 'capture', conditions: 'unspecified' };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--gestures') {
      options.gestures = true;
      continue;
    }
    const names = {
      '--mode': 'mode',
      '--seconds': 'seconds',
      '--flow': 'flow',
      '-s': 'serial',
      '--label': 'label',
      '--conditions': 'conditions',
    };
    if (!names[key] || !args[i + 1] || args[i + 1].startsWith('--'))
      throw new Error(`Неверный аргумент: ${key}`);
    options[names[key]] = args[++i];
  }
  options.seconds = Number(options.seconds);
  if (!Number.isInteger(options.seconds) || options.seconds < 3 || options.seconds > 120)
    throw new Error('--seconds: целое число от 3 до 120');
  if (!['video', 'trace'].includes(options.mode)) throw new Error('--mode: video или trace');
  if (options.gestures && options.mode !== 'video')
    throw new Error('--gestures применим только к видео');
  if (!/^[\w-]{1,40}$/.test(options.label))
    throw new Error('--label: до 40 латинских букв, цифр, _ или -');
  if (options.flow && !/^[\w-]+$/.test(options.flow))
    throw new Error('--flow: имя без пути и .yaml');
  return options;
}

function selectSerial(requested) {
  const devices = command('adb', ['devices'])
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter((v) => v.length === 2);
  const candidates = devices.filter(([id]) =>
    requested ? id === requested : !id.startsWith('emulator-'),
  );
  if (candidates.length !== 1 || candidates[0][1] !== 'device')
    throw new Error('Нужен один авторизованный телефон; для другого устройства укажи -s SERIAL.');
  return candidates[0][0];
}

function adb(serial, args) {
  return command('adb', ['-s', serial, ...args]).trim();
}
function setting(serial, key) {
  return adb(serial, ['shell', 'settings', 'get', 'system', key]);
}

export function restoreSettings(serial, values, invoke = adb) {
  const errors = [];
  for (const [key, value] of Object.entries(values)) {
    if (!['show_touches', 'pointer_location'].includes(key) || !/^(null|0|1)$/.test(value))
      throw new Error('Некорректные сохранённые настройки');
    try {
      invoke(serial, [
        'shell',
        'settings',
        value === 'null' ? 'delete' : 'put',
        'system',
        key,
        ...(value === 'null' ? [] : [value]),
      ]);
    } catch (error) {
      errors.push(`${key}: ${error.message}`);
    }
  }
  if (errors.length) throw new Error(`Не восстановлены настройки: ${errors.join('; ')}`);
}

export function validateFlowResult(result, xml, elapsedMs, seconds) {
  if (result.code !== 0 || result.timedOut || elapsedMs >= seconds * 1000)
    throw new Error('Сценарий не завершён успешно внутри окна записи; см. maestro.log');
  if (!/<testcase\b/.test(xml) || /<(failure|error|skipped)\b/.test(xml))
    throw new Error('Нет успешного JUnit отчёта');
}

export function actionTimeline(commands, readyAt) {
  return commands.flatMap(({ command: action, metadata }) => {
    const type = Object.keys(action ?? {})[0];
    if (!/^(tapOn|swipe|scroll|pressKey|inputText|eraseText|backPress|openLink)/.test(type))
      return [];
    const detail = action[type];
    return [
      {
        action: type,
        target: detail.selector?.idRegex ?? detail.selector?.textRegex ?? detail.code ?? null,
        commandStartMs: metadata?.timestamp - readyAt,
        commandDurationMs: metadata?.duration,
        status: metadata?.status,
      },
    ];
  });
}

function child(file, args, logFile, timeout) {
  const log = openSync(logFile, 'w');
  const proc = spawn(file, args, {
    cwd: ROOT,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let text = '',
    ended = false;
  for (const stream of [proc.stdout, proc.stderr])
    stream.on('data', (chunk) => {
      // Append through the open descriptor: full logs stay out of agent context.
      writeFileSync(log, chunk);
      text = (text + chunk.toString()).slice(-8000);
    });
  const stop = () => {
    if (ended) return;
    if (process.platform === 'win32') command('taskkill', ['/PID', String(proc.pid), '/T', '/F']);
    else proc.kill('SIGTERM');
  };
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      stop();
    } catch {
      /* exit raced timeout */
    }
  }, timeout);
  const done = new Promise((resolveResult) => {
    proc.on('error', (error) => {
      text += error.message;
    });
    proc.on('close', (code) => {
      ended = true;
      clearTimeout(timer);
      closeSync(log);
      resolveResult({ code, timedOut, tail: text.slice(-1000) });
    });
  });
  return {
    done,
    stop,
    get ended() {
      return ended;
    },
    get text() {
      return text;
    },
  };
}

export function analyzeTrace(file, processor = ensureTraceProcessor()) {
  const sql = `${file}.sql`,
    csv = `${file}.csv`;
  writeFileSync(sql, frameSql(APP_ID));
  const output = command(processor, [file, '-q', sql], { timeout: 60000 });
  writeFileSync(csv, output);
  return parseFrameSummary(output);
}

async function capture(options) {
  const serial = selectSerial(options.serial);
  const dir = join(
    STATE,
    'visual',
    `${new Date().toISOString().replace(/[:.]/g, '-')}-${options.label}`,
  );
  mkdirSync(dir, { recursive: true });
  const summary = {
    ...options,
    serial,
    dir,
    status: 'preparing',
    startedAt: new Date().toISOString(),
    settings: {},
  };
  const save = () => writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  const flow = options.flow && join(ROOT, '.maestro', `${options.flow}.yaml`);
  let recorder,
    runner,
    tracePid,
    captureStart,
    interrupted = false;
  const remote = `/data/misc/perfetto-traces/open-${Date.now()}.perfetto-trace`;
  const interrupt = () => {
    interrupted = true;
    for (const handle of [runner, recorder]) {
      try {
        handle?.stop();
      } catch {
        /* child may exit between signal and kill */
      }
    }
  };
  try {
    save();
    const policy = adb(serial, ['shell', 'dumpsys', 'window', 'policy']);
    if (/^\s*showing=true\s*$/m.test(policy))
      throw new Error('Телефон заблокирован. Разблокируй экран перед захватом.');
    // Preparation is outside the recording; no SQL cleanup or test retries in visual runs.
    if (flow && !existsSync(flow)) throw new Error(`Нет сценария: ${flow}`);
    const activity = adb(serial, ['shell', 'dumpsys', 'activity', 'activities']);
    if (
      !activity
        .split(/\r?\n/)
        .some(
          (line) => /(?:topResumedActivity|mResumedActivity)/.test(line) && line.includes(APP_ID),
        )
    )
      throw new Error('Open должен быть открыт на нужной сборке; сначала device.mjs up.');
    summary.preflightScope =
      'foreground app and declared fixtures; backend health and APK/source compatibility not verified';
    if (flow) {
      summary.fixtures = checkFixtures([{ id: options.flow, file: flow }], []);
      adb(serial, [
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
      const ready = command(
        process.execPath,
        [join(ROOT, 'scripts/device.mjs'), 'wait', 'id:tab-bar', '-s', serial, '--timeout', '10'],
        { timeout: 30000 },
      );
      writeFileSync(join(dir, 'preflight.log'), ready);
    }
    if (flow) copyFileSync(flow, join(dir, 'scenario.yaml'));
    summary.build = packageInfo(serial);
    summary.android = adb(serial, ['shell', 'getprop', 'ro.build.version.release']);
    summary.device = adb(serial, ['shell', 'getprop', 'ro.product.model']);
    summary.gitHead = command('git', ['rev-parse', 'HEAD']).trim();
    const gitStatus = command('git', ['status', '--short']);
    summary.dirty = Boolean(gitStatus.trim());
    writeFileSync(join(dir, 'git-status.txt'), gitStatus);
    summary.battery = adb(serial, ['shell', 'dumpsys', 'battery'])
      .split(/\r?\n/)
      .filter((v) => /level:|temperature:|powered:/.test(v))
      .map((v) => v.trim());
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    if (options.mode === 'video') {
      const scrcpy = ensureScrcpy();
      command('ffprobe', ['-version']);
      for (const key of ['show_touches', ...(options.gestures ? ['pointer_location'] : [])]) {
        summary.settings[key] = setting(serial, key);
        save();
        adb(serial, ['shell', 'settings', 'put', 'system', key, '1']);
        if (setting(serial, key) !== '1') throw new Error(`Не удалось включить ${key}`);
      }
      recorder = child(
        scrcpy,
        [
          '-s',
          serial,
          '--no-audio',
          '--no-playback',
          '--no-window',
          '--no-clipboard-autosync',
          `--record=${join(dir, 'video.mp4')}`,
          `--time-limit=${options.seconds}`,
        ],
        join(dir, 'scrcpy.log'),
        (options.seconds + 20) * 1000,
      );
      const until = Date.now() + 15000;
      while (!/Recording started/.test(recorder.text)) {
        if (recorder.ended || Date.now() > until || interrupted)
          throw new Error('scrcpy не начал запись; см. scrcpy.log');
        await sleep(100);
      }
    } else {
      if (Number(adb(serial, ['shell', 'getprop', 'ro.build.version.sdk'])) < 31)
        throw new Error('FrameTimeline требует Android 12+');
      summary.traceProcessor = ensureTraceProcessor();
      const config = join(dir, 'trace.pbtxt');
      writeFileSync(config, traceConfig(options.seconds));
      // shell cannot push configs into perfetto's output directory on production Android.
      const started = command(
        'adb',
        ['-s', serial, 'shell', 'perfetto', '--background-wait', '--txt', '-c', '-', '-o', remote],
        { input: readFileSync(config, 'utf8'), timeout: 35000 },
      ).trim();
      tracePid = started.match(/^\d+$/m)?.[0];
      if (!tracePid) throw new Error(`Perfetto не вернул PID: ${started}`);
    }
    captureStart = Date.now();
    summary.captureReadyAt = captureStart;
    summary.status = 'recording';
    save();
    console.log(
      `READY ${options.mode}: ${options.seconds} с; ${flow ? options.flow : 'выполни ручной маршрут'}. ${dir}`,
    );
    if (flow) {
      runner = child(
        process.execPath,
        [
          join(ROOT, 'scripts/maestro.mjs'),
          'raw',
          '--device',
          serial,
          'test',
          '--format',
          'JUNIT',
          '--output',
          join(dir, 'report.xml'),
          '--debug-output',
          join(dir, 'maestro'),
          '--no-reinstall-driver',
          flow,
        ],
        join(dir, 'maestro.log'),
        options.seconds * 1000,
      );
      summary.flowResult = await runner.done;
      summary.flowElapsedMs = Date.now() - captureStart;
      const report = join(dir, 'report.xml');
      validateFlowResult(
        summary.flowResult,
        existsSync(report) ? readFileSync(report, 'utf8') : '',
        summary.flowElapsedMs,
        options.seconds,
      );
    }
    if (recorder) {
      const result = await recorder.done;
      if (result.code !== 0 || result.timedOut)
        throw new Error('Запись не завершена; см. scrcpy.log');
      const video = join(dir, 'video.mp4');
      summary.videoSeconds = Number(
        command('ffprobe', [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=nw=1:nk=1',
          video,
        ]),
      );
      if (!(summary.videoSeconds > 0)) throw new Error('Видео не читается');
    } else {
      while (Date.now() < captureStart + options.seconds * 1000) {
        if (interrupted) throw new Error('Прервано');
        await sleep(250);
      }
      const trace = join(dir, 'trace.perfetto-trace');
      adb(serial, ['pull', remote, trace]);
      if (statSync(trace).size < 100) throw new Error('Пустая трасса');
      summary.frames = analyzeTrace(trace, summary.traceProcessor);
    }
    if (interrupted) throw new Error('Прервано');
    summary.status = flow ? 'captured-flow-passed' : 'captured-manual-unverified';
  } catch (error) {
    summary.status = 'failed';
    summary.error = error.message;
    process.exitCode = 1;
  } finally {
    // A failed assertion must not destroy the video evidence. Let the recorder's
    // native deadline finalize MP4; Ctrl+C still stops immediately.
    if (runner && recorder && !recorder.ended && !interrupted) await recorder.done;
    for (const processHandle of [runner, recorder]) {
      if (processHandle && !processHandle.ended) {
        try {
          processHandle.stop();
        } catch {
          /* log already retained */
        }
        await processHandle.done;
      }
    }
    if (tracePid) {
      // Only this capture's PID, never kill all perfetto sessions.
      try {
        if (adb(serial, ['shell', 'cat', `/proc/${tracePid}/cmdline`]).includes(remote))
          adb(serial, ['shell', 'kill', '-TERM', tracePid]);
      } catch {
        /* bounded session already ended */
      }
      const trace = join(dir, 'trace.perfetto-trace');
      if (!existsSync(trace)) {
        try {
          await sleep(500);
          adb(serial, ['pull', remote, trace]);
          summary.traceScope = 'partial capture after failure; scenario did not pass';
        } catch (error) {
          summary.traceRecoveryError = error.message;
        }
      }
      try {
        adb(serial, ['shell', 'rm', '-f', remote]);
      } catch {
        /* disconnected device */
      }
    }
    try {
      restoreSettings(serial, summary.settings);
      summary.settingsRestored = true;
    } catch (error) {
      summary.restoreError = error.message;
      process.exitCode = 1;
    }
    summary.endedAt = new Date().toISOString();
    const debug = join(dir, 'maestro');
    if (existsSync(debug)) {
      try {
        const file = readdirSync(debug, { recursive: true }).find((name) =>
          name.endsWith('commands.json'),
        );
        if (file)
          writeFileSync(
            join(dir, 'actions.json'),
            JSON.stringify(
              {
                scope:
                  'Maestro command wall times relative to READY; not touch timestamps or MP4 PTS',
                actions: actionTimeline(
                  JSON.parse(readFileSync(join(debug, file), 'utf8')),
                  captureStart,
                ),
              },
              null,
              2,
            ),
          );
      } catch (error) {
        summary.actionLogError = error.message;
      }
    }
    save();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
  console.log(
    `${summary.status}${summary.error ? `: ${summary.error}` : ''}\n${join(dir, 'summary.json')}`,
  );
  if (summary.frames) console.log(JSON.stringify(summary.frames));
  if (summary.restoreError)
    console.error(
      `${summary.restoreError}\nПосле подключения: node scripts/visual.mjs restore "${dir}"`,
    );
}

function frames(file) {
  const duration = Number(
    command('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      file,
    ]),
  );
  if (!(duration > 0 && duration <= 125))
    throw new Error('Нужен короткий читаемый ролик (до 125 с)');
  const output = `${file}.jpg`;
  command(
    'ffmpeg',
    [
      '-y',
      '-v',
      'error',
      '-i',
      file,
      '-vf',
      `select='isnan(prev_selected_t)+gte(t-prev_selected_t,${duration / 8})',scale=270:-1,drawtext=text='%{pts\\:hms}':x=4:y=4:fontsize=18:fontcolor=white:box=1:boxcolor=black,tile=4x2`,
      '-frames:v',
      '1',
      output,
    ],
    { timeout: 60000 },
  );
  console.log(output);
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (!mode || mode === 'help' || mode === '--help') {
    console.log(HELP);
    return;
  }
  if (mode === 'capture') return capture(captureOptions(args));
  if (mode === 'frames' && args.length === 1) return frames(resolve(args[0]));
  if (mode === 'analyze' && args.length === 1) {
    console.log(JSON.stringify(analyzeTrace(resolve(args[0])), null, 2));
    return;
  }
  if (mode === 'restore' && args.length === 1) {
    const summary = JSON.parse(readFileSync(join(resolve(args[0]), 'summary.json'), 'utf8'));
    restoreSettings(summary.serial, summary.settings);
    console.log('Настройки восстановлены.');
    return;
  }
  throw new Error(HELP);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
