import { useIsFocused } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ChatSearch } from './useChatSearch';

import { BarSearchField } from '@/components/BarSearchField';
import { useTheme } from '@/hooks/use-theme';
import { InfoPageSizes, Spacing } from '@/theme';

/**
 * Поле поиска на месте шапки переписки. Своя вью, а не заголовок стека: в
 * нативной шапке Android не отдаёт полю фокус, и клавиатура не открывалась.
 */
export function ChatSearchHeader({ search, onClose }: { search: ChatSearch; onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Поиск открывают со страницы чата: она ещё уезжает поверх переписки, и
  // фокус поле получит, когда переписка снова станет верхним экраном.
  const isFocused = useIsFocused();

  return (
    <View
      style={[
        styles.bar,
        {
          paddingTop: insets.top,
          height: insets.top + InfoPageSizes.barHeight,
          backgroundColor: theme.background,
          borderBottomColor: theme.border,
        },
      ]}
    >
      <BarSearchField
        testID="chat-search-input"
        value={search.query}
        onChangeText={search.setQuery}
        onClose={onClose}
        placeholder="Поиск по чату"
        focusWhen={isFocused}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.one,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
