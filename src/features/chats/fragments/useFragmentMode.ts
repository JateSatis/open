import { useCallback, useEffect } from 'react';
import { BackHandler } from 'react-native';

import { contentOf, type BubbleRow } from '@/features/chats/islands/rows';
import { canEnterFragmentMode } from '@/features/chats/fragments/fragmentRules';
import { beginTextSelection, type RowPoint } from '@/features/chats/fragments/fragmentSelection';
import {
  clearTextSelection,
  exitFragmentMode,
  getFragmentState,
  toggleFragmentMode,
  useFragmentActiveKey,
} from '@/features/chats/fragments/fragmentStore';

type Options = {
  /** Я участник этого чата (у постов канала — публикую в нём). */
  isMember: boolean;
  /** Экран на виду: ушли с него — режим выключается. */
  isFocused: boolean;
  /** Идёт выбор сообщений — режим фрагментов ему уступает. */
  isSelecting: boolean;
};

/**
 * Режим фрагментов на экране переписки: тап по облачку входит в режим или
 * выходит из него, долгое нажатие в режиме начинает выделение. В режиме не
 * больше одного облачка; прокрутка его не снимает, уход с экрана и выбор
 * сообщений — снимают.
 */
export function useFragmentMode({ isMember, isFocused, isSelecting }: Options) {
  const activeKey = useFragmentActiveKey();

  useEffect(() => {
    if (!isFocused || isSelecting) exitFragmentMode();
  }, [isFocused, isSelecting]);

  useEffect(() => () => exitFragmentMode(), []);

  // «Назад» сначала снимает выделение, потом выходит из режима, и только
  // потом — из чата.
  useEffect(() => {
    if (!activeKey) return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (getFragmentState().selection) clearTextSelection();
      else exitFragmentMode();

      return true;
    });

    return () => subscription.remove();
  }, [activeKey]);

  const pressRow = useCallback(
    (row: BubbleRow) => {
      const message = contentOf(row);

      if (!message) return;

      const { activeKey: current, selection } = getFragmentState();

      // Тап мимо выделения снимает его, режим остаётся.
      if (current === row.key && selection) {
        clearTextSelection();
        return;
      }

      // Облачко островка — по участию в чате оригинала: там его текст.
      const isViewer =
        row.type === 'island-item' ? !(row.item.original?.chat?.amMember ?? false) : !isMember;

      if (current !== row.key && !canEnterFragmentMode({ message, isViewer, hasVisibleCluster: false })) {
        return;
      }

      toggleFragmentMode(row.key);
    },
    [isMember],
  );

  const longPressAt = useCallback(
    (rowKey: string, point: RowPoint): boolean | Promise<boolean> =>
      getFragmentState().activeKey === rowKey ? beginTextSelection(rowKey, point) : false,
    [],
  );

  return { pressRow, longPressAt };
}
