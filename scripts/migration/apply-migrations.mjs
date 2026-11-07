// Применяет все SQL-миграции проекта к self-hosted Postgres в лексическом порядке.
// Каждая миграция и её запись в supabase_migrations.schema_migrations атомарны.

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSql } from './psql-transport.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const MIGRATION_PATTERN = /^(\d{14})_(.+)\.sql$/;

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function buildMigrationBatch(files) {
  const lines = [
    '\\set QUIET 1',
    'SELECT CASE WHEN (',
    "  current_setting('server_version_num')::integer >= 170000",
    "  AND to_regclass('auth.users') IS NOT NULL",
    "  AND to_regclass('auth.identities') IS NOT NULL",
    "  AND to_regclass('storage.objects') IS NOT NULL",
    "  AND to_regclass('storage.buckets') IS NOT NULL",
    "  AND to_regclass('realtime.messages') IS NOT NULL",
    "  AND to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL",
    "  AND to_regprocedure('realtime.topic()') IS NOT NULL",
    ") THEN 'true' ELSE 'false' END AS prerequisites_ready \\gset",
    '\\if :prerequisites_ready',
    '\\else',
    '\\echo ERROR: PostgreSQL 17 and initialized auth, storage, realtime.messages, realtime.send, realtime.topic() are required.',
    '\\quit 3',
    '\\endif',
    'CREATE SCHEMA IF NOT EXISTS supabase_migrations;',
    `CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
      version text PRIMARY KEY,
      statements text[],
      name text
    );`,
    'GRANT USAGE ON SCHEMA supabase_migrations TO supabase_admin;',
    "SELECT pg_advisory_lock(hashtext('open-schema-migrations'));",
  ];

  files.forEach((file, index) => {
    const [, version, name] = MIGRATION_PATTERN.exec(file);
    const migrationSql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const progress = `[${index + 1}/${files.length}] ${file}`;
    lines.push(
      `SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = ${sqlString(version)}) THEN 'true' ELSE 'false' END AS apply_migration \\gset`,
      '\\if :apply_migration',
      `\\echo APPLY ${progress}`,
      'BEGIN;',
      "SELECT pg_advisory_xact_lock(hashtext('open-schema-migrations'));",
      migrationSql,
      `INSERT INTO supabase_migrations.schema_migrations(version, statements, name) VALUES (${sqlString(version)}, ARRAY[${sqlString(migrationSql)}], ${sqlString(name)});`,
      'COMMIT;',
      '\\else',
      `\\echo SKIP ${progress} (already registered)`,
      '\\endif',
    );
  });

  lines.push(
    'GRANT USAGE ON SCHEMA pgmq TO postgres;',
    'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA pgmq TO postgres;',
    'GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA pgmq TO postgres;',
    'ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq GRANT ALL PRIVILEGES ON TABLES TO postgres;',
    'ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq GRANT ALL PRIVILEGES ON SEQUENCES TO postgres;',
    "NOTIFY pgrst, 'reload schema';",
    "SELECT pg_advisory_unlock(hashtext('open-schema-migrations'));",
    '\\echo PostgREST schema cache reload requested.',
  );
  return lines.join('\n');
}

function main() {
  const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).sort();
  if (!files.length) throw new Error(`В ${MIGRATIONS_DIR} не найдены SQL-миграции.`);

  const versions = new Set();
  for (const file of files) {
    const match = MIGRATION_PATTERN.exec(file);
    if (!match) throw new Error(`Имя миграции не соответствует формату timestamp_name.sql: ${file}`);
    if (versions.has(match[1])) throw new Error(`Повторяется версия миграции ${match[1]}.`);
    versions.add(match[1]);
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(sql)) {
      throw new Error(`${file} содержит управление транзакцией; миграции должны быть атомарными через apply-migrations.mjs.`);
    }
  }

  if (process.argv.includes('--check-only')) {
    console.log(`Проверено ${files.length} SQL-миграций; порядок: ${files[0]} … ${files.at(-1)}.`);
    return;
  }

  runSql(buildMigrationBatch(files));
  console.log(`Миграционный batch из ${files.length} файлов обработан; каждая версия проверена в supabase_migrations.schema_migrations.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
