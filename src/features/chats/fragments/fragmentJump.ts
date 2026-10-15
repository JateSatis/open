import { create } from 'zustand';

// Переход по цитате фрагмента: панель комментариев закрывается и оставляет
// запрос, экран переписки под ней выполняет его, когда панель закрылась, —
// прокручивает к сообщению и подсвечивает кусок. Запрос — не состояние
// экрана: его забирает первый, кто выполнит.

export type FragmentJump = {
  /** Чат экрана, где открыта панель: выполнить запрос может только он. */
  hostChatId: string | undefined;
  messageId: string;
  /** Чат сообщения; у облачка островка — чат оригинала. */
  chatId: string | undefined;
  /** Строка, у которой открыли панель: в островке одно сообщение бывает дважды. */
  rowKey: string | undefined;
  /** Время сообщения — до него догружается история. */
  createdAt: string;
  /** Цитата и где она сейчас в тексте, в code points. */
  text: string;
  start: number;
  end: number;
  /** Правка унесла кусок: вспыхивает всё сообщение. */
  lost: boolean;
};

const useJumpStore = create<{ jump: FragmentJump | null }>(() => ({ jump: null }));

export function requestFragmentJump(jump: FragmentJump) {
  useJumpStore.setState({ jump });
}

/** Забрать запрос: выполнить его должен один экран и один раз. */
export function takeFragmentJump(): FragmentJump | null {
  const { jump } = useJumpStore.getState();

  if (jump) useJumpStore.setState({ jump: null });

  return jump;
}

export function useFragmentJumpRequested(): boolean {
  return useJumpStore((state) => state.jump !== null);
}
