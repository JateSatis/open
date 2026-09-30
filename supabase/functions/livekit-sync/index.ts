// Edge Function `livekit-sync`. Деплой: npx supabase functions deploy livekit-sync

import { createClient } from 'npm:@supabase/supabase-js@2';

import { closeRoom, listConnected, readLiveKitConfig } from '../_shared/livekit.ts';
import { createSyncHandler } from './handler.ts';

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const livekit = readLiveKitConfig();

const handler = createSyncHandler({
  resolveUserId: async (accessToken) => {
    const { data, error } = await admin.auth.getUser(accessToken);

    if (error || !data.user) return null;

    return data.user.id;
  },
  liveRoom: async (streamId) => {
    const { data, error } = await admin
      .from('streams')
      .select('room_name')
      .eq('id', streamId)
      .eq('status', 'live')
      .maybeSingle();

    if (error) throw error;

    return data?.room_name ?? null;
  },
  listConnected: (room) => {
    if (!livekit) throw new Error('LIVEKIT_* secrets are not set');

    return listConnected(livekit, room);
  },
  reconcile: async (room, connected) => {
    const { data, error } = await admin.rpc('reconcile_stream', { room, connected });

    if (error) throw error;

    return String(data);
  },
  closeRoom: (room) => closeRoom(livekit!, room),
  log: (message, error) => console.error(message, error),
});

Deno.serve(handler);
