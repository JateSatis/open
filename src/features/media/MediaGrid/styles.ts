import { StyleSheet } from 'react-native';

import { GRID_CELL_PADDING } from './gridLayout';

import { Radii, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  /**
   * Половина зазора у края экрана; вторая половина — внутри крайней клетки.
   * Вертикальных отступов у содержимого нет: начало списка задаёт его шапка,
   * а конец — хвост.
   */
  content: {
    paddingHorizontal: GRID_CELL_PADDING,
  },
  /**
   * Обёртка клетки. Ширину ей задаёт сам список (ширина колонки), высоту —
   * грид: шаг сетки обязан быть одинаковым у всех клеток, иначе список
   * пересчитывает раскладку на ходу.
   */
  cell: {
    padding: GRID_CELL_PADDING,
  },
  /** Серый квадрат на месте ещё не прочитанного файла. */
  skeleton: {
    borderRadius: Radii.none,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  notice: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  noticeText: {
    textAlign: 'center',
  },
});
