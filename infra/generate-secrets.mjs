// Генератор секретов для облегчённого Self-hosted комплекта Open (`infra/`).
//
// Создаёт криптографически стойкие:
//   - POSTGRES_PASSWORD
//   - JWT_SECRET (не менее 32 байт)
//   - ANON_KEY и SERVICE_ROLE_KEY (валидные HS256 JWT сроком на 10 лет)
//   - SECRET_KEY_BASE (для контейнера Realtime)
//   - LIVEKIT_API_KEY и LIVEKIT_API_SECRET
//   - FRAGMENT_CLUSTERS_SECRET (для pg_cron -> Edge Function fragment-clusters)
//
// Запуск:
//   node infra/generate-secrets.mjs            # печать в stdout
//   node infra/generate-secrets.mjs --write    # запись в infra/.env и обновление infra/livekit.yaml

import { Buffer } from 'node:buffer';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function base64UrlEncode(input) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;

  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Подписывает HS256 JWT для Supabase (anon / service_role). */
export function signSupabaseJwt(role, jwtSecret, nowSec = Math.floor(Date.now() / 1000)) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const tenYearsSec = 10 * 365 * 24 * 60 * 60;
  const payload = {
    role,
    iss: 'supabase',
    iat: nowSec,
    exp: nowSec + tenYearsSec,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', jwtSecret).update(signingInput).digest();

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

export function generateSecrets() {
  const postgresPassword = randomBytes(24).toString('hex');
  const jwtSecret = randomBytes(32).toString('hex');
  const anonKey = signSupabaseJwt('anon', jwtSecret);
  const serviceRoleKey = signSupabaseJwt('service_role', jwtSecret);
  const secretKeyBase = randomBytes(48).toString('base64url');
  const livekitApiKey = `API${randomBytes(6).toString('hex')}`;
  const livekitApiSecret = randomBytes(24).toString('base64url');
  const fragmentClustersSecret = randomBytes(24).toString('hex');

  return {
    POSTGRES_PASSWORD: postgresPassword,
    JWT_SECRET: jwtSecret,
    ANON_KEY: anonKey,
    SERVICE_ROLE_KEY: serviceRoleKey,
    SECRET_KEY_BASE: secretKeyBase,
    LIVEKIT_API_KEY: livekitApiKey,
    LIVEKIT_API_SECRET: livekitApiSecret,
    FRAGMENT_CLUSTERS_SECRET: fragmentClustersSecret,
  };
}

function applyEnvTemplate(template, secrets) {
  let output = template;

  for (const [key, value] of Object.entries(secrets)) {
    const pattern = new RegExp(`^${key}=.*$`, 'm');

    if (pattern.test(output)) {
      output = output.replace(pattern, `${key}=${value}`);
    } else {
      output += `\n${key}=${value}`;
    }
  }

  return output;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const writeMode = process.argv.includes('--write');
  const secrets = generateSecrets();

  if (!writeMode) {
    for (const [key, value] of Object.entries(secrets)) {
      console.log(`${key}=${value}`);
    }
  } else {
    const examplePath = join(__dirname, '.env.example');
    const envPath = join(__dirname, '.env');
    const livekitPath = join(__dirname, 'livekit.yaml');

    const template = existsSync(envPath)
      ? readFileSync(envPath, 'utf8')
      : readFileSync(examplePath, 'utf8');
    const updatedEnv = applyEnvTemplate(template, secrets);

    writeFileSync(envPath, updatedEnv, 'utf8');
    console.log(`Секреты записаны в ${envPath}`);

    if (existsSync(livekitPath)) {
      const lkRaw = readFileSync(livekitPath, 'utf8');
      const lkUpdated = lkRaw
        .replace(/API_KEY_PLACEHOLDER/g, secrets.LIVEKIT_API_KEY)
        .replace(/API_SECRET_PLACEHOLDER/g, secrets.LIVEKIT_API_SECRET);

      writeFileSync(livekitPath, lkUpdated, 'utf8');
      console.log(`Ключи LiveKit подставлены в ${livekitPath}`);
    }
  }
}
