import { useIsFocused, useNavigation } from '@/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
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
/**
 * `active` — вкладка видна: ушли на другую — выбор снимается, шапка и «назад»
 * были бы про невидимое. `idleHeaderRight` — что справа в шапке вне выбора
 * (поиск и фильтры экрана): шапкой владеет этот хук, иначе выбор и экран
 * перебивали бы друг друга.
 */
export function useSavedSelection(
  items: readonly SavedMessage[],
  active = true,
  idleHeaderRight?: () => ReactNode,
) {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const [wasActive, setWasActive] = useState(active);

  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setIds(new Set());
  }
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
  const selecting = selected.length > 0;

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
      selecting
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
        : {
            title: TITLE,
            headerBackVisible: true,
            gestureEnabled: true,
            headerRight: idleHeaderRight,
          },
    );
  }, [clear, idleHeaderRight, navigation, selected.length, selecting]);

  useEffect(() => {
    if (!selecting || !focused) return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      clear();
      return true;
    });

    return () => subscription.remove();
  }, [clear, focused, selecting]);

  return { active: selecting, selected, isSelected, start, toggle, clear };
}
