// Edge Function `delete-account`. Деплой: npx supabase functions deploy delete-account
//
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Edge Functions получают по
// умолчанию; сервисный ключ живёт только здесь и никогда не попадает в клиент.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { createDeleteAccountHandler, createRemoveAvatarFiles } from './handler.ts';

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
  removeAvatarFiles: createRemoveAvatarFiles(admin.storage.from(MEDIA_BUCKET)),
  deleteUser: async (userId) => {
    const { error } = await admin.auth.admin.deleteUser(userId);

    if (error) throw error;
  },
  log: (message, error) => console.error(message, error),
});

Deno.serve(handler);
