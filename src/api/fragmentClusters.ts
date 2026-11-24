// Кластеры фрагментов текста сообщения (миграции
// `20261023100000_fragment_clusters.sql`, `20261023130000_fragment_cluster_reads.sql`).
// Считает их сервер: клиент получает готовые отображаемые кластеры — что
// подсвечивать на тексте, сводные счётчики и мою реакцию в кластере (у
// человека в кластере она одна). Изменения приходят сигналом
// `clusters_changed` в топик чата.

import { requestClient } from '@/api/requestClient';
import { toReactionCounts, type ReactionCounts } from '@/api/reactionCounts';
import { fromServerRange } from '@/features/chats/fragments/textOffsets';

export type FragmentCluster = {
  id: string;
  messageId: string;
  /** Что подсвечивать — UTF-16 текста, с которым звали `listMessageClusters`. */
  start: number;
  end: number;
  /** Подсвеченный кусок, как его видит база. */
  quote: string;
  popularity: number;
  memberReactions: ReactionCounts;
  visitorReactions: ReactionCounts;
  reactionsCount: number;
  commentsCount: number;
  /** Разных людей с реакцией или комментарием в кластере. */
  peopleCount: number;
  fragmentsCount: number;
  /** Моя реакция в кластере и фрагмент, на котором она стоит. */
  mine: string | null;
  myFragmentId: string | null;
  /** Снимок решения модели, по которому кластер показан, — для событий людей. */
  decisionId: string | null;
  /** Лидер реакций — цвет подсветки; держится в ничьей. `null` — реакций нет. */
  dominant: string | null;
};

/**
 * Отображаемые кластеры сообщения по порядку на тексте. `text` — текст
 * облачка: диапазоны базы (code points) переводятся в его UTF-16. Кластер,
 * чей кусок в этом тексте другой (облачко ещё не догнало правку), не
 * отдаётся — правка перечитает кластеры заново.
 */
export async function listMessageClusters(
  messageId: string,
  text: string,
  api = requestClient(),
): Promise<FragmentCluster[]> {
  const { data, error } = await api.rpc('list_message_clusters', {
    target_message: messageId,
  });

  if (error) throw error;

  return (data ?? []).flatMap((row) => {
    const range = fromServerRange(text, row.display_start, row.display_end);

    if (text.slice(range.start, range.end) !== row.display_text) return [];

    return [
      {
        id: row.id,
        messageId: row.message_id,
        start: range.start,
        end: range.end,
        quote: row.display_text,
        popularity: row.popularity,
        memberReactions: toReactionCounts(row.member_reactions),
        visitorReactions: toReactionCounts(row.visitor_reactions),
        reactionsCount: row.reactions_count,
        commentsCount: row.comments_count,
        peopleCount: row.people_count,
        fragmentsCount: row.fragments_count,
        mine: row.my_emoji ?? null,
        myFragmentId: row.my_fragment_id ?? null,
        decisionId: row.decision_id ?? null,
        dominant: row.dominant_emoji ?? null,
      },
    ];
  });
}

/** Выделенная область для её панели: фрагменты внутри, их сводные реакции и моё. */
export type AreaSummary = {
  /** Фрагменты, больше половины длины которых внутри области. */
  fragmentIds: string[];
  memberReactions: ReactionCounts;
  visitorReactions: ReactionCounts;
  reactionsCount: number;
  commentsCount: number;
  /** Кластер, куда попадёт мой фрагмент области, — тап по реакции заменит мою в нём. */
  myClusterId: string | null;
  /** Моя реакция в этом кластере (без кластера — на моём фрагменте ровно области). */
  mine: string | null;
  myFragmentId: string | null;
};

/** Сводка области — диапазон в code points, как в базе. */
export async function getAreaSummary(
  messageId: string,
  start: number,
  end: number,
  api = requestClient(),
): Promise<AreaSummary> {
  const { data, error } = await api.rpc('fragment_area_summary', {
    target_message: messageId,
    area_start: start,
    area_end: end,
  });

  if (error) throw error;

  const row = data?.[0];

  return {
    fragmentIds: row?.fragment_ids ?? [],
    memberReactions: toReactionCounts(row?.member_reactions),
    visitorReactions: toReactionCounts(row?.visitor_reactions),
    reactionsCount: row?.reactions_count ?? 0,
    commentsCount: row?.comments_count ?? 0,
    myClusterId: row?.my_cluster_id ?? null,
    mine: row?.my_emoji ?? null,
    myFragmentId: row?.my_fragment_id ?? null,
  };
}
