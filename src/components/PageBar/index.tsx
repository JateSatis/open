import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';
import { InfoPageSizes, Shadows, Sizes, Spacing } from '@/theme';

export type PageBarProps = {
  /** Стрелка «назад». Нет — стрелки нет (режим выбора: выход из него — «Отмена»). */
  onBack?: () => void;
  /** Название и подпись — слева, после стрелки. */
  children: ReactNode;
  /** Кнопки справа. */
  right?: ReactNode;
  testID?: string;
};

/**
 * Шапка страницы, которая сама въезжает и уезжает (`SlidePage`): та же, что
 * нативная шапка стека, — фон, высота, стрелка, название с отступа 72 dp, —
 * но часть страницы и едет вместе с ней.
 */
export function PageBar({ onBack, children, right, testID }: PageBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      testID={testID}
      style={[
        styles.bar,
        Shadows.header,
        {
          paddingTop: insets.top,
          height: insets.top + Sizes.headerHeight,
          backgroundColor: theme.headerBackground,
          shadowColor: theme.shadow,
        },
      ]}
    >
      {onBack ? (
        <Pressable
          testID="page-back"
          accessibilityRole="button"
          accessibilityLabel="Назад"
          hitSlop={Spacing.one}
          onPress={onBack}
          style={styles.back}
        >
          <SymbolView
            name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
            size={InfoPageSizes.barIcon}
            tintColor={theme.text}
          />
        </Pressable>
      ) : null}
      <View style={[styles.title, !onBack && styles.titleAlone]}>{children}</View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: Spacing.three,
    zIndex: 1,
  },
  back: {
    width: Sizes.headerButton,
    height: Sizes.headerButton,
    marginLeft: Spacing.one,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Название — с той же линии, что у нативной шапки: стрелка и поле до него.
  title: {
    flex: 1,
    minWidth: 0,
    marginLeft: Sizes.headerTitleLeft - Sizes.headerButton - Spacing.one,
  },
  titleAlone: {
    marginLeft: Spacing.three,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
