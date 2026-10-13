import { createContext, useContext } from 'react';
import type { SharedValue } from 'react-native-reanimated';

import type { InfoGeometry } from './geometry';

/** Список вкладки — как его видит страница: где он сейчас и как его сдвинуть. */
export type InfoTabListHandle = {
  offset: SharedValue<number>;
  scrollTo: (y: number, animated: boolean) => void;
};

/**
 * Общая прокрутка страницы. Шапку ведёт смещение активной вкладки (`scrollY`);
 * у каждой вкладки свой список, и при переключении соседние подтягиваются к
 * шапке, чтобы она не прыгнула.
 */
export type InfoScroll = {
  geometry: InfoGeometry;
  /** Смещение, на котором полоса вкладок прилипает под панелью. */
  stickY: number;
  /** С этой высоты в списке вкладки начинается её содержимое. */
  listTop: number;
  /** Высота окна списка: по ней короткая вкладка добирает высоту до прилипания. */
  viewportHeight: number;
  scrollY: SharedValue<number>;
  activeTab: SharedValue<number>;
  /** Палец на списке. */
  dragging: SharedValue<boolean>;
  /** Фото раскрыто и стоит раскрытым — инерция его не открывает и не закрывает. */
  expanded: SharedValue<boolean>;
  register: (tab: number, handle: InfoTabListHandle) => () => void;
  /** Откуда начать только что смонтированный список вкладки. */
  initialOffset: () => number;
  /** Список активной вкладки остановился: довести шапку и подтянуть соседей. */
  onSettle: (tab: number, y: number) => void;
  onDragStart: () => void;
  /** Палец пересёк порог раскрытия фото — короткая вибрация. */
  onThreshold: () => void;
};

export const InfoScrollContext = createContext<InfoScroll | null>(null);

export function useInfoScroll(): InfoScroll {
  const value = useContext(InfoScrollContext);

  if (!value) throw new Error('Список вкладки рисуется только внутри InfoPage');

  return value;
}
