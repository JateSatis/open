// Полный локальный экспорт данных и медиа из облачного Supabase в `.backup/`.
//
// Что выгружается:
//   1. `auth.users` и `auth.identities` (через `npx supabase db query --linked`).
//   2. Все базовые и партиционированные таблицы `public` (включая `media_objects`,
//      `identity_secret`, `rec_*`, `messages`, `chats`, `profiles` и др.),
//      а также текущие значения последовательностей (`messages_seq_seq`,
//      `saved_messages_seq_seq`) и метаданные `storage.buckets` / `storage.objects`.
//   3. Все файлы из бакетов `avatars`, `chat-media`, `media` в `.backup/storage/<bucket>/<path>`
//      с проверкой размера и сверкой количества строк и скачанных файлов.
//
// Запуск:
//   node scripts/migration/export-cloud.mjs
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/migration/export-cloud.mjs
//
// Если `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` не переданы в окружении,
// скрипт сам берёт URL из `.env`, а сервисный ключ запрашивает у привязанного
// проекта через `npx supabase projects api-keys`. Ключи в файлы не сохраняются.

import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const BACKUP_DIR = resolve(ROOT, process.env.BACKUP_DIR ?? '.backup');
const TABLES_DIR = join(BACKUP_DIR, 'tables');
const STORAGE_DIR = join(BACKUP_DIR, 'storage');

export const TARGET_BUCKETS = ['avatars', 'chat-media', 'media'];

/** Разбирает JSON-вывод `npx supabase db query --linked -o json`. */
export function parseCliQueryOutput(stdout) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Не удалось разобрать JSON из вывода Supabase CLI:\n${stdout.slice(0, 400)}`);
  }

  const parsed = JSON.parse(stdout.slice(start, end + 1));

  return Array.isArray(parsed.rows) ? parsed.rows : [];
}

/** Выполняет SQL-запрос в привязанном облачном проекте через Supabase CLI (stdin). */
function runLinkedSql(sql) {
  const result = spawnSync('npx supabase db query --linked -o json', {
    cwd: ROOT,
    input: sql,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 128 * 1024 * 1024,
  });

  if (result.status !== 0) {
    throw new Error(`Ошибка SQL-запроса через Supabase CLI:\n${result.stderr || result.stdout}`);
  }

  return parseCliQueryOutput(result.stdout);
}

/** Определяет `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` из окружения или CLI. */
function resolveCloudCredentials() {
  let url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  const envPath = join(ROOT, '.env');
  if (!url && existsSync(envPath)) {
    const rawEnv = readFileSync(envPath, 'utf8');
    const match = /^EXPO_PUBLIC_SUPABASE_URL=(.+)$/m.exec(rawEnv);
    if (match) url = match[1].trim();
  }

  const linkedPath = join(ROOT, 'supabase', '.temp', 'linked-project.json');
  let projectRef = '';
  if (existsSync(linkedPath)) {
    const linked = JSON.parse(readFileSync(linkedPath, 'utf8'));
    projectRef = linked.ref ?? '';
    if (!url && projectRef) {
      url = `https://${projectRef}.supabase.co`;
    }
  }

  if (!serviceKey && projectRef) {
    const res = spawnSync(`npx supabase projects api-keys --project-ref ${projectRef} -o json`, {
      cwd: ROOT,
      encoding: 'utf8',
      shell: true,
    });

    if (res.status === 0) {
      const start = res.stdout.indexOf('[');
      const end = res.stdout.lastIndexOf(']');
      if (start !== -1 && end !== -1) {
        const keys = JSON.parse(res.stdout.slice(start, end + 1));
        const sr = keys.find((k) => k.name === 'service_role' && typeof k.api_key === 'string');
        if (sr) serviceKey = sr.api_key;
      }
    }
  }

  if (!url || !serviceKey) {
    throw new Error(
      'Не удалось определить SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY. ' +
        'Передайте их переменными окружения или выполните `npx supabase login` и `npx supabase link`.',
    );
  }

  return { url: url.replace(/\/+$/, ''), serviceKey, projectRef };
}

