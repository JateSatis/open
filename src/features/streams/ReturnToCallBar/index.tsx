import { usePathname, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useActiveCall } from '@/features/streams/callStore';
import { formatCallTimer } from '@/features/streams/callText';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

/**
 * Высота строки полосы без отступа под строку состояния. Её меряет сама
 * полоса: высота текста зависит от системного размера шрифта.
 */
const useRowHeight = create<{ height: number }>(() => ({ height: 0 }));

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

/**
 * Навигатор под полосой: сдвинут вниз ровно на высоту её строки. Отступ под
 * строку состояния нативные шапки делают сами — он и уходит под полосу,
 * поэтому между полосой и шапкой нет щели, а «назад» и заголовок не спрятаны.
 */
export function BelowReturnBar({ children }: { children: ReactNode }) {
  const visible = useReturnBarVisible();
  const height = useRowHeight((state) => state.height);

  return <View style={[styles.below, { paddingTop: visible ? height : 0 }]}>{children}</View>;
}

/** «Вернуться к звонку» поверх верхнего края любого экрана, пока звонок свёрнут. */
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
      <View
        style={styles.row}
        onLayout={(event) => useRowHeight.setState({ height: event.nativeEvent.layout.height })}
      >
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
