// Shared diagnostics and Metro ownership for device/usb/Maestro. No automatic global reset.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const STATE = join(ROOT, '.expo', 'agent-runtime');
export const PORT = 8081;
export const APP_ID = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).expo.android.package;
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export function command(file, args, options = {}) {
  const result = spawnSync(file, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 20000,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${file}: ${result.error?.code ?? `exit ${result.status}`} ${(result.stderr ?? '').trim().slice(-500)}`,
    );
  return result.stdout ?? '';
}

export async function http(url, options = {}, ms = 5000) {
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(ms) });
    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      text: await response.text(),
    };
  } catch (error) {
    return { ok: false, status: 0, text: error.cause?.code ?? error.name };
  }
}

export function sameRoot(value, root = ROOT) {
  if (!value) return false;
  const normalize = (path) => {
    const normalized = resolve(decodeURIComponent(path)).replace(/\\/g, '/');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  return normalize(value) === normalize(root);
}

export async function metroStatus() {
  const result = await http(`http://127.0.0.1:${PORT}/status`, {}, 2500);
  const running = result.ok && result.text.trim() === 'packager-status:running';
  const project = result.headers?.get('x-react-native-project-root');
  return {
    running,
    owned: running && sameRoot(project),
    project: project ? decodeURIComponent(project) : null,
    status: result.status,
  };
}

export async function checkManifest() {
  const result = await http(
    `http://127.0.0.1:${PORT}/`,
    { headers: { 'expo-platform': 'android', accept: 'application/expo+json' } },
    60000,
  );
  let manifest;
  try {
    manifest = JSON.parse(result.text);
  } catch {
    /* A status/HTML page is not a manifest. */
  }
  if (!result.ok || manifest?.error || !manifest?.launchAsset?.url)
    throw new Error(
      `Metro: манифест не готов (HTTP ${result.status}); см. ${join(STATE, 'metro.stderr.log')}`,
    );
}

function savedMetro() {
  try {
    return JSON.parse(readFileSync(join(STATE, 'metro.json'), 'utf8'));
  } catch {
    return null;
  }
}

function isRecordedMetro(record) {
  if (!record || record.root !== ROOT || !Number.isInteger(record.pid)) return false;
  try {
    // PID alone is insufficient: it can have been reused since the previous run.
    if (process.platform === 'win32') {
      const text = command('powershell', [
        '-NoProfile',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId = ${record.pid}").CommandLine`,
      ]);
      return text.includes(record.launcher);
    }
    return command('ps', ['-p', String(record.pid), '-o', 'args=']).includes(record.launcher);
  } catch {
    return false;
  }
}

export function stopOwnedMetro() {
  const record = savedMetro();
  if (!isRecordedMetro(record))
    throw new Error(
      'Metro: нет подтверждённого процесса этого запуска; чужой процесс не остановлен.',
    );
  if (process.platform === 'win32') command('taskkill', ['/F', '/T', '/PID', String(record.pid)]);
  else process.kill(-record.pid, 'SIGTERM');
}

export async function ensureMetro({ start = true } = {}) {
  const status = await metroStatus();
  if (status.running) {
    if (!status.owned)
      throw new Error(
        `Metro: порт ${PORT} принадлежит другому или неизвестному проекту (${status.project ?? 'нет заголовка проекта'}).`,
      );
    await checkManifest();
    return 'reuse';
  }
  if (status.status)
    throw new Error(
      `Metro: порт ${PORT} занят другим HTTP-сервисом; автоматическое завершение отключено.`,
    );
  if (!start) throw new Error('Metro не запущен; выполни device.mjs up.');
  const record = savedMetro();
  if (isRecordedMetro(record))
    throw new Error(
      'Metro: наш процесс ещё жив, но не отвечает; смотри лог или используй reset --component metro.',
    );
  const busy = await new Promise((done) => {
    const socket = createConnection({ host: '127.0.0.1', port: PORT });
    const finish = (value) => {
      socket.destroy();
      done(value);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1500, () => finish(true));
  });
  if (busy)
    throw new Error(
      `Metro: TCP-порт ${PORT} занят, владелец не подтверждён; процесс не остановлен.`,
    );
  mkdirSync(STATE, { recursive: true });
  const launcher = join(STATE, 'metro-launcher.cjs');
  const require = createRequire(import.meta.url);
  const expoCli = join(dirname(require.resolve('expo/package.json')), 'bin', 'cli');
  writeFileSync(
    launcher,
    `process.chdir(${JSON.stringify(ROOT)}); process.argv = [process.execPath, ${JSON.stringify(expoCli)}, 'start', '--dev-client', '--port', '${PORT}']; require(${JSON.stringify(expoCli)});\n`,
  );
  const output = join(STATE, 'metro.stdout.log');
  const error = join(STATE, 'metro.stderr.log');
  let pid;
  if (process.platform === 'win32') {
    const quote = (s) => `'${s.replace(/'/g, "''")}'`;
    const pidFile = join(STATE, 'metro.pid');
    // No inherited pipes: a detached descendant holding a pipe makes spawnSync wait forever.
    command(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `$p = Start-Process -FilePath ${quote(process.execPath)} -ArgumentList ${quote('"' + launcher + '"')} -WorkingDirectory ${quote(ROOT)} -WindowStyle Hidden -RedirectStandardOutput ${quote(output)} -RedirectStandardError ${quote(error)} -PassThru; [System.IO.File]::WriteAllText(${quote(pidFile)}, [string]$p.Id)`,
      ],
      { stdio: 'ignore' },
    );
    pid = Number(readFileSync(pidFile, 'utf8').trim());
  } else {
    const out = openSync(output, 'a');
    const err = openSync(error, 'a');
    const child = spawn(process.execPath, [launcher], {
      cwd: ROOT,
      detached: true,
      stdio: ['ignore', out, err],
    });
    pid = child.pid;
    child.unref();
    closeSync(out);
    closeSync(err);
  }
  writeFileSync(join(STATE, 'metro.json'), JSON.stringify({ pid, root: ROOT, launcher }));
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const ready = await metroStatus();
    if (ready.owned) {
      await checkManifest();
      return 'started';
    }
    if (ready.running || ready.status)
      throw new Error('Metro: другой сервис занял порт во время запуска.');
    await sleep(2000);
  }
  throw new Error(
    `Metro: не готов за 120 с; процесс сохранён, повторно не запускай. Лог: ${error}`,
  );
}

