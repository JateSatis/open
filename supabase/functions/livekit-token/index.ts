// Edge Function `livekit-token`. Деплой: npx supabase functions deploy livekit-token
//
// Секреты: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET (npx supabase
// secrets set). SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY есть по умолчанию.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { listConnected, readLiveKitConfig, signParticipantToken, closeRoom } from '../_shared/livekit.ts';
import { createTokenHandler, type JoinInfo } from './handler.ts';

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const livekit = readLiveKitConfig();

const handler = createTokenHandler({
  resolveUserId: async (accessToken) => {
    const { data, error } = await admin.auth.getUser(accessToken);

    if (error || !data.user) return null;

    return data.user.id;
  },
  joinInfo: async (streamId, userId) => {
    const { data, error } = await admin.rpc('stream_join_info', {
      target_stream: streamId,
      caller: userId,
    });

    if (error) throw error;

    return data as JoinInfo;
  },
  reconcile: async (room) => {
    if (!livekit) return 'ok';

    const connected = await listConnected(livekit, room);
    const { data, error } = await admin.rpc('reconcile_stream', { room, connected });

    if (error) throw error;
    if (data === 'finished') await closeRoom(livekit, room);

    return data as 'ok' | 'finished' | 'ended';
  },
  signToken: (input) => signParticipantToken(livekit!, input),
  livekitUrl: livekit?.url ?? null,
  log: (message, error) => console.error(message, error),
});

Deno.serve(handler);
