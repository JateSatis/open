// Host tools are cached outside the repository; no app dependency or APK rebuild.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command } from './dev-runtime.mjs';

export const TOOLS = join(process.env.LOCALAPPDATA ?? tmpdir(), 'open-tools');

export function ensureScrcpy() {
  if (process.platform !== 'win32') return 'scrcpy';
  const dir = join(TOOLS, 'scrcpy-win64-v3.1');
  const exe = join(dir, 'scrcpy.exe');
  if (existsSync(exe)) return exe;
  mkdirSync(TOOLS, { recursive: true });
  const zip = join(TOOLS, 'scrcpy.zip');
  command(
    'curl',
    [
      '-fLsS',
      '--max-time',
      '120',
      '-o',
      zip,
      'https://github.com/Genymobile/scrcpy/releases/download/v3.1/scrcpy-win64-v3.1.zip',
    ],
    { timeout: 125000 },
  );
  command(
    join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'),
    ['-xf', zip, '-C', TOOLS],
    { timeout: 60000 },
  );
  if (!existsSync(exe)) throw new Error('scrcpy не распаковался.');
  return exe;
}

export function ensureTraceProcessor() {
  if (process.env.OPEN_TRACE_PROCESSOR) return process.env.OPEN_TRACE_PROCESSOR;
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('Укажи OPEN_TRACE_PROCESSOR — путь к trace_processor_shell этой платформы.');
  // Official v59.1 launcher pins this Windows binary to v58.2 and this SHA-256.
  const sha = 'adfa6bad3d72be3ba9b83fa2b17b69fa13b3ab1cad0f42e52b86188bd5f0f997';
  const exe = join(TOOLS, 'trace_processor-v58.2.exe');
  const matches = (file) =>
    existsSync(file) && createHash('sha256').update(readFileSync(file)).digest('hex') === sha;
  if (matches(exe)) return exe;
  mkdirSync(TOOLS, { recursive: true });
  const part = `${exe}.part`;
  command(
    'curl',
    [
      '-fLsS',
      '--max-time',
      '120',
      '-o',
      part,
      'https://commondatastorage.googleapis.com/perfetto-luci-artifacts/v58.2/windows-amd64/trace_processor_shell.exe',
    ],
    { timeout: 125000 },
  );
  if (!matches(part)) {
    rmSync(part, { force: true });
    throw new Error('trace_processor: SHA-256 не совпадает.');
  }
  renameSync(part, exe);
  return exe;
}

export function traceConfig(seconds) {
  return `buffers { size_kb: 16384 fill_policy: DISCARD }
duration_ms: ${seconds * 1000}
data_sources { config { name: "android.surfaceflinger.frametimeline" } }
data_sources { config { name: "linux.process_stats" process_stats_config { scan_all_processes_on_start: true } } }
data_sources { config { name: "linux.ftrace" ftrace_config {
  ftrace_events: "sched/sched_switch"
  ftrace_events: "sched/sched_waking"
  atrace_categories: "gfx"
  atrace_categories: "view"
  atrace_apps: "com.openger.app"
} } }
`;
}

export function frameSql(appId) {
  if (!/^[\w.]+$/.test(appId)) throw new Error('Некорректный appId');
  // A frame can have several surface slices: count the token once per process.
  return `WITH frames AS (
    SELECT f.upid, surface_frame_token, MAX(dur) AS dur,
      MAX(CASE WHEN jank_type NOT IN ('None', '') THEN 1 ELSE 0 END) AS jank,
      MAX(CASE WHEN jank_type IS NULL OR jank_type = '' THEN 1 ELSE 0 END) AS unknown
    FROM actual_frame_timeline_slice f JOIN process p USING (upid)
    WHERE p.name = '${appId}' AND surface_frame_token > 0 AND dur >= 0
    GROUP BY f.upid, surface_frame_token
  ) SELECT COUNT(*) AS frames, COALESCE(SUM(jank), 0) AS janky_frames,
    COALESCE(SUM(unknown), 0) AS unknown_frames,
    COALESCE(ROUND(MAX(dur)/1e6, 2), 0) AS max_frame_work_ms,
    (SELECT COALESCE(SUM(value), 0) FROM stats WHERE severity = 'data_loss') AS data_loss
  FROM frames;`;
}

export function parseFrameSummary(csv) {
  const lines = csv.trim().split(/\r?\n/);
  const row = lines
    .at(-1)
    ?.split(',')
    .map((v) => Number(v.replaceAll('"', '')));
  if (row?.length !== 5 || row.some((n) => !Number.isFinite(n)))
    throw new Error('Неожиданный отчёт trace_processor; см. trace.csv.');
  const [frames, jankyFrames, unknownFrames, maxFrameWorkMs, dataLoss] = row;
  return {
    status: !frames ? 'no-frame-data' : dataLoss || unknownFrames ? 'incomplete' : 'measured',
    frames,
    jankyFrames,
    unknownFrames,
    maxFrameWorkMs,
    dataLoss,
    jankPercent: frames ? Math.round((jankyFrames / frames) * 10000) / 100 : null,
    sampleNote:
      frames < 30
        ? 'few frame samples; do not infer smoothness from this percentage'
        : 'interpret with scenario and repeat variability',
    scope: 'whole capture, app surface frame tokens; not FPS or input/content latency',
  };
}
