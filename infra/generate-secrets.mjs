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

function readEnvValue(envText, name) {
  const match = envText.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return match?.[1]?.trim();
}

function getGoogleClientIds() {
  const appConfig = JSON.parse(readFileSync(join(__dirname, '..', 'app.json'), 'utf8'));
  const googleSignIn = appConfig.expo?.extra?.googleSignIn ?? {};

  return [googleSignIn.webClientId, googleSignIn.iosClientId]
    .filter((clientId, index, clientIds) => clientId && clientIds.indexOf(clientId) === index)
    .join(',');
}

function applyLivekitConfig(template, envText, secrets) {
  const livekitDomain = readEnvValue(envText, 'LIVEKIT_DOMAIN');

  const validDomain = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  if (!livekitDomain || !validDomain.test(livekitDomain) || livekitDomain.includes('example.com')) {
    throw new Error('Укажите реальный LIVEKIT_DOMAIN в infra/.env перед генерацией LiveKit-конфигурации.');
  }

  const certificateBase = `/data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/${livekitDomain}/${livekitDomain}`;

  return template
    .replace(/^  domain: .*$/m, `  domain: ${livekitDomain}`)
    .replace(/^  tls_port: .*$/m, `  tls_port: 5349\n  cert_file: ${certificateBase}.crt\n  key_file: ${certificateBase}.key`)
    .replace(/^keys:\r?\n(?:[ \t]+.*(?:\r?\n|$))*/m, `keys:\n  ${secrets.LIVEKIT_API_KEY}: ${secrets.LIVEKIT_API_SECRET}\n`)
    .replace(/^  api_key: .*$/m, `  api_key: ${secrets.LIVEKIT_API_KEY}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const writeMode = process.argv.includes('--write');

  if (!writeMode) {
    const secrets = generateSecrets();

    for (const [key, value] of Object.entries(secrets)) {
      console.log(`${key}=${value}`);
    }
  } else {
    const examplePath = join(__dirname, '.env.example');
    const envPath = join(__dirname, '.env');
    const livekitPath = join(__dirname, 'livekit.yaml');
    const livekitRuntimePath = join(__dirname, 'livekit.runtime.yaml');

    const template = existsSync(envPath)
      ? readFileSync(envPath, 'utf8')
      : readFileSync(examplePath, 'utf8');
    const generatedSecrets = generateSecrets();
    const secrets = Object.fromEntries(
      Object.entries(generatedSecrets).map(([key, generatedValue]) => [
        key,
        readEnvValue(template, key) || generatedValue,
      ]),
    );
    const updatedEnv = applyEnvTemplate(template, secrets);
    const googleClientId = readEnvValue(updatedEnv, 'GOOGLE_CLIENT_ID');
    const googleClientIds = getGoogleClientIds();
    const configuredEnv = !googleClientId && googleClientIds
      ? applyEnvTemplate(updatedEnv, { GOOGLE_CLIENT_ID: googleClientIds })
      : updatedEnv;

    let livekitRuntime;
    if (existsSync(livekitPath)) {
      const lkTemplate = readFileSync(livekitPath, 'utf8');
      livekitRuntime = applyLivekitConfig(lkTemplate, configuredEnv, secrets);
    }

    writeFileSync(envPath, configuredEnv, 'utf8', { mode: 0o600 });
    console.log(`Секреты записаны в ${envPath}`);

    if (livekitRuntime) {
      writeFileSync(livekitRuntimePath, livekitRuntime, 'utf8', { mode: 0o600 });
      console.log(`Конфигурация LiveKit записана в ${livekitRuntimePath}`);
    }
  }
}
