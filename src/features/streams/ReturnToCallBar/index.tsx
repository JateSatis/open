import { usePathname, useRouter } from 'expo-router';
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

/** Звонок свёрнут: полоса видна на любом экране, кроме самого экрана звонка. */
export function useReturnBarVisible(): boolean {
  const call = useActiveCall();
  const pathname = usePathname();

  return call !== null && pathname !== '/call';
}

function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;

    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [active]);

  return now;
}

/**
 * «Вернуться к звонку» над любым экраном, пока звонок свёрнут. Стоит над
 * навигатором и сдвигает его вниз (см. корневой layout), а не перекрывает
 * шапку: иначе под полосой прятались бы «назад» и заголовок.
 */
export function ReturnToCallBar() {
  const call = useActiveCall();
  const visible = useReturnBarVisible();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const now = useTicker(visible);

  if (!visible || !call) return null;

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
      onPress={() => router.push('/call')}
      style={[styles.bar, { backgroundColor: theme.callBar, paddingTop: insets.top }]}
    >
      <View style={styles.row}>
        <SymbolView
          name={{ ios: 'phone.fill', android: 'call', web: 'call' }}
          size={Sizes.callIcon}
          tintColor={theme.textOnMedia}
        />
        <Text variant="smallBold" color="textOnMedia" numberOfLines={1} style={styles.title}>
          Вернуться к звонку · {call.chatTitle}
        </Text>
        <Text variant="small" color="textOnMedia">
          {state}
        </Text>
      </View>
    </Pressable>
  );
}
