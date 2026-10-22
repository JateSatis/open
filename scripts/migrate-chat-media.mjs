// Разовый перенос файлов под правила этапа 5 (миграции 20261102100000 и
// 20261102110000): каждый файл, который отдаётся людям, очищается от
// метаданных той же функцией, что и `sanitize-media`, а медиа сообщений и
// комментариев переезжает из публичного `media` в закрытый `chat-media`.
//
//   * вложения сообщений и комментариев: media → chat-media, в строке — путь;
//   * попсы, фото групп и каналов: остаются в `media`, но под новым именем
//     (чистая копия), прежний файл удаляется;
//   * фото людей: в `avatars` под новым именем;
//   * каждый чистый файл отмечается в `media_objects`;
//   * прежние файлы медиа сообщений и комментариев в `media` (и все
//     несостоявшиеся отправки в папках photo/video/voice/video_note)
//     удаляются: это неочищенные оригиналы.
// Повторный запуск безопасен: перенесённое (путь без адреса, файл в реестре)
// пропускается.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/migrate-chat-media.mjs [--dry-run]
//
// Сервисный ключ — только в окружении на время запуска, в файлы не пишется.
// Скрипт не печатает и не сохраняет вычищенные метаданные — только счётчики.

import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import {
  applyPlan,
  memorySource,
  planIsoBmff,
  sanitizeJpeg,
} from '../supabase/functions/_shared/mediaSanitize.ts';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes('--dry-run');