/** Список всех экспортируемых таблиц (`auth.users`, `auth.identities` и все таблицы `public`). */
function fetchSchemaMetadata() {
  const columnsSql = `
    select
      n.nspname as schema,
      c.relname as table,
      c.relkind as relkind,
      a.attname as column_name,
      a.attnum as attnum,
      pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
      a.attgenerated as generated
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    where a.attnum > 0
      and not a.attisdropped
      and (
        (n.nspname = 'public' and c.relkind in ('r', 'p'))
        or (n.nspname = 'auth' and c.relname in ('users', 'identities'))
      )
    order by
      case when n.nspname = 'auth' then 0 else 1 end,
      c.relname,
      a.attnum;
  `;

  const pkSql = `
    select
      n.nspname as schema,
      c.relname as table,
      coalesce(array_agg(a.attname order by array_position(i.indkey, a.attnum)), array[]::text[]) as pk_cols
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_index i on i.indrelid = c.oid and i.indisprimary
    left join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
    where (n.nspname = 'public' and c.relkind in ('r', 'p'))
       or (n.nspname = 'auth' and c.relname in ('users', 'identities'))
    group by 1, 2;
  `;

  const colRows = runLinkedSql(columnsSql);
  const pkRows = runLinkedSql(pkSql);

  const pkMap = new Map();
  for (const row of pkRows) {
    const cols = Array.isArray(row.pk_cols)
      ? row.pk_cols
      : typeof row.pk_cols === 'string'
        ? row.pk_cols.replace(/^\{|\}$/g, '').split(',').filter(Boolean)
        : [];
    pkMap.set(`${row.schema}.${row.table}`, cols);
  }

  const tablesMap = new Map();
  for (const row of colRows) {
    const key = `${row.schema}.${row.table}`;
    if (!tablesMap.has(key)) {
      tablesMap.set(key, {
        schema: row.schema,
        table: row.table,
        relkind: row.relkind,
        primaryKey: pkMap.get(key) ?? [],
        columns: [],
      });
    }
    tablesMap.get(key).columns.push({
      name: row.column_name,
      dataType: row.data_type,
      generated: row.generated || '',
    });
  }

  // В auth сначала родительская таблица users, затем identities
  const list = [...tablesMap.values()];
  list.sort((a, b) => {
    if (a.schema !== b.schema) return a.schema === 'auth' ? -1 : 1;
    if (a.schema === 'auth') {
      if (a.table === 'users') return -1;
      if (b.table === 'users') return 1;
    }
    return a.table.localeCompare(b.table);
  });

  return list;
}

/** Считает точное число строк во всех целевых таблицах одним запросом. */
function fetchAllTableCounts(tablesMeta) {
  const unions = tablesMeta.map(
    (m) => `select '${m.schema}.${m.table}' as key, count(*)::int as cnt from "${m.schema}"."${m.table}"`,
  );
  const rows = runLinkedSql(`${unions.join('\nunion all\n')};`);
  const counts = new Map();

  for (const row of rows) {
    counts.set(row.key, Number(row.cnt ?? 0));
  }

  return counts;
}

