import { useMemo } from 'react';
import { View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import type { SharedValue } from 'react-native-reanimated';

import { CommentList, type CommentListProps } from './CommentList';
import { CommentsSheetContext, type CommentsSheetContextValue } from './SheetList';
import { styles } from './styles';
import type { SheetPane } from './usePanelSheet';

export type PaneListProps = CommentListProps & {
  pane: SheetPane;
  dismissing: SharedValue<boolean>;
};

/**
 * Список шита со своим жестом закрытия: шит тянет тот список, на котором
 * палец, и только когда он докручен до верха.
 */
export function PaneList({ pane, dismissing, ...list }: PaneListProps) {
  const { animatedRef, scrollGestureRef, scrollOffset, markScrollAttached, dismissPan } = pane;
  const context = useMemo<CommentsSheetContextValue>(
    () => ({
      animatedRef,
      gestureRef: scrollGestureRef,
      scrollOffset,
      dismissing,
      onScrollAttached: markScrollAttached,
    }),
    [animatedRef, dismissing, markScrollAttached, scrollGestureRef, scrollOffset],
  );

  return (
    <GestureDetector gesture={dismissPan}>
      <View style={styles.fill}>
        <CommentsSheetContext.Provider value={context}>
          <CommentList {...list} />
        </CommentsSheetContext.Provider>
      </View>
    </GestureDetector>
  );
}
