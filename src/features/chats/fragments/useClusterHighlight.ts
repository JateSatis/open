import { useEffect, useRef, useState } from 'react';
import type { Text } from 'react-native';

import { measureText, type TextGeometry } from '../../../../modules/text-geometry';

import { trackClusterEvent } from '@/api/fragmentClusterEvents';
import type { FragmentCluster } from '@/api/fragmentClusters';
import { useFragmentModeActive, useRowHasSelection } from '@/features/chats/fragments/fragmentStore';
import { useMessageClusters } from '@/features/chats/fragments/useMessageClusters';
import { useCommentsPanelTarget } from '@/features/interactions/comments/commentsPanelStore';

const NONE: FragmentCluster[] = [];

/** Сколько кадров ждать раскладки текста, прежде чем остаться без подсветки. */
const MEASURE_ATTEMPTS = 20;

type Options = {
  rowKey: string | undefined;
  ref: { current: Text | null };
  text: string;
  messageId: string;
  chatId: string;
  clustersCount: number;
};

/**
 * Кластеры, подсвеченные на тексте облачка в режиме фрагментов. Грузятся
 * только при входе в режим — облачка списка их не спрашивают. Пока человек
 * выделяет текст, подсветки нет; пока выделяет или держит открытой панель,
 * пересчёт её не перестраивает — новое ляжет после. При входе в режим —
 * событие показа, одно на вход.
 */
export function useClusterHighlight({ rowKey, ref, text, messageId, chatId, clustersCount }: Options) {
  const active = useFragmentModeActive(rowKey);
  const selecting = useRowHasSelection(rowKey ?? '');
  const panelOpen = useCommentsPanelTarget() !== null;
  const { data } = useMessageClusters(active ? { id: messageId, chatId, text, clustersCount } : null);
  const [geometry, setGeometry] = useState<TextGeometry | null>(null);
  // Смонтировалось при открытой панели — показываем то, что уже есть в кеше.
  const [shown, setShown] = useState<FragmentCluster[]>(data ?? NONE);
  const reportedRef = useRef(false);

  if (!selecting && !panelOpen && data && data !== shown) setShown(data);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let frame: number | null = null;
    let attempts = 0;

    // Текст в режиме монтируется заново, и первый замер может прийти раньше
    // его раскладки — тогда пробуем на следующих кадрах.
    const measure = () => {
      frame = null;
      attempts += 1;
      void measureText(ref.current).then((measured) => {
        if (cancelled) return;
        if (measured?.text === text && measured.lines.length > 0) setGeometry(measured);
        else if (attempts < MEASURE_ATTEMPTS) frame = requestAnimationFrame(measure);
      });
    };

    measure();

    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
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