/** Выгружает непустые таблицы пачками через один SQL-запрос с JSON-снимками. */
function exportNonEmptyTables(tablesMeta, countsMap) {
  const nonEmpty = tablesMeta.filter((m) => (countsMap.get(`${m.schema}.${m.table}`) ?? 0) > 0);
  const resultByKey = new Map();

  for (const m of tablesMeta) {
    resultByKey.set(`${m.schema}.${m.table}`, []);
  }

  // Выгружаем небольшими группами таблиц за один CLI-вызов, чтобы не упереться в лимит ответа
  const GROUP_SIZE = 12;
  for (let i = 0; i < nonEmpty.length; i += GROUP_SIZE) {
    const group = nonEmpty.slice(i, i + GROUP_SIZE);
    const queries = group.map((meta) => {
      const { schema, table, primaryKey, columns } = meta;
      const selectExprs = columns.map((col) =>
        col.dataType === 'bytea' ? `encode("${col.name}", 'hex') as "${col.name}"` : `"${col.name}"`,
      );
      const orderCols =
        primaryKey.length > 0 ? primaryKey.map((c) => `"${c}"`).join(', ') : `"${columns[0].name}"`;

      return `select '${schema}.${table}' as key, coalesce((select json_agg(t) from (select ${selectExprs.join(', ')} from "${schema}"."${table}" order by ${orderCols}) t), '[]'::json) as rows`;
    });

    const batchRows = runLinkedSql(`${queries.join('\nunion all\n')};`);
    for (const r of batchRows) {
      const parsedRows = Array.isArray(r.rows) ? r.rows : typeof r.rows === 'string' ? JSON.parse(r.rows) : [];
      resultByKey.set(r.key, parsedRows);
    }
  }

  return resultByKey;
}

/** Выгружает текущие значения последовательностей и партиции rec_parts. */
function exportSequencesAndPartitions() {
  const sequences = runLinkedSql(`
    select
      schemaname as schema,
      sequencename as name,
      last_value,
      (last_value is not null) as is_called
    from pg_sequences
    where schemaname in ('public', 'pgmq')
    order by 1, 2;
  `);

  const partitions = runLinkedSql(`
    select
      c.relname as partition_name,
      pg_get_expr(c.relpartbound, c.oid) as bound_expr
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    join pg_namespace n on n.oid = c.relnamespace
    where i.inhparent = 'public.rec_events'::regclass
      and n.nspname = 'rec_parts'
    order by c.relname;
  `);

  return { sequences, partitions };
}

/** Выгружает реестр бакетов и объектов Storage из БД. */
function exportStorageCatalog() {
  const buckets = runLinkedSql(`
    select id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at
    from storage.buckets
    where id in ('avatars', 'chat-media', 'media', 'uploads')
    order by id;
  `);

  const objects = runLinkedSql(`
    select
      id,
      bucket_id,
      name,
      owner,
      owner_id,
      created_at,
      updated_at,
      last_accessed_at,
      metadata,
      user_metadata,
      version
    from storage.objects
    where bucket_id in ('avatars', 'chat-media', 'media')
    order by bucket_id, name;
  `);

  return { buckets, objects };
}

