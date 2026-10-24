import { useIsFocused, useNavigation } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable } from 'react-native';

import type { SavedMessage } from '@/api/saved';
import { Text } from '@/components/Text';
import { Spacing } from '@/theme';

const TITLE = 'Сохранённые сообщения';

/**
 * Выбор записей на «Все», как в чате: хранятся id, удалённое тихо выпадает,
 * снятие последней отметки выключает выбор. Шапка в выборе — «Выбрано: N» и
 * «Отмена», системный «назад» снимает выбор, а не уводит с экрана.
 */
export function useSavedSelection(items: readonly SavedMessage[]) {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const navigation = useNavigation();
  const focused = useIsFocused();

  // По порядку на экране: сверху вниз — от старых к новым.
  const selected = useMemo(
    () =>
      ids.size === 0
        ? []
        : items.filter((saved) => ids.has(saved.id)).sort((a, b) => a.seq - b.seq),
    [ids, items],
  );
  const active = selected.length > 0;

  const start = useCallback((id: string) => setIds(new Set([id])), []);
  const clear = useCallback(() => setIds(new Set()), []);
  const toggle = useCallback(
    (id: string) =>
      setIds((current) => {
        const next = new Set(current);

        if (next.has(id)) next.delete(id);
        else next.add(id);

        return next;
      }),
    [],
  );
  const isSelected = useCallback((id: string) => ids.has(id), [ids]);

  useLayoutEffect(() => {
    navigation.setOptions(
      active
        ? {
            title: `Выбрано: ${selected.length}`,
            headerBackVisible: false,
            gestureEnabled: false,
            headerRight: () => (
              <Pressable
                testID="saved-selection-cancel"
                accessibilityRole="button"
                onPress={clear}
                hitSlop={Spacing.two}
              >
                <Text color="primary">Отмена</Text>
              </Pressable>
            ),
          }
        : { title: TITLE, headerBackVisible: true, gestureEnabled: true, headerRight: undefined },
    );
  }, [active, clear, navigation, selected.length]);

  useEffect(() => {
    if (!active || !focused) return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      clear();
      return true;
    });

    return () => subscription.remove();
  }, [active, clear, focused]);

  return { active, selected, isSelected, start, toggle, clear };
}
