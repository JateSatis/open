/**
 * Обработчик очереди пересчёта кластеров фрагментов.
 *
 * Будит его pg_cron (`fragment_clusters_kick`), когда в очереди есть заявки.
 * Обработчик забирает пачку снимков (`fragment_clusters_claim`), для каждого
 * сообщения считает модель (`computeClusters`) и пишет результат
 * (`fragment_clusters_apply`), затем схлопывает реакции людей в слившихся
 * кластерах (`fragment_clusters_dedup`) — отдельной транзакцией. И так, пока
 * очередь не опустеет или не кончится бюджет времени.
 *
 * Вся связь с базой — эти три функции: отдельный сервис, читающий ту же
 * очередь, повторит этот цикл без изменения схемы и клиента.
 */

import {
  computeClusters,
  type ClusterModelInput,
  type ClusterModelResult,
  type ClusterParams,
  type FragmentInput,
  type PreviousCluster,
  type VoteInput,
} from '../_shared/fragmentClusters.ts';

/** Снимок сообщения, как его отдаёт `fragment_clusters_take`. */
export type ClusterSnapshot = {
  message_id: string;
  /** Сообщения уже нет в базе — заявку остаётся только снять. */
  gone?: boolean;
  lease?: string;
  msg_ids: number[];
  interactions?: number;
  deleted?: boolean;
  text_version?: string;
  text_hash?: string;
  text?: string;
  model_version?: number;
  params?: Partial<ClusterParams>;
  fragments?: FragmentInput[];
  votes?: VoteInput[];
  previous?: PreviousCluster[];
};

export type ClustersDeps = {
  /** Секрет, с которым pg_cron зовёт функцию. */
  secret: string;
  claim: (batch: number) => Promise<ClusterSnapshot[]>;
  apply: (messageId: string, result: Record<string, unknown>) => Promise<string>;
  dedup: (messageId: string) => Promise<number>;
  /** Поставить заявку на сообщение заново. */
  requeue: (messageId: string) => Promise<void>;
  compute?: (input: ClusterModelInput) => ClusterModelResult;
  now?: () => number;
  /** Сколько работать за один вызов, мс. */
  budgetMs?: number;
  batch?: number;
  log?: (message: string, error?: unknown) => void;
};

export type MessageOutcome = { message_id: string; outcome: string; compute_ms: number; write_ms: number };

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Сравнение без раннего выхода: место расхождения по времени не видно. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;

  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);

  return diff === 0;
}

/** Ошибка — строкой для ответа: его видно в `net._http_response` базы. */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Результат модели — в форму, которую ждёт `fragment_clusters_apply`. */
export function toApplyPayload(snapshot: ClusterSnapshot, model: ClusterModelResult | null) {
  return {
    lease: snapshot.lease ?? null,
    msg_ids: snapshot.msg_ids,
    interactions: snapshot.interactions ?? 0,
    text_version: snapshot.text_version ?? null,
    text_hash: snapshot.text_hash ?? null,
    model_version: snapshot.model_version ?? null,
    clusters: model?.clusters ?? [],
    // Журнал решения: признаки и кандидаты — данные для обучения модели.
    decision: model?.decision ?? null,
  };
}

export function createClustersHandler(deps: ClustersDeps) {
  const compute = deps.compute ?? computeClusters;
  const now = deps.now ?? (() => performance.now());
  const budget = deps.budgetMs ?? 20_000;
  const batch = deps.batch ?? 10;
  const log = deps.log ?? (() => {});

  async function processOne(snapshot: ClusterSnapshot): Promise<MessageOutcome> {
    const started = now();
    const live = !snapshot.gone && !snapshot.deleted;
    const model = live
      ? compute({
          text: snapshot.text ?? '',
          fragments: snapshot.fragments ?? [],
          votes: snapshot.votes ?? [],
          previous: snapshot.previous ?? [],
          params: snapshot.params ?? {},
        })
      : null;
    const computed = now();
    const outcome = await deps.apply(snapshot.message_id, toApplyPayload(snapshot, model));

    if (outcome === 'applied') {
      try {
        await deps.dedup(snapshot.message_id);
      } catch (error) {
        // Запись уже сняла заявку: без новой лишние реакции в слившемся
        // кластере дожили бы до следующего взаимодействия.
        log(`dedup failed for ${snapshot.message_id}, requeued`, error);
        await deps.requeue(snapshot.message_id);
      }
    }

    return {
      message_id: snapshot.message_id,
      outcome,
      compute_ms: Math.round((computed - started) * 10) / 10,
      write_ms: Math.round((now() - computed) * 10) / 10,
    };
  }

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

    const header = request.headers.get('Authorization') ?? '';
    const token = /^Bearer\s+(\S+)$/i.exec(header.trim())?.[1] ?? '';

    if (!deps.secret || !sameSecret(token, deps.secret)) return json(401, { error: 'unauthorized' });

    const started = now();
    const done: MessageOutcome[] = [];
    const failed: { message_id: string; error: string }[] = [];

    while (now() - started < budget) {
      let snapshots: ClusterSnapshot[];

      try {
        snapshots = await deps.claim(batch);
      } catch (error) {
        log('claim failed', error);
        return json(502, { error: 'claim_failed', done });
      }

      if (snapshots.length === 0) break;

      for (const snapshot of snapshots) {
        try {
          done.push(await processOne(snapshot));
        } catch (error) {
          // Заявка не снята — вернётся в очередь, когда истечёт аренда.
          failed.push({ message_id: snapshot.message_id, error: describe(error) });
          log(`recompute failed for ${snapshot.message_id}`, error);
        }
      }
    }

    return json(200, { done, failed });
  };
}
