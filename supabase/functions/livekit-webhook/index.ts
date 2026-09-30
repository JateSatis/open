// Edge Function `livekit-webhook`. Деплой без проверки JWT Supabase — LiveKit
// подписывает запрос своим ключом, и подпись проверяет сама функция:
//   npx supabase functions deploy livekit-webhook --no-verify-jwt
// Адрес вебхука указывается в настройках проекта LiveKit Cloud.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { closeRoom, readLiveKitConfig, webhookReceiver } from '../_shared/livekit.ts';
import { createWebhookHandler } from './handler.ts';

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const livekit = readLiveKitConfig();

async function call(fn: string, args: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin.rpc(fn, args);

  if (error) throw error;

  return String(data);
}

const handler = createWebhookHandler({
  receive: async (body, authorization) => {
    if (!livekit) throw new Error('LIVEKIT_* secrets are not set');

    return await webhookReceiver(livekit).receive(body, authorization ?? undefined);
  },
  joined: ({ room, identity, sid, role, at }) =>
    call('stream_participant_joined', { room, identity, sid, participant_role: role, event_at: at }),
  left: ({ room, identity, sid, at }) =>
    call('stream_participant_left', { room, identity, sid, event_at: at }),
  roomFinished: (room) => call('stream_room_finished', { room }),
  closeRoom: (room) => closeRoom(livekit!, room),
  log: (message, error) => console.error(message, error),
});

Deno.serve(handler);
