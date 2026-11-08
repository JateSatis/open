// Read-only fixture checks and atomic cleanup through the existing self-hosted SQL transport.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runSql } from './migration/psql-transport.mjs';
import { ROOT } from './dev-runtime.mjs';

const literal = (value) => "'" + value.replace(/'/g, "''") + "'";

export function fixtureRequirements(flows, extra = []) {
  const overrides = Object.fromEntries(
    extra
      .filter((_, i) => i % 2 === 1)
      .map((value) => {
        const split = value.indexOf('=');
        if (split <= 0) throw new Error('Maestro -e требует KEY=VALUE.');
        return [value.slice(0, split), value.slice(split + 1)];
      }),
  );
  const requirements = new Map();
  for (const flow of flows) {
    const head = readFileSync(flow.file, 'utf8').replace(/\r\n/g, '\n').split(/^---$/m)[0];
    for (const [, key, raw] of head.matchAll(
      /^  (CHAT|CHANNEL|CHAT_ID|CHANNEL_ID|FRAGMENT_CHAT_LINK|COMMENT_THREAD_CHAT_LINK):\s*(.+)$/gm,
    )) {
      let value = overrides[key] ?? raw.trim();
      if (value.startsWith('"')) value = JSON.parse(value);
      else if (value.startsWith("'")) value = value.slice(1, -1).replace(/''/g, "'");
      if (value.includes('${'))
        throw new Error(
          `${flow.id}: динамическая предпосылка ${key}; передай конкретное -e ${key}=...`,
        );
      const table = key.startsWith('CHANNEL') ? 'channels' : 'chats';
      const byId = key.endsWith('_ID') || key.endsWith('_LINK');
      if (key.endsWith('_LINK')) value = value.match(/^openger:\/\/chats\/([a-f0-9-]{36})$/i)?.[1];
      if (!value || (byId && !/^[a-f0-9-]{36}$/i.test(value)))
        throw new Error(`${flow.id}: некорректная предпосылка ${key}`);
      requirements.set(`${table}:${byId ? 'id' : 'title'}:${value}`, {
        table,
        column: byId ? 'id' : 'title',
        value,
      });
    }
  }
  return [...requirements.values()];
}

export function fixtureSql(requirements) {
  return (
    'BEGIN READ ONLY;\n' +
    requirements
      .map(({ table, column, value }, index) => {
        if (!['chats', 'channels'].includes(table) || !['id', 'title'].includes(column))
          throw new Error('Неизвестный тип предпосылки.');
        return `select 'fixture:${index}', exists(select 1 from public.${table} where ${column} = ${literal(value)} and deleted_at is null);`;
      })
      .join('\n') +
    '\nROLLBACK;'
  );
}

export function checkFixtures(flows, extra, executeSql = runSql) {
  const requirements = fixtureRequirements(flows, extra);
  if (!requirements.length)
    return { count: 0, scope: 'у выбранных сценариев нет деклараций CHAT/CHANNEL' };
  const output = executeSql(fixtureSql(requirements), { capture: true, timeout: 30000 });
  const missing = requirements.filter(
    (_, index) => !output.split(/\r?\n/).includes(`fixture:${index}|t`),
  );
  if (missing.length)
    throw new Error(
      `Нет тестовых данных: ${missing.map((item) => `${item.table}.${item.column}=${item.value}`).join(', ')}. Сценарии не запускались.`,
    );
  return {
    count: requirements.length,
    scope: 'наличие CHAT/CHANNEL; доступ текущего аккаунта проверяет сценарий',
  };
}

export function cleanupFixtures(executeSql = runSql) {
  const sql = readFileSync(join(ROOT, 'scripts/e2e-reset.sql'), 'utf8');
  // All statements, including post-DO cleanup, commit or roll back together.
  const output = executeSql(`BEGIN;\nSET LOCAL statement_timeout = '90s';\n${sql}\nCOMMIT;`, {
    capture: true,
    timeout: 120000,
  });
  if (!output.split(/\r?\n/).includes('0|0'))
    throw new Error(
      'Уборка закончилась без подтверждения нулевого остатка тестовых сообщений/комментариев.',
    );
}

export function shouldStopRun(result, previousFailure) {
  return (
    !result.ok &&
    (result.infrastructureFailure ||
      /не дошёл до отчёта|device.*offline|no connected|unable to connect|failed to initialize/i.test(
        result.failure ?? '',
      ) ||
      (Boolean(result.failure) && result.failure === previousFailure))
  );
}
