import { spawnSync } from 'node:child_process';

/** Executes SQL locally through psql or on the VPS through SSH and its open-db container. */
export function runSql(sql, { capture = false, timeout } = {}) {
  const databaseUrl = process.env.TARGET_DB_URL;
  const sshHost = process.env.TARGET_SSH_HOST;
  if (databaseUrl && sshHost)
    throw new Error('Задайте только одно: TARGET_DB_URL или TARGET_SSH_HOST.');

  let command;
  let args;
  if (databaseUrl) {
    command = 'psql';
    args = [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1'];
  } else if (sshHost) {
    if (!/^[A-Za-z0-9_.@:-]+$/.test(sshHost))
      throw new Error('TARGET_SSH_HOST содержит недопустимые символы.');
    command = 'ssh';
    const outputFlags = capture ? ' -At -F "|"' : '';
    args = [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      sshHost,
      `docker exec -i open-db psql -U supabase_admin -d postgres -X -v ON_ERROR_STOP=1${outputFlags}`,
    ];
  } else {
    throw new Error('Задайте TARGET_DB_URL или TARGET_SSH_HOST=root@<API_DOMAIN>.');
  }

  if (capture && databaseUrl) args.push('-At', '-F', '|');
  const result = spawnSync(command, args, {
    input: sql,
    encoding: 'utf8',
    stdio: capture ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit'],
    windowsHide: true,
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) {
    const diagnostic = [result.stderr?.trim(), result.stdout?.trim()].filter(Boolean).join('\n');
    throw new Error(
      diagnostic
        ? `${result.error.message}\n${diagnostic}`
        : `Не удалось запустить ${command}: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    const diagnostic = [result.stderr?.trim(), result.stdout?.trim()].filter(Boolean).join('\n');
    throw new Error(
      capture
        ? diagnostic || `${command} завершился с кодом ${result.status}`
        : `SQL завершился с ошибкой через ${command}.`,
    );
  }
  return capture ? result.stdout.trim() : '';
}
