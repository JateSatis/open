import { create } from 'zustand';

export type ConfirmDialogOptions = {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Красная кнопка подтверждения — для необратимых или разрушительных действий. */
  destructive?: boolean;
};

type ConfirmDialogRequest = ConfirmDialogOptions & {
  id: number;
  resolve: (confirmed: boolean) => void;
};

type ConfirmDialogState = {
  /** Хвост очереди — приложению редко нужно больше одного диалога разом, но
   * не полагаемся на это: следующий запрос просто ждёт закрытия текущего. */
  queue: ConfirmDialogRequest[];
};

let nextId = 0;

const useConfirmDialogStore = create<ConfirmDialogState>(() => ({ queue: [] }));

/**
 * Императивный аналог `window.confirm`, но асинхронный и с собственной
 * вёрсткой: показывает модальное окно поверх всего приложения и разрешается
 * в `true`, если человек нажал кнопку подтверждения.
 *
 * Один диалог на всё приложение — переиспользуется вместо того, чтобы
 * каждая фича заводила свой `Modal` с похожей версткой.
 */
export function confirm(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const id = nextId++;

    useConfirmDialogStore.setState((state) => ({
      queue: [...state.queue, { ...options, id, resolve }],
    }));
  });
}

export function useConfirmDialogRequest(): ConfirmDialogRequest | null {
  return useConfirmDialogStore((state) => state.queue[0] ?? null);
}

export function resolveConfirmDialog(id: number, confirmed: boolean) {
  const request = useConfirmDialogStore.getState().queue.find((item) => item.id === id);

  request?.resolve(confirmed);

  useConfirmDialogStore.setState((state) => ({
    queue: state.queue.filter((item) => item.id !== id),
  }));
}

/** Только для тестов: не даёт неотвеченному запросу одного теста утечь в следующий. */
export function resetConfirmDialogQueue() {
  useConfirmDialogStore.setState({ queue: [] });
}
