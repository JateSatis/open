// Импорт локального бекапа `.backup/` (созданного `export-cloud.mjs`) в новый
// self-hosted сервер Open (Supabase + LiveKit + Caddy).
//
// Что делает скрипт:
//   1. Собирает идемпотентный SQL-дамп всех таблиц (`auth.users`, `auth.identities`
//      и всех таблиц `public`) в режиме `session_replication_role = 'replica'`,
//      чтобы при переносе не срабатывали триггеры (`handle_new_user`, счётчики,
//      проверки ссылок до окончания загрузки всех таблиц).
//   2. Заменяет старый облачный домен `https://<ref>.supabase.co` на новый
//      `TARGET_SUPABASE_URL` в публичных ссылках бакета `media`:
//        - `pops.url`, `pops.poster_url`
//        - `channels.avatar_url`
//        - `chats.avatar_url`
//        - `saved_message_attachments.url`, `saved_message_attachments.poster_url`
//   3. Восстанавливает партиции `rec_parts` и текущие значения последовательностей
//      (`messages_seq_seq`, `saved_messages_seq_seq`).
//   4. Применяет SQL к целевой БД (через `psql "$TARGET_DB_URL"` или `docker compose exec -T db psql`)
//      либо сохраняет готовый файл `.backup/import.sql` при запуске с `--sql-only`.
//   5. Загружает все сохранённые медиафайлы из `.backup/storage/<bucket>/<path>`
//      в Storage нового сервера через `TARGET_SUPABASE_URL` + `TARGET_SERVICE_ROLE_KEY`.
//
// Запуск:
//   TARGET_SUPABASE_URL=https://api.openger.com \
//   TARGET_SERVICE_ROLE_KEY=… \
//   TARGET_DB_URL=postgresql://supabase_admin:…@localhost:5432/postgres \
//   # или TARGET_SSH_HOST=root@api.openger.com для SSH к контейнеру open-db
//   node scripts/migration/import-selfhosted.mjs
//
//   # Только собрать и проверить SQL без подключения к серверу:
//   TARGET_SUPABASE_URL=https://api.openger.com node scripts/migration/import-selfhosted.mjs --sql-only

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSql } from './psql-transport.mjs';

import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const BACKUP_DIR = resolve(ROOT, process.env.BACKUP_DIR ?? '.backup');
const TABLES_DIR = join(BACKUP_DIR, 'tables');
const STORAGE_DIR = join(BACKUP_DIR, 'storage');

/**
 * Колонки таблиц, в которых хранятся публичные URL бакета `media` со старым
 * доменом `*.supabase.co`.
 */
export const PUBLIC_MEDIA_URL_COLUMNS = {
  'public.pops': ['url', 'poster_url'],
  'public.channels': ['avatar_url'],
  'public.chats': ['avatar_url'],
  'public.saved_message_attachments': ['url', 'poster_url'],
};

const IDENTITY_ALWAYS_COLUMNS = {
  'public.messages': ['seq'],
  'public.saved_messages': ['seq'],
};

const PUBLIC_MEDIA_REGEX = /^https?:\/\/[a-z0-9-]+\.supabase\.co(\/storage\/v1\/object\/public\/media\/.+)$/i;

/**
 * Заменяет старый облачный домен `*.supabase.co` на `targetBaseUrl` в публичной
 * ссылке бакета `media`. Относительные пути (`chat-media`, `avatars`) и чужие
 * внешние ссылки (например, `lh3.googleusercontent.com`) не меняет.
 */
export function rewritePublicMediaUrl(value, targetBaseUrl) {
  if (typeof value !== 'string' || !value) return value;

  const normalizedTarget = targetBaseUrl.replace(/\/+$/, '');
  const match = PUBLIC_MEDIA_REGEX.exec(value);

  if (!match) return value;

  return `${normalizedTarget}${match[1]}`;
}

