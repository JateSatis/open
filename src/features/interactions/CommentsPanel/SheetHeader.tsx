import type { ReactNode } from 'react';
import { View } from 'react-native';
import { GestureDetector, type GestureType } from 'react-native-gesture-handler';

import { styles } from './styles';

import { useTheme } from '@/hooks/use-theme';

export type SheetHeaderProps = {
  onHeight: (height: number) => void;
  /** Жест шапки — тянет шит вниз (`usePanelSheet`). */
  pan: GestureType;
  children: ReactNode;
};

/**
 * Шапка шита — ручка и заголовок — слоем у верха окна списка: комментарии
 * листаются под ней. Касание по ней до списка не доходит, поэтому у неё свой
 * жест.
 */
export function SheetHeader({ onHeight, pan, children }: SheetHeaderProps) {
  const theme = useTheme();

  return (
    <GestureDetector gesture={pan}>
      <View
        testID="comments-sheet-header"
        style={[styles.sheetHeader, { backgroundColor: theme.background }]}
        onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
      >
        {children}
      </View>
    </GestureDetector>
  );
}
