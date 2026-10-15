// Edge Function `fragment-clusters` — обработчик очереди пересчёта кластеров.
// Деплой без проверки JWT Supabase — зовёт её pg_cron со своим секретом, его
// и проверяет функция:
//   npx supabase functions deploy fragment-clusters --no-verify-jwt
// Секрет — `FRAGMENT_CLUSTERS_SECRET` в секретах функций и тот же
// `fragment_clusters_worker_secret` в Vault базы (там же адрес функции —
// `fragment_clusters_worker_url`).

import { createClient } from 'npm:@supabase/supabase-js@2';

import { createClustersHandler, type ClusterSnapshot } from './handler.ts';

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const handler = createClustersHandler({
  secret: Deno.env.get('FRAGMENT_CLUSTERS_SECRET') ?? '',
  claim: async (batch) => {
    const { data, error } = await admin.rpc('fragment_clusters_claim', { batch });

    if (error) throw error;

    return (data ?? []) as ClusterSnapshot[];
  },
  apply: async (messageId, result) => {
    const { data, error } = await admin.rpc('fragment_clusters_apply', {
      target_message: messageId,
      result,
    });

    if (error) throw error;

    return String(data);
  },
  dedup: async (messageId) => {
    const { data, error } = await admin.rpc('fragment_clusters_dedup', { target_message: messageId });

    if (error) throw error;

    return Number(data ?? 0);
  },
  requeue: async (messageId) => {
    const { error } = await admin.rpc('fragment_clusters_enqueue', { target_message: messageId });

    if (error) throw error;
  },
  log: (message, error) => console.error(message, error),
});

Deno.serve(handler);
