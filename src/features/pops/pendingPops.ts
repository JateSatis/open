// Попсы в пути: публикация уже начата, база ещё не ответила или отказала.
// Клиентское состояние, как исходящие сообщения (`outbox.ts`), поэтому в
// Zustand: в кеш запросов поп попадает только с ответом базы. Модуль без
// обращений к API — его сбрасывает выход из аккаунта.

import { create } from 'zustand';

import type { LocalMedia, UploadedMedia } from '@/features/media/types';

export type NewPop = {
  channelId: string;
  /** Видео с устройства: путь, размеры по кадру, длительность. */
  media: LocalMedia;
  /** Кадр видео на устройстве — обложка плитки, пока поп едет. */
  posterUri: string;
  caption: string | null;
  /** Заодно пост с этим попом; текст поста — копия подписи. */
  alsoPost: boolean;
};

export type PendingPop = NewPop & {
  localId: string;
  /** Выбран заранее: повтор отдаёт уже созданный поп, а не второй. */
  popId: string;
  status: 'publishing' | 'failed';
  /** Файлы уже в Storage — повтор их не льёт заново. */
  uploaded: UploadedMedia | null;
  /**
   * Ответа базы не дождались: поп мог и создаться. Такие файлы при отказе от
   * плитки не удаляются — битый поп хуже лишнего файла.
   */
  uncertain: boolean;
};

type PendingState = { byChannel: Record<string, PendingPop[]> };

const EMPTY: PendingPop[] = [];

const usePendingStore = create<PendingState>(() => ({ byChannel: {} }));

export function setChannel(channelId: string, change: (pops: PendingPop[]) => PendingPop[]) {
  usePendingStore.setState((state) => {
    const next = change(state.byChannel[channelId] ?? EMPTY);
    const byChannel = { ...state.byChannel };

    if (next.length === 0) delete byChannel[channelId];
    else byChannel[channelId] = next;

    return { byChannel };
  });
}

export function patch(channelId: string, localId: string, change: Partial<PendingPop>) {
  setChannel(channelId, (pops) =>
    pops.map((pop) => (pop.localId === localId ? { ...pop, ...change } : pop)),
  );
}

export function find(channelId: string, localId: string): PendingPop | undefined {
  return usePendingStore.getState().byChannel[channelId]?.find((pop) => pop.localId === localId);
}

/** Попсы канала в пути, новые сначала. */
export function usePendingPops(channelId: string): PendingPop[] {
  return usePendingStore((state) => state.byChannel[channelId] ?? EMPTY);
}

/** Выход из аккаунта: чужие публикации следующему пользователю не нужны. */
export function resetPendingPops() {
  usePendingStore.setState({ byChannel: {} });
}
