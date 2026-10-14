import { useNavigation } from 'expo-router';
import { useEffect, type RefObject } from 'react';

import { confirm } from '@/components/ConfirmDialog/store';

/**
 * Уход с несохранённым — только после вопроса. `leaving` — уход уже решён
 * (сохранили или ответили «Выйти»): второй раз не спрашивать.
 */
export function useConfirmLeave(dirty: boolean, leaving: RefObject<boolean>) {
  const navigation = useNavigation();

  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (!dirty || leaving.current) return;

        event.preventDefault();
        void confirm({
          title: 'Отменить изменения?',
          message: 'Новое фото, название, описание и имя не сохранятся.',
          confirmLabel: 'Выйти',
          cancelLabel: 'Остаться',
          destructive: true,
        }).then((confirmed) => {
          if (!confirmed) return;

          leaving.current = true;
          navigation.dispatch(event.data.action);
        });
      }),
    [dirty, leaving, navigation],
  );
}
