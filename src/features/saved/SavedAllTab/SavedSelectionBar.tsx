import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { SavedMessage } from '@/api/saved';
import type { SelectionActionId } from '@/features/chats/messageActions';
import { SelectionActionBar } from '@/features/chats/SelectionActionBar';
import { SAVED_SELECTION_ACTIONS } from '@/features/saved/savedActions';
import { Spacing } from '@/theme';

export type SavedSelectionBarProps = {
  /** Выбранное — по порядку на экране. */
  selected: SavedMessage[];
  onCopy: (items: SavedMessage[]) => void;
  /** Отвечает, открылся ли лист пересылки. */
  onForward: (items: SavedMessage[]) => Promise<boolean>;
  /** Отвечает, подтвердили ли удаление. */
  onDelete: (ids: string[]) => Promise<boolean>;
  /** Действие выполнено — выбор снимается. */
  onDone: () => void;
};

/** Панель выбора «Все» — та же, что в чате: «Переслать», «Копировать», «Удалить». */
export function SavedSelectionBar({
  selected,
  onCopy,
  onForward,
  onDelete,
  onDone,
}: SavedSelectionBarProps) {
  const insets = useSafeAreaInsets();
  const finish = (finished: boolean) => {
    if (finished) onDone();
  };

  const run = (id: SelectionActionId) => {
    if (id === 'copy') {
      onCopy(selected);
      onDone();
    }

    if (id === 'forward') void onForward(selected).then(finish);
    if (id === 'delete') void onDelete(selected.map((item) => item.id)).then(finish);
  };

  return (
    <View style={{ paddingBottom: Math.max(insets.bottom, Spacing.two) }}>
      <SelectionActionBar context={{ selected }} actions={SAVED_SELECTION_ACTIONS} onAction={run} />
    </View>
  );
}