/** Применяет замену домена к строке таблицы, если у таблицы есть публичные URL-колонки. */
export function transformTableRow(schema, table, row, targetBaseUrl) {
  const key = `${schema}.${table}`;
  const urlCols = PUBLIC_MEDIA_URL_COLUMNS[key];

  if (!urlCols) return { row, rewritten: 0 };

  let rewritten = 0;
  const copy = { ...row };

  for (const col of urlCols) {
    if (typeof copy[col] === 'string') {
      const next = rewritePublicMediaUrl(copy[col], targetBaseUrl);
      if (next !== copy[col]) {
        copy[col] = next;
        rewritten += 1;
      }
    }
  }

  return { row: copy, rewritten };
}

/** Проверяет резервные файлы по манифесту до записи любых данных на целевой сервер. */
export function verifyBackupFiles(backupDir, manifest) {
  const files = manifest.files ?? [];
  if (manifest.Verification?.totalFiles !== files.length) {
    throw new Error(`В манифесте ${files.length} файлов, ожидалось ${manifest.Verification?.totalFiles ?? 'неизвестно'}.`);
  }

  for (const item of files) {
    const localFile = join(backupDir, 'storage', item.bucket, ...item.path.split('/'));
    if (!existsSync(localFile)) throw new Error(`Отсутствует локальный файл бекапа: ${localFile}`);
    const bytes = readFileSync(localFile);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== item.size || sha256 !== item.sha256) {
      throw new Error(`Файл бекапа не совпадает с манифестом: ${item.bucket}/${item.path}`);
    }
  }
  return files.length;
}

function escapeSqlString(str) {
  return `'${String(str).replace(/'/g, "''")}'`;
}