if (!url || !key) {
  console.error('Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const PUBLIC_MARKER = '/storage/v1/object/public/media/';
const PAGE = 1000;

const stats = { cleaned: 0, skipped: 0, failed: [], removed: 0 };
/** Прежние объекты, которые надо удалить после переноса: бакет → пути. */
const stale = { media: new Set(), avatars: new Set() };

async function selectAll(table, columns, filter = (query) => query) {
  const rows = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await filter(admin.from(table).select(columns))
      .order('id')
      .range(from, from + PAGE - 1);

    if (error) throw error;

    rows.push(...data);

    if (data.length < PAGE) return rows;
  }
}

function publicPath(value) {
  const at = value ? value.indexOf(PUBLIC_MARKER) : -1;

  return at === -1 ? null : decodeURIComponent(value.slice(at + PUBLIC_MARKER.length).split('?')[0]);
}

function isPath(value) {
  return Boolean(value) && !/^[a-z][a-z0-9+.-]*:/i.test(value);
}

async function registered(bucket, path) {
  const { data, error } = await admin
    .from('media_objects')
    .select('id')
    .eq('bucket', bucket)
    .eq('path', path)
    .maybeSingle();

  if (error) throw error;

  return Boolean(data);
}

/**
 * Чистит файл `from` и кладёт чистую копию в `bucket` под новым именем в
 * папке владельца. Отдаёт новый путь; null — файл не удалось очистить.
 */
async function cleanCopy(from, { bucket, owner, folder, kind, format, ext, contentType }, label) {
  const { data: blob, error } = await admin.storage.from(from.bucket).download(from.path);

  if (error) {
    stats.failed.push(`${label}: файла нет (${from.bucket})`);
    return null;
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  let clean;

  try {
    clean =
      format === 'jpeg'
        ? sanitizeJpeg(bytes)
        : applyPlan(await planIsoBmff(memorySource(bytes)), bytes);
  } catch (cause) {
    stats.failed.push(`${label}: не очищается (${cause.name})`);
    return null;
  }

  const path = folder ? `${owner}/${folder}/${randomUUID()}.${ext}` : `${owner}/${randomUUID()}.${ext}`;

  if (dryRun) {
    stats.cleaned += 1;
    return path;
  }

  const { error: uploadError } = await admin.storage.from(bucket).upload(path, clean, {
    contentType,
    upsert: false,
    cacheControl: '31536000',
  });

  if (uploadError) throw uploadError;

  const { error: registerError } = await admin.from('media_objects').insert({
    bucket,
    path,
    owner_id: owner,
    kind,
    mime_type: contentType,
    size_bytes: clean.length,
  });

  if (registerError) throw registerError;

  stats.cleaned += 1;

  return path;
}

function avFormat(kind, mime, sourcePath) {
  const ext = kind === 'voice' ? 'm4a' : sourcePath.endsWith('.mov') ? 'mov' : 'mp4';
  const contentType = kind === 'voice' ? 'audio/mp4' : ext === 'mov' ? 'video/quicktime' : 'video/mp4';

  return { format: 'bmff', ext, contentType: mime?.startsWith('audio/') ? 'audio/mp4' : contentType };
}

/** Вложения сообщений и комментариев: media → chat-media. */
async function migrateAttachments(table, parent, parentTable) {
  const rows = await selectAll(table, `id, ${parent}, url, poster_url, mime_type`, (query) =>
    table === 'attachments' ? query.is('pop_id', null) : query,
  );
  const parents = new Map();

  for (const id of [...new Set(rows.map((row) => row[parent]))]) {
    parents.set(id, null);
  }

  const ids = [...parents.keys()];

  for (let at = 0; at < ids.length; at += 200) {
    const { data, error } = await admin
      .from(parentTable)
      .select('id, author_id')
      .in('id', ids.slice(at, at + 200));

    if (error) throw error;

    data.forEach((row) => parents.set(row.id, row.author_id));
  }

  for (const row of rows) {
    const owner = parents.get(row[parent]);
    const label = `${table} ${row.id}`;
    const patch = {};

    for (const column of ['url', 'poster_url']) {
      const value = row[column];

      if (!value) continue;

      if (isPath(value) && (await registered('chat-media', value))) {
        stats.skipped += 1;
        continue;
      }

      const source = publicPath(value);

      if (!source || !owner) {
        stats.failed.push(`${label}.${column}: ${owner ? 'адрес не из media' : 'автор удалён'}`);
        continue;
      }

      const mime = row.mime_type ?? '';
      const kind =
        column === 'poster_url'
          ? 'poster'
          : mime.startsWith('image/')
            ? 'photo'
            : mime.startsWith('audio/')
              ? 'voice'
              : 'video';
      const target =
        kind === 'photo' || kind === 'poster'
          ? { format: 'jpeg', ext: 'jpg', contentType: 'image/jpeg' }
          : avFormat(kind, mime, source);
      const path = await cleanCopy(
        { bucket: 'media', path: source },
        { bucket: 'chat-media', owner, folder: kind, kind, ...target },
        `${label}.${column}`,
      );

      if (path) {
        patch[column] = path;
        stale.media.add(source);
      }
    }

    if (!dryRun && Object.keys(patch).length > 0) {
      const { error } = await admin.from(table).update(patch).eq('id', row.id);

      if (error) throw error;
    }
  }
}

/** Попсы: чистая копия в media/{автор}/pops. */
async function migratePops() {
  const pops = await selectAll('pops', 'id, author_id, url, poster_url, mime_type');

  for (const pop of pops) {
    const patch = {};

    for (const [column, kind] of [
      ['url', 'pop_video'],
      ['poster_url', 'pop_poster'],
    ]) {
      const source = publicPath(pop[column]);

      if (!source) continue;
      if (await registered('media', source)) {
        stats.skipped += 1;
        continue;
      }

      if (!pop.author_id) {
        stats.failed.push(`pops ${pop.id}.${column}: автор удалён`);
        continue;
      }

      const target =
        kind === 'pop_poster'
          ? { format: 'jpeg', ext: 'jpg', contentType: 'image/jpeg' }
          : avFormat('video', pop.mime_type, source);
      const path = await cleanCopy(
        { bucket: 'media', path: source },
        { bucket: 'media', owner: pop.author_id, folder: 'pops', kind, ...target },
        `pops ${pop.id}.${column}`,
      );

      if (path) {
        patch[column] = admin.storage.from('media').getPublicUrl(path).data.publicUrl;
        stale.media.add(source);
      }
    }

    if (!dryRun && Object.keys(patch).length > 0) {
      const { error } = await admin.from('pops').update(patch).eq('id', pop.id);

      if (error) throw error;
    }
  }
}

/** Фото групп и каналов: чистая копия в той же папке поставившего. */
async function migrateGroupPhotos(table, folder, kind) {
  const rows = await selectAll(table, 'id, avatar_url', (query) => query.not('avatar_url', 'is', null));

  for (const row of rows) {
    const source = publicPath(row.avatar_url);

    if (!source) continue;
    if (await registered('media', source)) {
      stats.skipped += 1;
      continue;
    }

    const owner = source.split('/')[0];
    const path = await cleanCopy(
      { bucket: 'media', path: source },
      { bucket: 'media', owner, folder, kind, format: 'jpeg', ext: 'jpg', contentType: 'image/jpeg' },
      `${table} ${row.id}`,
    );

    if (!path) continue;

    stale.media.add(source);

    if (!dryRun) {
      const { error } = await admin
        .from(table)
        .update({ avatar_url: admin.storage.from('media').getPublicUrl(path).data.publicUrl })
        .eq('id', row.id);

      if (error) throw error;
    }
  }
}

/** Фото людей в avatars: чистая копия, путь в профиле — новый. */
async function migrateProfilePhotos() {
  const profiles = await selectAll('profiles', 'id, avatar_url', (query) =>
    query.not('avatar_url', 'is', null),
  );

  for (const profile of profiles) {
    if (!isPath(profile.avatar_url)) continue;
    if (await registered('avatars', profile.avatar_url)) {
      stats.skipped += 1;
      continue;
    }

    const path = await cleanCopy(
      { bucket: 'avatars', path: profile.avatar_url },
      {
        bucket: 'avatars',
        owner: profile.id,
        folder: null,
        kind: 'avatar',
        format: 'jpeg',
        ext: 'jpg',
        contentType: 'image/jpeg',
      },
      `profiles ${profile.id}`,
    );

    if (!path) continue;

    stale.avatars.add(profile.avatar_url);

    if (!dryRun) {
      const { error } = await admin.from('profiles').update({ avatar_url: path }).eq('id', profile.id);

      if (error) throw error;
    }
  }
}

/**
 * Несостоявшиеся отправки и прежние копии в `media`: всё в папках медиа
 * переписки, что не отмечено очищенным. Попсы и фото групп/каналов здесь не
 * трогаются — их прежние файлы уже в `stale`.
 */
async function collectChatLeftovers() {
  const { data: owners, error } = await admin.storage.from('media').list('', { limit: 1000 });

  if (error) throw error;

  for (const owner of owners ?? []) {
    for (const folder of ['photo', 'video', 'voice', 'video_note', 'poster', 'avatar']) {
      const prefix = `${owner.name}/${folder}`;
      const { data: files } = await admin.storage.from('media').list(prefix, { limit: 1000 });

      for (const file of files ?? []) {
        if (file.id) stale.media.add(`${prefix}/${file.name}`);
      }
    }
  }
}

async function removeStale() {
  for (const [bucket, paths] of Object.entries(stale)) {
    const list = [...paths];

    for (let at = 0; at < list.length; at += 100) {
      if (dryRun) {
        stats.removed += list.slice(at, at + 100).length;
        continue;
      }

      const { data, error } = await admin.storage.from(bucket).remove(list.slice(at, at + 100));

      if (error) throw error;

      stats.removed += data.length;
    }
  }
}

await migrateAttachments('attachments', 'message_id', 'messages');
await migrateAttachments('comment_attachments', 'comment_id', 'comments');
await migratePops();
await migrateGroupPhotos('chats', 'group-avatar', 'group_avatar');
await migrateGroupPhotos('channels', 'channel-avatar', 'channel_avatar');
await migrateProfilePhotos();
await collectChatLeftovers();
await removeStale();

console.log(
  `${dryRun ? '[пробно] ' : ''}Очищено и перенесено: ${stats.cleaned}, уже были: ${stats.skipped}, ` +
    `удалено прежних: ${stats.removed}, не удалось: ${stats.failed.length}`,
);
stats.failed.forEach((line) => console.log(`  — ${line}`));
