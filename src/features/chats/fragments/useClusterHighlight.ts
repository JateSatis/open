import { useEffect, useRef, useState } from 'react';
import type { Text } from 'react-native';

import { measureText, type TextGeometry } from '../../../../modules/text-geometry';

import { trackClusterEvent } from '@/api/fragmentClusterEvents';
import type { FragmentCluster } from '@/api/fragmentClusters';
import { useFragmentModeActive, useRowHasSelection } from '@/features/chats/fragments/fragmentStore';
import { useMessageClusters } from '@/features/chats/fragments/useMessageClusters';
import { useCommentsPanelTarget } from '@/features/interactions/comments/commentsPanelStore';

const NONE: FragmentCluster[] = [];

type Options = {
  rowKey: string | undefined;
  ref: { current: Text | null };
  text: string;
  messageId: string;
  chatId: string;
  fragmentsCount: number;
};

/**
 * Кластеры, подсвеченные на тексте облачка в режиме фрагментов. Грузятся
 * только при входе в режим — облачка списка их не спрашивают. Пока человек
 * выделяет текст, подсветки нет; пока выделяет или держит открытой панель,
 * пересчёт её не перестраивает — новое ляжет после. При входе в режим —
 * событие показа, одно на вход.
 */
export function useClusterHighlight({ rowKey, ref, text, messageId, chatId, fragmentsCount }: Options) {
  const active = useFragmentModeActive(rowKey);
  const selecting = useRowHasSelection(rowKey ?? '');
  const panelOpen = useCommentsPanelTarget() !== null;
  const { data } = useMessageClusters(active ? { id: messageId, chatId, text, fragmentsCount } : null);
  const [geometry, setGeometry] = useState<TextGeometry | null>(null);
  const [shown, setShown] = useState<FragmentCluster[]>(NONE);
  const reportedRef = useRef(false);

  if (!selecting && !panelOpen && data && data !== shown) setShown(data);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    void measureText(ref.current).then((measured) => {
      if (!cancelled && measured?.text === text) setGeometry(measured);
    });

    return () => {
      cancelled = true;
    };
  }, [active, ref, text]);

  const ready = active && geometry !== null && geometry.text === text;

  useEffect(() => {
    if (!active) {
      reportedRef.current = false;
      return;
    }

    if (!ready || reportedRef.current || shown.length === 0) return;

    reportedRef.current = true;
    trackClusterEvent({
      kind: 'clusters_shown',
      messageId,
      decisionId: shown[0].decisionId,
      detail: { clusters: shown.length },
    });
  }, [active, messageId, ready, shown]);

  return {
    geometry: ready ? geometry : null,
    clusters: ready && !selecting ? shown : NONE,
  };
}
