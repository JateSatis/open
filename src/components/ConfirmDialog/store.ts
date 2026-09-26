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
  /**
   * Места, где диалог может быть нарисован, кроме корневого. Появляются,
   * когда на экране есть своё нативное окно (`Modal`) — например, шит выбора
   * медиа, — и вопрос должен появиться внутри него.
   */
  hosts: number[];
};

let nextId = 0;
let nextHostId = 0;

const useConfirmDialogStore = create<ConfirmDialogState>(() => ({ queue: [], hosts: [] }));

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

/**
 * Отменяет верхний вопрос, если он задан. Нужно системной кнопке «назад»:
 * пока на экране висит вопрос, она отвечает на него, а не закрывает то, что
 * под ним. Возвращает, было ли что отменять.
 */
export function dismissTopConfirmDialog(): boolean {
  const request = useConfirmDialogStore.getState().queue[0];

  if (!request) return false;

  resolveConfirmDialog(request.id, false);

  return true;
}

/**
 * Выдаёт номер месту отрисовки. Только номер и ничего больше: сама
 * регистрация меняет общий стор, а брать её в рендер нельзя — компонент,
 * который рисуется, не должен менять состояние другого по ходу дела.
 */
export function allocateConfirmDialogHostId(): number {
  return nextHostId++;
}

/**
 * Регистрирует место отрисовки внутри чужого окна. Пока такое место есть,
 * корневой хост молчит: иначе вопрос нарисовался бы дважды — и в своём окне,
 * и поверх, — а на Android рождение второго нативного окна `Modal` стоит
 * около 200 мс пропущенных кадров, ровно тех, на которые приходится анимация.
 */
export function registerConfirmDialogHost(id: number) {
  useConfirmDialogStore.setState((state) => ({ hosts: [...state.hosts, id] }));
}

export function releaseConfirmDialogHost(id: number) {
  useConfirmDialogStore.setState((state) => ({
    hosts: state.hosts.filter((host) => host !== id),
  }));
}

/**
 * Рисует ли вопрос именно это место. Корневой хост (`'root'`) уступает
 * любому вложенному; из вложенных рисует последний появившийся. Пока место
 * не зарегистрировалось, его номера в списке нет, и рисует по-прежнему
 * корневой.
 */
export function useIsTopConfirmDialogHost(id: number | 'root'): boolean {
  return useConfirmDialogStore((state) => {
    if (id === 'root') return state.hosts.length === 0;

    return state.hosts[state.hosts.length - 1] === id;
  });
}

/** Только для тестов: не даёт неотвеченному запросу одного теста утечь в следующий. */
export function resetConfirmDialogQueue() {
  useConfirmDialogStore.setState({ queue: [], hosts: [] });
}
