import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from './styles';

import { ConnectionTitle } from '@/features/connection/ConnectionTitle';
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

/**
 * Шапка страницы, пока её содержимого ещё нет (грузится, не загрузилось):
 * название, а без связи — её состояние, и стрелка, чтобы было куда уйти.
 */
export function PlainPageBar({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <PageBar onBack={onBack}>
      <ConnectionTitle title={title} />
    </PageBar>
  );
}
