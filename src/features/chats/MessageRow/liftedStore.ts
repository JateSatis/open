import { create } from 'zustand';

/**
 * Какое сообщение сейчас поднято над затемнением меню. Отдельный стор, а не
 * проп из экрана: открытие и закрытие меню перерисовывает две строки, а не
 * весь список, — иначе окно меню закрывается с заметной задержкой и глотает
 * касания, сделанные сразу после выбора пункта.
 */
const useLifted = create<{ messageId: string | null }>(() => ({ messageId: null }));

export function setLiftedMessage(messageId: string | null) {
  useLifted.setState({ messageId });
}

export function useIsLifted(messageId: string): boolean {
  return useLifted((state) => state.messageId === messageId);
}
