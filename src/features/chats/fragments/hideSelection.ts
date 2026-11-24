import { requestClient } from '@/api/requestClient';
import type { QueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { setMessageHidden } from '@/api/chats';
import { confirm } from '@/components/ConfirmDialog';
import type { TextSelection } from '@/features/chats/fragments/fragmentStore';
import { selectableTextOf } from '@/features/chats/fragments/selectableTexts';
import { toServerRange } from '@/features/chats/fragments/textOffsets';
import { coveredByHidden, overlapsHidden } from '@/features/chats/hiddenText';
import { refreshEditedMessages } from '@/features/chats/messages/sync';

/**
 * Что можно сделать со скрытием у выделенного куска:
 * - `hide` / `show` — сообщение моё: скрыть кусок от зрителей или показать;
 * - `blocked` — я зритель, а кусок задевает скрытое: выделять его нельзя
 *   (откажет и база);
 * - `none` — скрытие тут ни при чём.
 */
export type HiddenAction = 'hide' | 'show' | 'blocked' | 'none';

export function hiddenActionFor(selection: TextSelection): HiddenAction {
  const entry = selectableTextOf(selection.rowKey);
  const ranges = entry?.hiddenRanges ?? [];
  const range = toServerRange(selection.text, selection.start, selection.end);

  if (entry?.canHide) return coveredByHidden(ranges, range.start, range.end) ? 'show' : 'hide';
  if (!selection.amMember && overlapsHidden(ranges, range.start, range.end)) return 'blocked';

  return 'none';
}

/**
 * Скрыть выделенное от зрителей или показать снова. Перед скрытием — честно:
 * кто уже прочитал, мог запомнить. Сообщение перечитывается сразу, не
 * дожидаясь сигнала из топика.
 */
export async function toggleHiddenSelection(
  queryClient: QueryClient,
  selection: TextSelection,
  hide: boolean,
  api = requestClient(),
): Promise<void> {
  if (hide) {
    const confirmed = await confirm({
      title: 'Скрыть от зрителей?',
      message:
        'Участники чата по-прежнему видят всё, остальные — замазку. Кто уже прочитал, мог запомнить.',
      confirmLabel: 'Скрыть',
      cancelLabel: 'Отмена',
    });

    if (!confirmed) return;
  }

  const range = toServerRange(selection.text, selection.start, selection.end);

  try {
    await setMessageHidden(selection.messageId, range, hide, api);
    await refreshEditedMessages(queryClient, [selection.messageId], api);
  } catch {
    Alert.alert(
      hide ? 'Не получилось скрыть' : 'Не получилось показать',
      'Проверьте соединение и попробуйте ещё раз.',
    );
  }
}