export function packageInfo(serial) {
  const text = command('adb', ['-s', serial, 'shell', 'dumpsys', 'package', APP_ID]);
  if (!/versionCode=/.test(text)) throw new Error(`${APP_ID} не установлен на ${serial}.`);
  return {
    versionCode: text.match(/versionCode=(\d+)/)?.[1],
    versionName: text.match(/versionName=([^\r\n]+)/)?.[1]?.trim(),
    updated: text.match(/lastUpdateTime=([^\r\n]+)/)?.[1]?.trim(),
    devClient: /devlauncher/i.test(text),
  };
}

export function classifyUi(xml) {
  if (!xml) return 'unknown';
  if (/Unable to load script|Failed to load|Uncaught Error|Render Error|SyntaxError/.test(xml))
    return 'error';
  if (/resource-id="(?:[^" ]+:id\/)?(?:tab-bar|messages-list)"/.test(xml)) return 'ready';
  if (/Продолжить с (Google|Apple)/.test(xml)) return 'sign-in';
  return 'unknown';
}

export async function backendStatus() {
  // Load only public client configuration. Never copy env values or response bodies to diagnostics.
  const require = createRequire(import.meta.url);
  createRequire(require.resolve('expo/package.json'))('@expo/env').load(ROOT, { silent: true });
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { ok: false, summary: 'нет публичной конфигурации клиента' };
  const headers = { apikey: key };
  const [auth, rest] = await Promise.all([
    http(`${url.replace(/\/$/, '')}/auth/v1/health`, { headers }, 8000),
    // The API root generates the entire OpenAPI schema. Probe an empty query instead.
    http(`${url.replace(/\/$/, '')}/rest/v1/profiles?select=id&limit=0`, { headers }, 8000),
  ]);
  let permissionDenied = false;
  try {
    permissionDenied = [401, 403].includes(rest.status) && JSON.parse(rest.text).code === '42501';
  } catch {
    /* not a Postgres response */
  }
  return {
    ok: auth.ok && (rest.ok || permissionDenied),
    summary: `с компьютера: Auth ${auth.status || auth.text}, REST ${rest.status || rest.text}; права аккаунта/сеть телефона отдельно`,
  };
}

export function saveDiagnostic(commandName, data) {
  mkdirSync(STATE, { recursive: true });
  const path = join(STATE, `${commandName}-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify({ at: new Date().toISOString(), ...data }, null, 2));
  return path;
}
