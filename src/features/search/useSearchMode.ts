import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { BackHandler, Keyboard } from 'react-native';

export type SearchMode = {
  active: boolean;
  query: string;
  setQuery: (value: string) => void;
  activate: () => void;
  /** «Отмена» и системное «назад»: выйти из поиска, запрос стереть. */
  cancel: () => void;
};

/**
 * Режим поиска над списком «Чатов» и «Ленты»: системное «назад» выходит из
 * поиска, а не из приложения. Шапки у этих экранов нет — строка поиска и так
 * под статус-баром. Состояние — локальное: оно живёт, пока жив экран, и
 * «назад» из открытого чата возвращает в тот же поиск.
 */
export function useSearchMode(): SearchMode {
  const [active, setActive] = useState(false);
  const [query, setQuery] = useState('');

  const activate = useCallback(() => setActive(true), []);
  const cancel = useCallback(() => {
    setActive(false);
    setQuery('');
    // Снимает и фокус с поля: «Отмена» не должна оставлять курсор в нём.
    Keyboard.dismiss();
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!active) return undefined;

      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        cancel();
        return true;
      });

      return () => subscription.remove();
    }, [active, cancel]),
  );

  return { active, query, setQuery, activate, cancel };
}