/** Скачивает все объекты бакетов `avatars`, `chat-media`, `media` с проверкой размера. */
async function downloadStorageObjects(admin, objects) {
  const statsByBucket = Object.fromEntries(
    TARGET_BUCKETS.map((b) => [b, { expected: 0, downloaded: 0, reused: 0, bytes: 0 }]),
  );

  for (const obj of objects) {
    if (statsByBucket[obj.bucket_id]) {
      statsByBucket[obj.bucket_id].expected += 1;
    }
  }

  const CONCURRENCY = 6;
  let index = 0;
  const downloadedFiles = [];

  async function worker() {
    while (index < objects.length) {
      const current = objects[index];
      index += 1;

      const bucket = current.bucket_id;
      const objectPath = current.name;
      const expectedSize = Number(current.metadata?.size ?? current.metadata?.contentLength ?? -1);
      const targetFile = join(STORAGE_DIR, bucket, ...objectPath.split('/'));

      mkdirSync(dirname(targetFile), { recursive: true });

      if (existsSync(targetFile) && expectedSize >= 0) {
        const localStat = statSync(targetFile);
        if (localStat.size === expectedSize) {
          const bytes = readFileSync(targetFile);
          const sha256 = createHash('sha256').update(bytes).digest('hex');
          statsByBucket[bucket].downloaded += 1;
          statsByBucket[bucket].reused += 1;
          statsByBucket[bucket].bytes += localStat.size;
          downloadedFiles.push({
            bucket,
            path: objectPath,
            size: localStat.size,
            sha256,
            mimeType: current.metadata?.mimetype ?? 'application/octet-stream',
          });
          continue;
        }
      }

      const { data: blob, error } = await admin.storage.from(bucket).download(objectPath);

      if (error || !blob) {
        throw new Error(`Не удалось скачать ${bucket}/${objectPath}: ${error?.message ?? 'пустой ответ'}`);
      }

      const buffer = Buffer.from(await blob.arrayBuffer());

      if (expectedSize >= 0 && buffer.length !== expectedSize) {
        throw new Error(
          `Размер скачанного файла ${bucket}/${objectPath} (${buffer.length}) не совпадает с метаданными (${expectedSize})`,
        );
      }

      writeFileSync(targetFile, buffer);
      const sha256 = createHash('sha256').update(buffer).digest('hex');

      statsByBucket[bucket].downloaded += 1;
      statsByBucket[bucket].bytes += buffer.length;
      downloadedFiles.push({
        bucket,
        path: objectPath,
        size: buffer.length,
        sha256,
        mimeType: current.metadata?.mimetype ?? 'application/octet-stream',
      });
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  for (const bucket of TARGET_BUCKETS) {
    const st = statsByBucket[bucket];
    if (st.downloaded !== st.expected) {
      throw new Error(`Сверка бакета ${bucket} не сошлась: ожидалось ${st.expected}, скачано ${st.downloaded}`);
    }
  }

  downloadedFiles.sort((a, b) => `${a.bucket}/${a.path}`.localeCompare(`${b.bucket}/${b.path}`));

  return { statsByBucket, downloadedFiles };
}

async function main() {
  console.log('==> Подготовка полного локального бекапа облачного проекта Open...');
  const { url, serviceKey, projectRef } = resolveCloudCredentials();
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  mkdirSync(TABLES_DIR, { recursive: true });
  mkdirSync(STORAGE_DIR, { recursive: true });

  console.log(`==> [1/4] Чтение схемы таблиц из проекта ${projectRef || url}...`);
  const tablesMeta = fetchSchemaMetadata();
  console.log(`    Найдено таблиц для выгрузки: ${tablesMeta.length} (auth + public)`);

  console.log('==> [2/4] Выгрузка строк БД и сверка количества записей...');
  const countsMap = fetchAllTableCounts(tablesMeta);
  const rowsMap = exportNonEmptyTables(tablesMeta, countsMap);
  const tableSummaries = [];
  let totalRows = 0;

  for (const meta of tablesMeta) {
    const key = `${meta.schema}.${meta.table}`;
    const expectedCount = countsMap.get(key) ?? 0;
    const rows = rowsMap.get(key) ?? [];

    if (rows.length !== expectedCount) {
      throw new Error(
        `Несовпадение числа строк при экспорте ${key}: в БД ${expectedCount}, выгружено ${rows.length}`,
      );
    }

    const fileName = `${meta.schema}.${meta.table}.json`;
    const filePath = join(TABLES_DIR, fileName);

    writeFileSync(
      filePath,
      JSON.stringify(
        {
          schema: meta.schema,
          table: meta.table,
          relkind: meta.relkind,
          primaryKey: meta.primaryKey,
          columns: meta.columns,
          rowCount: rows.length,
          rows,
        },
        null,
        2,
      ),
      'utf8',
    );

    totalRows += rows.length;
    tableSummaries.push({
      schema: meta.schema,
      table: meta.table,
      expectedCount,
      exportedCount: rows.length,
      file: `tables/${fileName}`,
    });

    if (rows.length > 0) {
      console.log(`    ✓ ${meta.schema}.${meta.table}: ${rows.length} строк`);
    }
  }

  console.log('==> [3/4] Выгрузка последовательностей, партиций и каталога Storage...');
  const { sequences, partitions } = exportSequencesAndPartitions();
  const { buckets, objects } = exportStorageCatalog();

  writeFileSync(
    join(BACKUP_DIR, 'storage-catalog.json'),
    JSON.stringify({ buckets, objects }, null, 2),
    'utf8',
  );

  console.log(`==> [4/4] Скачивание медиафайлов из бакетов (${TARGET_BUCKETS.join(', ')})...`);
  const { statsByBucket, downloadedFiles } = await downloadStorageObjects(admin, objects);

  const totalFiles = Object.values(statsByBucket).reduce((acc, s) => acc + s.downloaded, 0);
  const totalBytes = Object.values(statsByBucket).reduce((acc, s) => acc + s.bytes, 0);

  const manifest = {
    createdAt: new Date().toISOString(),
    sourceUrl: url,
    projectRef: projectRef || null,
    Verification: {
      tablesMatched: tableSummaries.every((t) => t.expectedCount === t.exportedCount),
      filesMatched: Object.values(statsByBucket).every((b) => b.expected === b.downloaded),
      totalTables: tableSummaries.length,
      totalRows,
      totalFiles,
      totalBytes,
    },
    counts: {
      users: tableSummaries.find((t) => t.schema === 'auth' && t.table === 'users')?.exportedCount ?? 0,
      identities: tableSummaries.find((t) => t.schema === 'auth' && t.table === 'identities')?.exportedCount ?? 0,
      profiles: tableSummaries.find((t) => t.schema === 'public' && t.table === 'profiles')?.exportedCount ?? 0,
      channels: tableSummaries.find((t) => t.schema === 'public' && t.table === 'channels')?.exportedCount ?? 0,
      chats: tableSummaries.find((t) => t.schema === 'public' && t.table === 'chats')?.exportedCount ?? 0,
      messages: tableSummaries.find((t) => t.schema === 'public' && t.table === 'messages')?.exportedCount ?? 0,
      comments: tableSummaries.find((t) => t.schema === 'public' && t.table === 'comments')?.exportedCount ?? 0,
      pops: tableSummaries.find((t) => t.schema === 'public' && t.table === 'pops')?.exportedCount ?? 0,
      savedMessages:
        tableSummaries.find((t) => t.schema === 'public' && t.table === 'saved_messages')?.exportedCount ?? 0,
      mediaObjects:
        tableSummaries.find((t) => t.schema === 'public' && t.table === 'media_objects')?.exportedCount ?? 0,
      storageObjects: objects.length,
    },
    storageByBucket: statsByBucket,
    sequences,
    partitions,
    tables: tableSummaries,
    files: downloadedFiles,
  };

  writeFileSync(join(BACKUP_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const mb = (totalBytes / (1024 * 1024)).toFixed(2);
  console.log('\n=============================================================================');
  console.log('Бекап успешно сохранён в .backup/ и прошёл сверку:');
  console.log(`  Аккаунты (auth.users / profiles): ${manifest.counts.users} / ${manifest.counts.profiles}`);
  console.log(`  Идентичности OAuth (identities):  ${manifest.counts.identities}`);
  console.log(`  Чаты и каналы:                    ${manifest.counts.chats} чатов, ${manifest.counts.channels} каналов`);
  console.log(`  Сообщения / комментарии / попсы:  ${manifest.counts.messages} / ${manifest.counts.comments} / ${manifest.counts.pops}`);
  console.log(`  Сохранённые (saved_messages):     ${manifest.counts.savedMessages}`);
  console.log(`  Реестр media_objects:             ${manifest.counts.mediaObjects}`);
  console.log(`  Всего строк во всех ${manifest.Verification.totalTables} таблицах:  ${totalRows}`);
  console.log(`  Файлы Storage (${totalFiles} шт., ${mb} МБ):`);
  for (const bucket of TARGET_BUCKETS) {
    const b = statsByBucket[bucket];
    console.log(
      `    - ${bucket}: ${b.downloaded}/${b.expected} файлов (${(b.bytes / (1024 * 1024)).toFixed(2)} МБ)`,
    );
  }
  console.log('=============================================================================');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
