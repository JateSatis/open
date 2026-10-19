import { createContext, useCallback, useContext } from 'react';
import { useWindowDimensions } from 'react-native';
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
  register: (tab: number, handle: InfoTabListHandle) => () => void;
  /** Откуда начать только что смонтированный список вкладки. */
  initialOffset: () => number;
  /** Список активной вкладки остановился: довести шапку и подтянуть соседей. */
  onSettle: (tab: number, y: number) => void;
  onDragStart: () => void;
};

export const InfoScrollContext = createContext<InfoScroll | null>(null);

/**
 * Где на экране видно содержимое вкладок: ниже полосы вкладок, до низа
 * окна. Полоса едет вместе со списком, пока не прилипнет под панелью.
 */
export function useInfoTabsViewport(): () => { x: number; y: number; width: number; height: number } {
  const { listTop, stickY, scrollY } = useInfoScroll();
  const { width, height } = useWindowDimensions();

  return useCallback(() => {
    const top = listTop - Math.min(scrollY.value, stickY);

    return { x: 0, y: top, width, height: height - top };
  }, [height, listTop, scrollY, stickY, width]);
}

export function useInfoScroll(): InfoScroll {
  const value = useContext(InfoScrollContext);

  if (!value) throw new Error('Список вкладки рисуется только внутри InfoPage');

  return value;
}
