import { memo } from 'react';
import { View } from 'react-native';

import type { PopCell, PopGridGeometry } from './geometry';
import { AddPopTile, PendingPopTile, PublishedPopTile } from './PopTile';
import { styles } from './styles';

import type { Pop } from '@/api/pops';
import type { PendingPop } from '@/features/pops/publishing';

/** Что умеют плитки одной сетки. Объект должен быть стабильным: он уходит в мемо-строки. */
export type PopGridActions = {
  onAdd: () => void;
  /** Подпись под «+» — в шите. */
  addLabel?: string;
  onPop?: (pop: Pop) => void;
  /** Попсы нельзя взять (в посте уже выбраны фото или видео). */
  popsDisabled?: boolean;
  showDuration?: boolean;
  onRetry: (pending: PendingPop) => void;
  onDiscard: (pending: PendingPop) => void;
};

export type PopGridRowProps = {
  cells: PopCell[];
  geometry: PopGridGeometry;
  actions: PopGridActions;
};

/** Строка сетки попсов: плитки на позициях из `popGridGeometry`. */
export const PopGridRow = memo(function PopGridRow({ cells, geometry, actions }: PopGridRowProps) {
  const { cellWidth, cellHeight, rowPitch, columnLeft } = geometry;

  return (
    <View style={{ height: rowPitch }}>
      {cells.map((cell, column) => (
        <View
          key={column}
          style={[styles.cell, { left: columnLeft[column], width: cellWidth, height: cellHeight }]}
        >
          {cell.type === 'add' ? (
            <AddPopTile label={actions.addLabel} onPress={actions.onAdd} />
          ) : cell.type === 'pending' ? (
            <PendingPopTile
              pending={cell.pending}
              onRetry={actions.onRetry}
              onDiscard={actions.onDiscard}
            />
          ) : (
            <PublishedPopTile
              pop={cell.pop}
              onPress={actions.onPop}
              disabled={actions.popsDisabled}
              showDuration={actions.showDuration}
            />
          )}
        </View>
      ))}
    </View>
  );
});
