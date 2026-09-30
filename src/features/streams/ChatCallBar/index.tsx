import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { LiveStream } from '@/api/streams';
import { Text } from '@/components/Text';
import { callBarLabel } from '@/features/streams/callText';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export type ChatCallBarProps = {
  stream: LiveStream | null;
  /** Я уже в этом звонке — полоса возвращает на экран звонка. */
  isInThisCall: boolean;
  /** Участник войдёт говорящим, посетитель — слушателем. */
  isMember: boolean;
  onPress: () => void;
};

/**
 * Полоса под шапкой чата, пока в нём идёт звонок: сколько в звонке и сколько
 * слушают. Для посетителя это главный путь в эфир — полоса видна ему так же,
 * как участнику, и тап подключает слушателем.
 */
export function ChatCallBar({ stream, isInThisCall, isMember, onPress }: ChatCallBarProps) {
  const theme = useTheme();

  if (!stream) return null;

  const action = isInThisCall ? 'Вернуться' : isMember ? 'Войти' : 'Слушать';

  return (
    <Pressable
      testID="chat-call-bar"
      accessibilityRole="button"
      accessibilityLabel={`${callBarLabel(stream.speakersCount, stream.listenersCount)}. ${action}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.bar,
        { backgroundColor: theme.callBar, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <SymbolView
        name={{ ios: 'phone.fill', android: 'call', web: 'call' }}
        size={Sizes.callIcon}
        tintColor={theme.textOnMedia}
      />

      <View style={styles.body}>
        <Text variant="smallBold" color="textOnMedia" numberOfLines={1}>
          {callBarLabel(stream.speakersCount, stream.listenersCount)}
        </Text>
      </View>

      <View style={styles.action}>
        <Text variant="smallBold" style={{ color: theme.callBar }}>
          {action}
        </Text>
      </View>
    </Pressable>
  );
}
