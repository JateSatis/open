import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isBubbleRow, type BubbleRow, type ChatListRow } from '@/features/chats/islands/rows';
import { isLocalMessage } from '@/features/chats/messageActions';

export type MessageSelection = {
  /** Режим выбора включён — есть хоть одно отмеченное сообщение. */
  isActive: boolean;
  /** Отмеченные облачка, в порядке переписки: от старого к новому. */
  selected: BubbleRow[];
  isSelected: (rowKey: string) => boolean;
  /** Отмечает первые облачка и тем включает режим выбора. */
  start: (rowKeys: string | string[]) => void;
  /** Снятие последней отметки выключает режим выбора. */
  toggle: (rowKey: string) => void;
  clear: () => void;
};

/**
 * Облачко можно отметить, если оно на сервере. Облачко островка — по одному,
 * как обычное сообщение: заглушку удалённого — только переславшему, чтобы
 * убрать её из островка.
 */
export function isSelectableRow(row: BubbleRow, currentUserId: string | null): boolean {
  if (row.type === 'message') return !isLocalMessage(row.message);
  if (isLocalMessage(row.island)) return false;

  return row.item.original !== null || row.island.authorId === currentUserId;
}

/**
 * Выбор облачков на экране чата. Хранятся только ключи строк: догрузка
 * истории и новые сообщения выбор не трогают, а удалённое (его больше нет в
 * списке) тихо из выбора выпадает — и режим выключается, если выпало всё.
 */
export function useMessageSelection(
  rows: ChatListRow[],
  currentUserId: string | null,
): MessageSelection {
  const [keys, setKeys] = useState<ReadonlySet<string>>(() => new Set());

  // Список новыми вперёд — перевёрнутый он и есть порядок переписки.
  const selected = useMemo(() => {
    if (keys.size === 0) return [];

    return rows
      .filter((row): row is BubbleRow => isBubbleRow(row) && keys.has(row.key))
      .reverse();
  }, [keys, rows]);

  const selectedKeys = useMemo(() => new Set(selected.map((row) => row.key)), [selected]);

  const isSelected = useCallback((rowKey: string) => selectedKeys.has(rowKey), [selectedKeys]);

  // Строки — в ref: переключение не должно зависеть от замыкания строки,
  // которую список ещё не перерисовал, иначе две быстрые отметки подряд
  // теряли бы первую.
  const latestRef = useRef({ rows });

  useEffect(() => {
    latestRef.current = { rows };
  }, [rows]);

  const start = useCallback(
    (rowKeys: string | string[]) =>
      setKeys(new Set(typeof rowKeys === 'string' ? [rowKeys] : rowKeys)),
    [],
  );

  const toggle = useCallback(
    (rowKey: string) => {
      const row = latestRef.current.rows.find((item) => item.key === rowKey);

      // Неотправленное выбрать нельзя: у него нет настоящего id, и ни одно
      // действие панели к нему не применимо.
      if (!row || !isBubbleRow(row) || !isSelectableRow(row, currentUserId)) return;

      setKeys((current) => {
        const present = new Set(latestRef.current.rows.map((item) => item.key));
        // Удалённое без нас выпадает и отсюда, чтобы не всплыть обратно.
        const next = new Set([...current].filter((key) => present.has(key)));

        if (next.has(rowKey)) next.delete(rowKey);
        else next.add(rowKey);

        return next;
      });
    },
    [currentUserId],
  );

  const clear = useCallback(() => setKeys(new Set()), []);

  return { isActive: selected.length > 0, selected, isSelected, start, toggle, clear };
}
