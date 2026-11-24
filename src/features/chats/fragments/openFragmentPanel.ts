// Открытие боковой панели куска текста — кластера (тап по подсветке, 💬 у
// выделения ровно по кластеру) или выделенной области (💬 у выделения) — и
// событие для модели кластеров.

import { requestClient } from '@/api/requestClient';
import type { QueryClient } from '@tanstack/react-query';

import { trackClusterEvent } from '@/api/fragmentClusterEvents';
import type { FragmentCluster } from '@/api/fragmentClusters';
import { clustersKey } from '@/features/chats/fragments/clusterKeys';
import { clearTextSelection, type TextSelection } from '@/features/chats/fragments/fragmentStore';
import { toServerRange } from '@/features/chats/fragments/textOffsets';
import { openFragmentComments } from '@/features/interactions/comments/commentsPanelStore';

/** Облачко, где кусок: его текст и сообщение (у облачка островка — оригинал). */
export type FragmentPanelSource = {
  rowKey: string;
  messageId: string;
  chatId: string;
  amMember: boolean;
  /** Текст облачка: диапазоны кластеров — в его UTF-16. */
  text: string;
};

export function openClusterPanel(source: FragmentPanelSource, cluster: FragmentCluster, api = requestClient()) {
  const range = toServerRange(source.text, cluster.start, cluster.end);

  openFragmentComments(
    source.messageId,
    source.chatId,
    source.amMember,
    {
      kind: 'cluster',
      key: `cluster:${cluster.id}`,
      clusterId: cluster.id,
      decisionId: cluster.decisionId,
      range,
      messageText: source.text,
      focusInput: false,
    },
  );
  trackClusterEvent({
    kind: 'cluster_opened',
    messageId: source.messageId,
    decisionId: cluster.decisionId,
    clusterId: cluster.id,
    rangeStart: range.start,
    rangeEnd: range.end,
  }, api);
}

/** Выделенный кусок `[start, end)` в UTF-16 текста облачка; сразу поле ввода. */
export function openAreaPanel(source: FragmentPanelSource, start: number, end: number, api = requestClient()) {
  const range = toServerRange(source.text, start, end);

  openFragmentComments(
    source.messageId,
    source.chatId,
    source.amMember,
    {
      kind: 'area',
      key: `area:${range.start}-${range.end}`,
      range,
      messageText: source.text,
      focusInput: true,
    },
  );
  trackClusterEvent({
    kind: 'area_opened',
    messageId: source.messageId,
    rangeStart: range.start,
    rangeEnd: range.end,
  }, api);
}

/**
 * 💬 у выделения: выделено ровно то, что подсвечено кластером, — панель
 * кластера; иначе — панель области. Выделение снимается, облачко остаётся в
 * режиме фрагментов.
 */
export function commentOnSelection(queryClient: QueryClient, selection: TextSelection, api = requestClient()) {
  const { rowKey, messageId, chatId, amMember, text, start, end } = selection;
  const source = { rowKey, messageId, chatId, amMember, text };
  const cluster = queryClient
    .getQueryData<FragmentCluster[]>(clustersKey(messageId, text))
    ?.find((item) => item.start === start && item.end === end);

  clearTextSelection();

  if (cluster) openClusterPanel(source, cluster, api);
  else openAreaPanel(source, start, end, api);
}
