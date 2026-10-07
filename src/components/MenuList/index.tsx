import type { ComponentProps } from 'react';
import { Pressable } from 'react-native';
import Animated from 'react-native-reanimated';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing } from '@/theme';

/** Пункт всплывающего меню. */
export type MenuAction<Id extends string = string> = {
  id: Id;
  label: string;
  /** Красным — разрушительное действие. */
  destructive?: boolean;
};

export type MenuListProps<Id extends string> = {
  actions: readonly MenuAction<Id>[];
  onSelect: (id: Id) => void;
  testID?: string;
  pointerEvents?: 'auto' | 'none';
  /** Положение и анимация — у владельца меню. */
  style?: ComponentProps<typeof Animated.View>['style'];
};

/** Высота меню из `count` пунктов — чтобы поставить его, не измеряя. */
export function menuListHeight(count: number): number {
  return count * Sizes.menuRowHeight + Spacing.one * 2;
}

/** Плашка с пунктами меню — одна на всплывающие меню приложения. */
export function MenuList<Id extends string>({
  actions,
  onSelect,
  testID,
  pointerEvents,
  style,
}: MenuListProps<Id>) {
  const theme = useTheme();

  return (
    <Animated.View
      testID={testID}
      pointerEvents={pointerEvents}
      style={[styles.menu, { backgroundColor: theme.backgroundElement }, style]}
    >
      {actions.map((action) => (
        <Pressable
          key={action.id}
          accessibilityRole="menuitem"
          accessibilityLabel={action.label}
          onPress={() => onSelect(action.id)}
          style={({ pressed }) => [
            styles.item,
            pressed && { backgroundColor: theme.backgroundSelected },
          ]}
        >
          <Text color={action.destructive ? 'danger' : 'text'} numberOfLines={1}>
            {action.label}
          </Text>
        </Pressable>
      ))}
    </Animated.View>
  );
}
