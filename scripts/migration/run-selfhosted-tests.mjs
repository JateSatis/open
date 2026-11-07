// Запускает каждый supabase/tests/*.sql отдельным psql-сеансом.
// Тестовые файлы обязаны сами завершаться ROLLBACK, чтобы данные не сохранялись.

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSql } from './psql-transport.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const TESTS_DIR = join(ROOT, 'supabase', 'tests');

function withoutLeadingComments(sql) {
  return sql.replace(/^(?:\s*--[^\r\n]*(?:\r?\n|$))*/, '').trimStart();
}

function main() {
  const files = readdirSync(TESTS_DIR).filter((file) => file.endsWith('.sql')).sort((a, b) => a.localeCompare(b, 'en'));
  if (!files.length) throw new Error(`В ${TESTS_DIR} не найдены SQL-тесты.`);

  for (const file of files) {
    const sql = readFileSync(join(TESTS_DIR, file), 'utf8');
    const normalized = withoutLeadingComments(sql);
    const explicitTransaction = /^BEGIN\s*;/i.test(normalized) && /ROLLBACK\s*;\s*$/i.test(sql);
    const queryOnly = !explicitTransaction && /^(WITH|SELECT)\b/i.test(normalized) &&
      !/\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|CALL|DO)\b/i.test(sql.replace(/--[^\r\n]*/g, ''));
    if ((!explicitTransaction && !queryOnly) || /\bCOMMIT\s*;/i.test(sql)) {
      throw new Error(`${file} должен выполнять проверки между BEGIN и финальным ROLLBACK без COMMIT.`);
    }
  }

  if (process.argv.includes('--check-only')) {
    console.log(`Проверены границы транзакций у ${files.length} SQL-тестов.`);
    return;
  }

  const batch = ['\\set QUIET 1'];
  for (const file of files) {
    const sql = readFileSync(join(TESTS_DIR, file), 'utf8');
    const explicitTransaction = /^BEGIN\s*;/i.test(withoutLeadingComments(sql));
    batch.push(`\\echo TEST ${file}`);
    batch.push(explicitTransaction ? sql : `BEGIN;\n${sql}\nROLLBACK;`);
  }

  const output = runSql(batch.join('\n\n'), { capture: true });
  const lines = output.split(/\r?\n/);
  const failingLine = lines.findIndex((line) => line.split('|')[1] === 'f');
  if (failingLine >= 0) {
    const testName = lines.slice(0, failingLine).reverse().find((line) => line.startsWith('TEST '))?.slice(5);
    throw new Error(`SQL-тест ${testName ?? '(не определён)'} вернул проверку со значением false.`);
  }
  for (const [index, file] of files.entries()) console.log(`[${index + 1}/${files.length}] PASS ${file}`);
  console.log(`Готово: ${files.length} SQL-тестов пройдены; каждый завершился ROLLBACK.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
