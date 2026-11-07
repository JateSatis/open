import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runSql } from './psql-transport.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ENV_FILE = resolve(ROOT, 'infra', '.env');
const WORKER_URL = 'http://caddy:8000/functions/v1/fragment-clusters';

function readEnvFile(path) {
  const values = new Map();
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith('#')) continue;
    values.set(match[1], match[2].replace(/^(['"])(.*)\1$/, '$2'));
  }
  return values;
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function required(values, name) {
  const value = values.get(name);
  if (!value) throw new Error(`${name} не задан в infra/.env.`);
  return value;
}

const env = readEnvFile(ENV_FILE);
const secret = required(env, 'FRAGMENT_CLUSTERS_SECRET');
const urlSql = quoteLiteral(WORKER_URL);
const secretSql = quoteLiteral(secret);
const EXERCISE_JOBS = [
  'fragment-cluster-history-cleanup',
  'purge-friend-request-log',
  'purge-search-request-log',
  'purge-user-presence',
];

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function configureSecret(name, valueSql) {
  const existingId = runSql(`select id from vault.secrets where name = ${quoteLiteral(name)};`, {
    capture: true,
  });
  if (existingId) {
    runSql(
      `select vault.update_secret('${existingId}'::uuid, ${valueSql}, ${quoteLiteral(name)});`,
      { capture: true },
    );
  } else {
    runSql(`select vault.create_secret(${valueSql}, ${quoteLiteral(name)});`, { capture: true });
  }
}

const auditSql = `
with expected(name) as (values
  ('release-public-messages'),
  ('fragment-clusters-kick'),
  ('finish-abandoned-streams'),
  ('rec-journal-rollup'),
  ('rec-journal-partitions'),
  ('fragment-cluster-history-cleanup'),
  ('delete-abandoned-accounts'),
  ('purge-friend-request-log'),
  ('purge-search-request-log'),
  ('purge-user-presence'),
  ('purge-contact-request-log')
), ranked_runs as (
  select j.jobname, d.status, d.end_time,
         row_number() over (partition by j.jobname order by d.start_time desc, d.runid desc) as n
  from cron.job_run_details d
  join cron.job j on j.jobid = d.jobid
  where j.jobname in (select name from expected)
)
select 'job' as kind, e.name, coalesce(j.active::text, 'missing') as state,
       coalesce(j.schedule, '') as detail
from expected e left join cron.job j on j.jobname = e.name
union all
select 'job_run', e.name, coalesce(r.status, 'never'),
       coalesce(to_char(end_time, 'YYYY-MM-DD HH24:MI:SS TZ'), 'never')
from expected e left join ranked_runs r on r.jobname = e.name and r.n = 1
union all
select 'vault', name,
       case name
         when 'fragment_clusters_worker_url' then (decrypted_secret = ${urlSql})::text
         else (length(decrypted_secret) > 0)::text
       end,
       ''
from vault.decrypted_secrets
where name in ('fragment_clusters_worker_url', 'fragment_clusters_worker_secret')
union all
select 'http', 'net._http_response', coalesce(status_code::text, 'inflight'),
       coalesce(to_char(max(created), 'YYYY-MM-DD HH24:MI:SS TZ'), 'empty') ||
       '; rows=' || count(*)::text || '; row_bytes=' || coalesce(sum(pg_column_size(r))::text, '0') ||
       '; relation=' || pg_size_pretty(pg_total_relation_size('net._http_response'))
from net._http_response r
group by status_code
union all
select 'maintenance', 'cron.job_run_details', 'counts',
       'rows=' || count(*)::text || '; relation=' || pg_size_pretty(pg_total_relation_size('cron.job_run_details')) ||
       '; oldest=' || coalesce(to_char(min(start_time), 'YYYY-MM-DD HH24:MI:SS TZ'), 'empty')
from cron.job_run_details
order by 1, 2, 3;
`;

async function exerciseDeferredJobs() {
  const names = EXERCISE_JOBS.map(quoteLiteral).join(', ');
  const rows = runSql(
    `select jobid, jobname, schedule from cron.job where jobname in (${names}) order by jobname;`,
    { capture: true },
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [jobId, name, schedule] = line.split('|');
      return { jobId, name, schedule };
    });
  if (rows.length !== EXERCISE_JOBS.length || rows.some((row) => !row.jobId || !row.schedule)) {
    throw new Error('Не удалось однозначно получить расписания отложенных cron-задач.');
  }

  const startedAt = new Date().toISOString();
  let result;
  try {
    for (const row of rows) {
      runSql(`select cron.alter_job(${Number(row.jobId)}, schedule := '* * * * *');`);
    }

    for (let attempt = 0; attempt < 80; attempt += 1) {
      const completed = runSql(
        `select j.jobname, d.status from cron.job_run_details d join cron.job j using (jobid) ` +
          `where j.jobname in (${names}) and d.start_time > '${startedAt}'::timestamptz ` +
          `and d.status <> 'running' order by j.jobname;`,
        { capture: true },
      )
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => line.split('|'));
      const latest = new Map(completed.map(([name, status]) => [name, status]));
      if (EXERCISE_JOBS.every((name) => latest.has(name))) {
        result = latest;
        break;
      }
      await sleep(1000);
    }
  } finally {
    for (const row of rows) {
      runSql(
        `select cron.alter_job(${Number(row.jobId)}, schedule := ${quoteLiteral(row.schedule)});`,
      );
    }
  }

  if (!result)
    throw new Error(
      'Отложенные cron-задачи не завершились за 80 секунд; исходные расписания восстановлены.',
    );
  const failed = [...result].filter(([, status]) => status !== 'succeeded');
  if (failed.length)
    throw new Error(
      `Cron-задачи завершились с ошибкой: ${failed.map(([name, status]) => `${name}=${status}`).join(', ')}`,
    );
  console.log(
    `Принудительный live-проход cron: ${EXERCISE_JOBS.join(', ')} — succeeded; исходные расписания восстановлены.`,
  );
}

try {
  configureSecret('fragment_clusters_worker_url', urlSql);
  configureSecret('fragment_clusters_worker_secret', secretSql);
  if (process.argv.includes('--exercise-deferred-jobs')) await exerciseDeferredJobs();
  const report = runSql(auditSql, { capture: true });
  console.log('Vault worker secrets configured. Secret values are not displayed.');
  console.log(report);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
