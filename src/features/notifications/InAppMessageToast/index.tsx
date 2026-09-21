import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from './styles';

import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { useIncomingMessageAlerts } from '@/features/notifications/useIncomingMessageAlerts';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

/** Сколько карточка висит, если её не трогают. */
const VISIBLE_MS = 4500;
const SLIDE_MS = 220;

/**
 * Карточка о новом сообщении поверх любого экрана. Живёт в корневом layout,
 * потому что уведомление не принадлежит ни одной вкладке.
 */
export function InAppMessageToast() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { alert, dismiss } = useIncomingMessageAlerts();
  // Встроенная анимация вместо Reanimated: карточка выезжает один раз и не
  // требует worklet-потока, зато работает в тестах без отдельного мока.
  // Значение живёт в состоянии, а не в ref: его читает и рендер тоже.
  const [slide] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!alert) return;

    slide.setValue(0);
    Animated.timing(slide, {
      toValue: 1,
      duration: SLIDE_MS,
      useNativeDriver: true,
    }).start();

    const timer = setTimeout(dismiss, VISIBLE_MS);

    return () => clearTimeout(timer);
  }, [alert, dismiss, slide]);

  if (!alert) return null;

  const open = () => {
    dismiss();
    router.push(`/chats/${alert.chatId}`);
  };

  return (
    <Animated.View
      style={[
        styles.wrapper,
        {
          top: insets.top + Spacing.two,
          opacity: slide,
          transform: [
            {
              translateY: slide.interpolate({
                inputRange: [0, 1],
                outputRange: [-Spacing.five, 0],
              }),
            },
          ],
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Новое сообщение от ${alert.authorName}`}
        onPress={open}
        style={[
          styles.card,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        ]}
      >
        <Avatar uri={null} name={alert.authorName} size={Spacing.five} />

        <View style={styles.body}>
          <Text variant="smallBold" numberOfLines={1}>
            {alert.authorName}
          </Text>
          <Text variant="small" color="textSecondary" numberOfLines={2}>
            {alert.text ?? 'Вложение'}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}
