// Тесты генератора секретов и переписывания ссылок миграции (запуск: npx jest).

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');

function evalModule(code: string) {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  return JSON.parse(out.trim());
}

describe('infra/generate-secrets.mjs', () => {
  it('генерирует полный набор секретов и валидные HS256 JWT для anon и service_role', () => {
    const result = evalModule(`
      import { Buffer } from 'node:buffer';
      import { generateSecrets, signSupabaseJwt } from './infra/generate-secrets.mjs';
      const secrets = generateSecrets();
      const decode = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
      const det1 = signSupabaseJwt('anon', 'test-secret-32-bytes-long-000000', 1700000000);
      const det2 = signSupabaseJwt('anon', 'test-secret-32-bytes-long-000000', 1700000000);
      console.log(JSON.stringify({
        secrets,
        anonPayload: decode(secrets.ANON_KEY),
        servicePayload: decode(secrets.SERVICE_ROLE_KEY),
        deterministic: det1 === det2,
      }));
    `);

    expect(result.secrets.POSTGRES_PASSWORD).toHaveLength(48);
    expect(result.secrets.JWT_SECRET.length).toBeGreaterThanOrEqual(64);
    expect(result.secrets.SECRET_KEY_BASE.length).toBeGreaterThanOrEqual(64);
    expect(result.secrets.LIVEKIT_API_KEY).toMatch(/^API[0-9a-f]{12}$/);
    expect(result.secrets.LIVEKIT_API_SECRET.length).toBeGreaterThanOrEqual(24);
    expect(result.secrets.FRAGMENT_CLUSTERS_SECRET).toHaveLength(48);

    expect(result.anonPayload.role).toBe('anon');
    expect(result.anonPayload.iss).toBe('supabase');
    expect(result.servicePayload.role).toBe('service_role');
    expect(result.servicePayload.iss).toBe('supabase');
    expect(result.deterministic).toBe(true);
  });
});

describe('scripts/migration (export-cloud & import-selfhosted)', () => {
  it('разбирает JSON-ответы CLI, переписывает публичные ссылки media и сериализует SQL-литералы', () => {
    const result = evalModule(`
      import { parseCliQueryOutput, TARGET_BUCKETS } from './scripts/migration/export-cloud.mjs';
      import { rewritePublicMediaUrl, toSqlLiteral, transformTableRow } from './scripts/migration/import-selfhosted.mjs';

      const cliSample = 'Initialising login role...\\n{"boundary":"abc","rows":[{"cnt":5}]}\\nA new version...';
      const target = 'https://api.openger.com/';
      const oldPopUrl = 'https://cxgkiwxgwxiybazyvcgi.supabase.co/storage/v1/object/public/media/626baf39/pops/video.mp4';

      const pop = transformTableRow(
        'public',
        'pops',
        {
          id: '1',
          url: 'https://cxgkiwxgwxiybazyvcgi.supabase.co/storage/v1/object/public/media/u1/pops/v.mp4',
          poster_url: 'https://cxgkiwxgwxiybazyvcgi.supabase.co/storage/v1/object/public/media/u1/pops/p.jpg',
        },
        target,
      );
      const channel = transformTableRow(
        'public',
        'channels',
        {
          id: '2',
          avatar_url: 'https://cxgkiwxgwxiybazyvcgi.supabase.co/storage/v1/object/public/media/u1/channel-avatar/a.jpg',
        },
        target,
      );
      const chat = transformTableRow(
        'public',
        'chats',
        {
          id: '3',
          avatar_url: 'https://cxgkiwxgwxiybazyvcgi.supabase.co/storage/v1/object/public/media/u1/group-avatar/g.jpg',
        },
        target,
      );

      console.log(JSON.stringify({
        buckets: TARGET_BUCKETS,
        parsedCli: parseCliQueryOutput(cliSample),
        rewrittenPopUrl: rewritePublicMediaUrl(oldPopUrl, target),
        untouchedRelative: rewritePublicMediaUrl('626baf39/photo/123.jpg', target),
        untouchedExternal: rewritePublicMediaUrl('https://lh3.googleusercontent.com/a/avatar', target),
        pop,
        channel,
        chat,
        literals: {
          nullVal: toSqlLiteral(null, 'text'),
          byteaVal: toSqlLiteral('deadbeef', 'bytea'),
          arrVal: toSqlLiteral([1, 2, 3], 'smallint[]'),
          emptyArr: toSqlLiteral([], 'uuid[]'),
          jsonbVal: toSqlLiteral({ a: 1 }, 'jsonb'),
        },
      }));
    `);

    expect(result.buckets).toEqual(['avatars', 'chat-media', 'media']);
    expect(result.parsedCli).toEqual([{ cnt: 5 }]);
    expect(result.rewrittenPopUrl).toBe(
      'https://api.openger.com/storage/v1/object/public/media/626baf39/pops/video.mp4',
    );
    expect(result.untouchedRelative).toBe('626baf39/photo/123.jpg');
    expect(result.untouchedExternal).toBe('https://lh3.googleusercontent.com/a/avatar');

    expect(result.pop.rewritten).toBe(2);
    expect(result.pop.row.url).toBe('https://api.openger.com/storage/v1/object/public/media/u1/pops/v.mp4');
    expect(result.pop.row.poster_url).toBe('https://api.openger.com/storage/v1/object/public/media/u1/pops/p.jpg');

    expect(result.channel.rewritten).toBe(1);
    expect(result.channel.row.avatar_url).toBe(
      'https://api.openger.com/storage/v1/object/public/media/u1/channel-avatar/a.jpg',
    );

    expect(result.chat.rewritten).toBe(1);
    expect(result.chat.row.avatar_url).toBe(
      'https://api.openger.com/storage/v1/object/public/media/u1/group-avatar/g.jpg',
    );

    expect(result.literals.nullVal).toBe('NULL');
    expect(result.literals.byteaVal).toBe("decode('deadbeef', 'hex')");
    expect(result.literals.arrVal).toBe('ARRAY[1, 2, 3]::smallint[]');
    expect(result.literals.emptyArr).toBe("'{}'::uuid[]");
    expect(result.literals.jsonbVal).toBe('\'{"a":1}\'::jsonb');
  });

  it('строит проверки количества строк, старого домена и точного состава Storage', () => {
    const result = evalModule(`
      import { buildDatabaseVerificationSql, buildStorageVerificationSql } from './scripts/migration/import-selfhosted.mjs';
      console.log(JSON.stringify({
        database: buildDatabaseVerificationSql([{ schema: 'public', table: 'pops', count: 52 }]),
        storage: buildStorageVerificationSql({ files: [
          { bucket: 'avatars', path: 'u1/a.jpg', size: 12, mimeType: 'image/jpeg' },
          { bucket: 'media', path: 'u1/pops/p.mp4', size: 34, mimeType: 'video/mp4' },
        ] }),
      }));
    `);

    expect(result.database).toContain('public"."pops');
    expect(result.database).toContain('actual <> 52');
    expect(result.database).toContain('strpos("url", \'cxgkiwxgwxiybazyvcgi.supabase.co\')');
    expect(result.storage).toContain('actual <> 2');
    expect(result.storage).toContain("('avatars', 'u1/a.jpg', 12, 'image/jpeg')");
    expect(result.storage).toContain("('media', 'u1/pops/p.mp4', 34, 'video/mp4')");
    expect(result.storage).toContain("'image/jpeg'");
    expect(result.storage).toContain("'video/mp4'");
  });
});