/** Преобразует JS-значение из JSON-дампа в SQL-литерал с учётом типа колонки Postgres. */
export function toSqlLiteral(value, dataType) {
  if (value === null || value === undefined) return 'NULL';

  if (dataType === 'bytea') {
    return `decode(${escapeSqlString(value)}, 'hex')`;
  }

  if (dataType === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }

  if (
    dataType === 'integer' ||
    dataType === 'bigint' ||
    dataType === 'smallint' ||
    dataType === 'double precision' ||
    dataType === 'real' ||
    dataType.startsWith('numeric')
  ) {
    const num = Number(value);
    return Number.isFinite(num) ? String(value) : escapeSqlString(value);
  }

  if (dataType === 'jsonb' || dataType === 'json') {
    const jsonStr = typeof value === 'string' ? value : JSON.stringify(value);
    return `${escapeSqlString(jsonStr)}::${dataType}`;
  }

  if (dataType.endsWith('[]')) {
    if (Array.isArray(value)) {
      const baseType = dataType.slice(0, -2);
      if (value.length === 0) return `'{}'::${dataType}`;
      const items = value.map((item) => toSqlLiteral(item, baseType));
      return `ARRAY[${items.join(', ')}]::${dataType}`;
    }
    return `${escapeSqlString(value)}::${dataType}`;
  }

  return `${escapeSqlString(value)}::${dataType}`;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

/** Формирует SQL-проверку количества строк и отсутствия старого домена. */
export function buildDatabaseVerificationSql(expectedTableRows) {
  const lines = ['DO $verify_import$', 'DECLARE actual bigint;', 'BEGIN'];
  for (const { schema, table, count } of expectedTableRows) {
    lines.push(
      `  SELECT count(*) INTO actual FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)};`,
      `  IF actual <> ${count} THEN RAISE EXCEPTION 'Импорт ${schema}.${table}: % строк, ожидалось ${count}', actual; END IF;`,
    );
  }

  const oldDomain = 'cxgkiwxgwxiybazyvcgi.supabase.co';
  for (const [qualifiedTable, columns] of Object.entries(PUBLIC_MEDIA_URL_COLUMNS)) {
    const [schema, table] = qualifiedTable.split('.');
    for (const column of columns) {
      lines.push(
        `  IF EXISTS (SELECT 1 FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)} WHERE strpos(${quoteIdentifier(column)}, ${escapeSqlString(oldDomain)}) > 0) THEN`,
        `    RAISE EXCEPTION 'Старый домен остался в ${schema}.${table}.${column}';`,
        '  END IF;',
      );
    }
  }
  lines.push('END;', '$verify_import$;');
  return lines.join('\n');
}

/** Формирует точную сверку путей и количеств Storage объектов с манифестом. */
export function buildStorageVerificationSql(manifest) {
  const files = manifest.files ?? [];
  const bucketCounts = new Map();
  for (const file of files) bucketCounts.set(file.bucket, (bucketCounts.get(file.bucket) ?? 0) + 1);
  const expectedRows = files.map((file) => `    (${escapeSqlString(file.bucket)}, ${escapeSqlString(file.path)})`).join(',\n');
  const lines = ['DO $verify_storage$', 'DECLARE actual bigint; missing bigint;', 'BEGIN'];
  lines.push(
    '  SELECT count(*) INTO actual FROM storage.objects;',
    `  IF actual <> ${files.length} THEN RAISE EXCEPTION 'storage.objects: % записей, ожидалось ${files.length}', actual; END IF;`,
  );
  for (const [bucket, count] of bucketCounts) {
    lines.push(
      `  SELECT count(*) INTO actual FROM storage.objects WHERE bucket_id = ${escapeSqlString(bucket)};`,
      `  IF actual <> ${count} THEN RAISE EXCEPTION 'Storage bucket ${bucket}: % объектов, ожидалось ${count}', actual; END IF;`,
    );
  }
  lines.push(
    `  SELECT count(*) INTO missing FROM (VALUES\n${expectedRows}\n  ) AS expected(bucket_id, name)\n  LEFT JOIN storage.objects AS actual ON actual.bucket_id = expected.bucket_id AND actual.name = expected.name\n  WHERE actual.id IS NULL;`,
    "  IF missing <> 0 THEN RAISE EXCEPTION 'В storage.objects не хватает % файлов из манифеста', missing; END IF;",
    'END;',
    '$verify_storage$;',
  );
  return lines.join('\n');
}

/** Формирует полный SQL-скрипт импорта из `.backup/`. */
export function buildImportSql(backupDir, targetBaseUrl) {
  const manifestPath = join(backupDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Не найден манифест бекапа ${manifestPath}. Сначала выполните export-cloud.mjs.`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const lines = [
    '-- Автоматически сгенерированный дамп переноса Open в self-hosted Supabase',
    `-- Источник: ${manifest.sourceUrl} (${manifest.createdAt})`,
    `-- Целевой адрес: ${targetBaseUrl}`,
    'BEGIN;',
    "SET LOCAL session_replication_role = 'replica';",
    '',
  ];

  // 1. Партиции rec_parts для rec_events
  if (Array.isArray(manifest.partitions) && manifest.partitions.length > 0) {
    lines.push('-- Партиции rec_parts');
    lines.push('CREATE SCHEMA IF NOT EXISTS rec_parts;');
    for (const part of manifest.partitions) {
      const name = part.partition_name;
      const bound = part.bound_expr;
      lines.push(
        `DO $$ BEGIN IF to_regclass('rec_parts.${name}') IS NULL THEN ` +
          `CREATE TABLE rec_parts."${name}" PARTITION OF public.rec_events ${bound}; ` +
          `ALTER TABLE rec_parts."${name}" ENABLE ROW LEVEL SECURITY; ` +
          `REVOKE ALL ON rec_parts."${name}" FROM anon, authenticated; ` +
          `END IF; END $$;`,
      );
    }
    lines.push('');
  }

  let totalRewrittenUrls = 0;
  const expectedTableRows = [];

  // 2. Очистка целевых таблиц public перед заливкой (например, дефолтного секрета в identity_secret)
  const publicTables = manifest.tables.filter((t) => t.schema === 'public').map((t) => `public."${t.table}"`);
  if (publicTables.length > 0) {
    lines.push(`TRUNCATE TABLE ${publicTables.join(', ')} CASCADE;`);
    lines.push('');
  }

  // 3. Вставка строк во все таблицы
  for (const tableEntry of manifest.tables) {
    const tableDumpPath = join(backupDir, tableEntry.file);
    const dump = JSON.parse(readFileSync(tableDumpPath, 'utf8'));
    const { schema, table, primaryKey, columns, rows } = dump;
    expectedTableRows.push({ schema, table, count: rows?.length ?? 0 });

    if (!rows || rows.length === 0) continue;

    // Вычисляемые (GENERATED ALWAYS) колонки не вставляются
    const insertableColumns = columns.filter((col) => !col.generated);
    const colNamesSql = insertableColumns.map((col) => `"${col.name}"`).join(', ');

    const conflictClause =
      primaryKey && primaryKey.length > 0
        ? ` ON CONFLICT (${primaryKey.map((c) => `"${c}"`).join(', ')}) DO UPDATE SET ` +
          insertableColumns
            .filter((col) => !primaryKey.includes(col.name) && !IDENTITY_ALWAYS_COLUMNS[`${schema}.${table}`]?.includes(col.name))
            .map((col) => `"${col.name}" = EXCLUDED."${col.name}"`)
            .join(', ')
        : ' ON CONFLICT DO NOTHING';

    lines.push(`-- ${schema}.${table} (${rows.length} строк)`);

    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const valueTuples = slice.map((rawRow) => {
        const { row, rewritten } = transformTableRow(schema, table, rawRow, targetBaseUrl);
        totalRewrittenUrls += rewritten;
        const vals = insertableColumns.map((col) => toSqlLiteral(row[col.name], col.dataType));
        return `(${vals.join(', ')})`;
      });

      lines.push(
        `INSERT INTO "${schema}"."${table}" (${colNamesSql}) OVERRIDING SYSTEM VALUE VALUES\n  ${valueTuples.join(',\n  ')}${conflictClause};`,
      );
    }
    lines.push('');
  }

  // 4. Восстановление последовательностей
  if (Array.isArray(manifest.sequences)) {
    lines.push('-- Последовательности');
    for (const seq of manifest.sequences) {
      if (seq.last_value !== null && seq.last_value !== undefined) {
        const isCalled = seq.is_called ? 'true' : 'false';
        lines.push(`SELECT pg_catalog.setval('${seq.schema}."${seq.name}"', ${seq.last_value}, ${isCalled});`);
      }
    }
    lines.push('');
  }

  lines.push('-- Проверка количества строк и отсутствие старого домена.');
  lines.push(buildDatabaseVerificationSql(expectedTableRows));
  lines.push('COMMIT;');

  return { sql: lines.join('\n'), totalRewrittenUrls, manifest };
}

/** Применяет сгенерированный SQL через прямой URL, SSH или локальный Docker Compose. */
function executeTargetSql(sqlFilePath) {
  const targetDbUrl = process.env.TARGET_DB_URL;
  const targetSshHost = process.env.TARGET_SSH_HOST;
  const sql = readFileSync(sqlFilePath, 'utf8');

  if (targetDbUrl || targetSshHost) {
    runSql(sql);
    return;
  }

  const res = spawnSync(
    'docker',
    ['compose', '-f', 'infra/docker-compose.yml', 'exec', '-T', 'db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    {
      cwd: ROOT,
      input: sql,
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: true,
    },
  );

  if (res.status !== 0) {
    throw new Error(
      'Не удалось применить SQL ни через TARGET_DB_URL, ни через `docker compose -f infra/docker-compose.yml exec -T db psql`.',
    );
  }
}

/** Загружает сохранённые файлы из `.backup/storage/` в Storage нового сервера. */
async function uploadStorageFiles(targetUrl, targetServiceKey, manifest) {
  const admin = createClient(targetUrl, targetServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const catalogPath = join(BACKUP_DIR, 'storage-catalog.json');
  if (existsSync(catalogPath)) {
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    const { data: existingBuckets, error: listError } = await admin.storage.listBuckets();
    if (listError) throw new Error(`Не удалось прочитать список Storage buckets: ${listError.message}`);
    const bucketsById = new Map((existingBuckets ?? []).map((bucket) => [bucket.id, bucket]));

    for (const b of catalog.buckets ?? []) {
      const options = {
        public: Boolean(b.public),
        fileSizeLimit: b.file_size_limit ?? undefined,
        allowedMimeTypes: b.allowed_mime_types ?? undefined,
      };
      const existing = bucketsById.get(b.id);
      const result = existing
        ? await admin.storage.updateBucket(b.id, options)
        : await admin.storage.createBucket(b.id, options);
      if (result.error) {
        throw new Error(`Не удалось ${existing ? 'обновить' : 'создать'} Storage bucket ${b.id}: ${result.error.message}`);
      }
    }
  }

  const files = manifest.files ?? [];
  const CONCURRENCY = 3;
  let index = 0;
  let uploaded = 0;

  async function worker() {
    while (index < files.length) {
      const item = files[index];
      index += 1;

      const localFile = join(STORAGE_DIR, item.bucket, ...item.path.split('/'));
      if (!existsSync(localFile)) {
        throw new Error(`Отсутствует локальный файл бекапа: ${localFile}`);
      }

      const bytes = readFileSync(localFile);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (bytes.length !== item.size || sha256 !== item.sha256) {
        throw new Error(`Файл бекапа не совпадает с манифестом: ${item.bucket}/${item.path}`);
      }
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        let error;
        try {
          ({ error } = await admin.storage.from(item.bucket).upload(item.path, bytes, {
            contentType: item.mimeType || 'application/octet-stream',
            upsert: true,
            cacheControl: '31536000',
          }));
        } catch (cause) {
          error = cause;
        }

        if (!error) break;
        const retryable = error.message === 'fetch failed' || error.status === 429 || error.status >= 500;
        if (!retryable || attempt === 5) {
          throw new Error(`Ошибка загрузки ${item.bucket}/${item.path} после ${attempt} попыток: ${error.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
      }

      uploaded += 1;
      if (uploaded % 25 === 0 || uploaded === files.length) {
        console.log(`    Загружено файлов: ${uploaded}/${files.length}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  return uploaded;
}

async function main() {
  const sqlOnly = process.argv.includes('--sql-only');
  const targetUrl = (process.env.TARGET_SUPABASE_URL ?? process.env.SUPABASE_PUBLIC_URL ?? '').replace(/\/+$/, '');
  const targetServiceKey = process.env.TARGET_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? '';

  if (!targetUrl) {
    console.error('Укажите TARGET_SUPABASE_URL (например, https://api.openger.com)');
    process.exit(1);
  }

  console.log(`==> Сборка SQL-дампа из ${BACKUP_DIR} с заменой публичных ссылок на ${targetUrl}...`);
  const { sql, totalRewrittenUrls, manifest } = buildImportSql(BACKUP_DIR, targetUrl);
  if (!manifest.Verification?.tablesMatched || !manifest.Verification?.filesMatched) {
    throw new Error('Манифест сообщает о расхождении таблиц или файлов. Импорт остановлен до подключения к VPS.');
  }
  console.log(`==> Проверка ${verifyBackupFiles(BACKUP_DIR, manifest)} файлов по размеру и SHA-256...`);
  const sqlOutPath = join(BACKUP_DIR, 'import.sql');
  writeFileSync(sqlOutPath, sql, 'utf8');

  console.log(`    ✓ Сформирован ${sqlOutPath} (переписано публичных ссылок media: ${totalRewrittenUrls})`);

  if (sqlOnly) {
    console.log('==> Режим --sql-only: подключение к серверу пропущено.');
    return;
  }

  if (!targetServiceKey) {
    console.error('Для загрузки данных и медиафайлов укажите TARGET_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  console.log('==> [1/2] Импорт таблиц БД...');
  executeTargetSql(sqlOutPath);

  console.log('==> [2/2] Загрузка медиафайлов в Storage нового сервера...');
  const uploaded = await uploadStorageFiles(targetUrl, targetServiceKey, manifest);
  const storageVerificationPath = join(BACKUP_DIR, 'verify-storage.sql');
  writeFileSync(storageVerificationPath, `${buildStorageVerificationSql(manifest)}\n`, 'utf8');
  executeTargetSql(storageVerificationPath);

  console.log(
    `==> Импорт завершён: восстановлено таблиц — ${manifest.Verification.totalTables}, ` +
      `переписано ссылок — ${totalRewrittenUrls}, загружено файлов — ${uploaded}; Storage совпадает с манифестом.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
