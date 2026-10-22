// Разовый перенос аватаров людей из публичного бакета `media` в закрытый
// `avatars` (миграция 20261101140000_identity_avatars.sql: она переписала
// `profiles.avatar_url` на пути `{id}/{файл}`, а файлы Storage двигает только
// своим API). Повторный запуск безопасен: уже перенесённое пропускается,
// старые файлы удаляются после копирования.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/migrate-avatars.mjs
//
// Сервисный ключ — только в окружении на время запуска, в файлы не пишется.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// Страницами: PostgREST отдаёт не больше 1000 строк за раз.
const PAGE = 1000;
const profiles = [];

for (let from = 0; ; from += PAGE) {
  const { data, error } = await admin
    .from("profiles")
    .select("id, avatar_url")
    .order("id")
    .range(from, from + PAGE - 1);

  if (error) throw error;

  profiles.push(...data);

  if (data.length < PAGE) break;
}

let copied = 0;
let removed = 0;

for (const profile of profiles) {
  const legacyFolder = `${profile.id}/avatar`;
  const { data: legacy, error: listError } = await admin.storage.from("media").list(legacyFolder, { limit: 100 });

  if (listError) throw listError;

  const current = typeof profile.avatar_url === "string" && profile.avatar_url.startsWith(`${profile.id}/`)
    ? profile.avatar_url
    : null;

  for (const file of legacy ?? []) {
    const target = `${profile.id}/${file.name}`;

    // Переносится только текущий аватар: прежние файлы никому не нужны.
    if (target === current) {
      const { data: existing } = await admin.storage.from("avatars").list(profile.id, { search: file.name });

      if (!existing?.some((item) => item.name === file.name)) {
        const { error: copyError } = await admin.storage
          .from("media")
          .copy(`${legacyFolder}/${file.name}`, target, { destinationBucket: "avatars" });

        if (copyError) throw copyError;

        copied += 1;
      }
    }
  }

  if (legacy && legacy.length > 0) {
    const { error: removeError } = await admin.storage
      .from("media")
      .remove(legacy.map((file) => `${legacyFolder}/${file.name}`));

    if (removeError) throw removeError;

    removed += legacy.length;
  }
}

console.log(`Скопировано в avatars: ${copied}, удалено из media: ${removed}`);
