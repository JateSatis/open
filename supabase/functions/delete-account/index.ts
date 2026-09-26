// Edge Function `delete-account`. Деплой: npx supabase functions deploy delete-account
//
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Edge Functions получают по
// умолчанию; сервисный ключ живёт только здесь и никогда не попадает в клиент.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { createDeleteAccountHandler } from './handler.ts';

const MEDIA_BUCKET = 'media';

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const handler = createDeleteAccountHandler({
  resolveUserId: async (accessToken) => {
    // getUser идёт в Auth: подпись, срок и живость сеанса проверяет сервер,
    // а не разбор токена здесь.
    const { data, error } = await admin.auth.getUser(accessToken);

    if (error || !data.user) return null;

    return data.user.id;
  },
  removeAvatarFiles: async (userId) => {
    const folder = `${userId}/avatar`;
    const { data, error } = await admin.storage.from(MEDIA_BUCKET).list(folder, { limit: 100 });

    if (error) throw error;
    if (!data || data.length === 0) return;

    const { error: removeError } = await admin.storage
      .from(MEDIA_BUCKET)
      .remove(data.map((file) => `${folder}/${file.name}`));

    if (removeError) throw removeError;
  },
  deleteUser: async (userId) => {
    const { error } = await admin.auth.admin.deleteUser(userId);

    if (error) throw error;
  },
  log: (message, error) => console.error(message, error),
});

Deno.serve(handler);
