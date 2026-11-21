import { useIsFocused, useRouter } from '@/navigation';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useActiveCall } from '@/features/streams/callStore';
import { formatCallTimer } from '@/features/streams/callText';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;

    const tick = () => setNow(Date.now());
    // Полоса могла долго быть скрытой — время берём заново сразу, а не через секунду.
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);

    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active]);

  return now;
}

export function ReturnToCallBar({ topInset = false }: { topInset?: boolean }) {
  const call = useActiveCall();
  const focused = useIsFocused();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const now = useTicker(!!call && focused);

  if (!call) return null;

  const state =
    call.connection === 'connecting'
      ? 'Подключение…'
      : call.connection === 'reconnecting'
        ? 'Переподключение…'
        : formatCallTimer(now - call.joinedAt);

  return (
    <Pressable
      testID="return-to-call"
      accessibilityRole="button"
      accessibilityLabel={`Вернуться к звонку в «${call.chatTitle}»`}
      onPress={() => router.push({ name: 'Call' })}
      style={[styles.bar, { backgroundColor: theme.callBar, paddingTop: topInset ? insets.top : 0 }]}
    >
      <View style={styles.row}>
        <SymbolView
          name={{ ios: 'phone.fill', android: 'call', web: 'call' }}
          size={Sizes.callIcon}
          tintColor={theme.textOnMedia}
        />
        <Text variant="smallBold" color="textOnMedia" style={styles.title}>
          Вернуться к звонку · {call.chatTitle}
        </Text>
        <Text variant="small" color="textOnMedia">
          {state}
        </Text>
      </View>
    </Pressable>
  );
}
