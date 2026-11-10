// Runs the complete PostgREST request on the VPS, without a local DB tunnel.
// Only this run's fixtures are removed. Credentials travel inside SSH stdin.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';
import { Buffer } from 'node:buffer';

const env = Object.fromEntries(
  readFileSync('infra/.env', 'utf8')
    .split(/\r?\n/)
    .filter((x) => /^[A-Z_]+=/.test(x))
    .map((x) => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1).trim()]),
);
const cache = new Map();
function load(path) {
  if (path === '@/api/supabase') return { supabase: {} };
  const file = resolve('src/' + path.slice(2) + '.ts');
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const js = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', js)(
    (p) => (p.startsWith('@/') ? load(p) : createRequire(file)(p)),
    exports,
  );
  return exports;
}
const projection = load('@/api/messageRows');
const config = {
  password: env.POSTGRES_PASSWORD,
  secret: env.JWT_SECRET,
  legacyColumns: projection.MESSAGE_COLUMNS,
  elementColumns: projection.HISTORY_ELEMENT_COLUMNS,
  baseline: process.argv.includes('--baseline'),
};
const source = readFileSync(new URL('./history-elements-check.cjs', import.meta.url), 'utf8');
const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];
if (process.env.TARGET_SSH_BIND_ADDRESS) args.push('-b', process.env.TARGET_SSH_BIND_ADDRESS);
args.push(
  process.env.TARGET_SSH_HOST ?? `root@${env.API_DOMAIN}`,
  `docker exec -i ${process.argv.includes('--diagnose') ? '-e ELEMENT_DIAG=1 ' : ''}open-storage node`,
);
mkdirSync('.backup', { recursive: true });
const output = [];
const child = spawn('ssh', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
child.stdout.on('data', (chunk) => {
  output.push(chunk);
  process.stdout.write(chunk);
});
child.stderr.on('data', (chunk) => {
  output.push(chunk);
  process.stderr.write(chunk);
});
child.stdin.end(`const config = ${JSON.stringify(config)};\n${source}`);
const code = await new Promise((resolve, reject) => {
  child.on('exit', resolve);
  child.on('error', reject);
});
writeFileSync(
  `.backup/history-elements-${process.argv.includes('--diagnose') ? 'diagnose' : config.baseline ? 'before' : 'after'}.log`,
  Buffer.concat(output),
);
process.exitCode = code ?? 1;
