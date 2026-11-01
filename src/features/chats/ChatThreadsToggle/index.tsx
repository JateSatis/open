import { SymbolView } from 'expo-symbols';
import { Pressable } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing } from '@/theme';

export type ChatThreadsToggleProps = {
  /** Сейчас открыт вид «Треды» — кнопка возвращает в обычный. */
  active: boolean;
  onPress: () => void;
};

const CHAT_THREADS_ICON = { ios: 'bubble.left.and.bubble.right', android: 'forum', web: 'forum' } as const;
const CHAT_ICON = { ios: 'text.bubble', android: 'chat', web: 'chat' } as const;

/**
 * Переключатель вида группы в шапке: в обычном виде — значок тредов, в
 * «Тредах» — значок обычной переписки.
 */
export function ChatThreadsToggle({ active, onPress }: ChatThreadsToggleProps) {
  const theme = useTheme();

  return (
    <Pressable
      testID="chat-threads-toggle"
      accessibilityRole="button"
      accessibilityLabel={active ? 'Обычный вид' : 'Треды'}
      accessibilityState={{ selected: active }}
      hitSlop={Spacing.three}
      onPress={onPress}
    >
      <SymbolView
        name={active ? CHAT_ICON : CHAT_THREADS_ICON}
        size={Sizes.chatThreadToggleIcon}
        tintColor={theme.primary}
      />
    </Pressable>
  );
}
