import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from './styles';

import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import type { InAppAlert } from '@/features/notifications/alertsStore';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

/** Сколько карточка висит, если её не трогают. */
const VISIBLE_MS = 4500;
/** Короткий ответ на действие читается за секунду — дольше он только мешает. */
const NOTICE_VISIBLE_MS = 2000;
/** Фраза с действием («Повторить») — дольше: её надо прочитать и успеть нажать. */
const ACTION_VISIBLE_MS = 8000;
const SLIDE_MS = 220;

export type ToastCardProps = {
  alert: InAppAlert | null;
  dismiss: () => void;
};

/**
 * Сама карточка: о новом сообщении, заявке или короткий ответ на действие
 * («Скопировано»). Откуда брать карточку, решает обёртка — корневая
 * (`InAppMessageToast`) или внутри своего окна (`InAppNoticeToast`).
 */
export function ToastCard({ alert, dismiss }: ToastCardProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
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

    // На кнопку фразы с действием нужно успеть нажать: за ней — несохранённая работа.
    const visibleMs =
      alert.kind !== 'notice' ? VISIBLE_MS : alert.action ? ACTION_VISIBLE_MS : NOTICE_VISIBLE_MS;
    const timer = setTimeout(dismiss, visibleMs);

    return () => clearTimeout(timer);
  }, [alert, dismiss, slide]);

  if (!alert) return null;

  const slideStyle = {
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
  };
  const cardColors = { backgroundColor: theme.backgroundElement, borderColor: theme.border };

  if (alert.kind === 'notice') {
    const { action } = alert;

    return (
      <Animated.View style={[styles.wrapper, styles.noticeWrapper, slideStyle]}>
        <Pressable
          accessibilityRole="alert"
          onPress={dismiss}
          style={[styles.card, styles.notice, cardColors]}
        >
          <Text variant="small" color={alert.tone === 'error' ? 'danger' : 'text'}>
            {alert.text}
          </Text>

          {action ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={Spacing.two}
              onPress={() => {
                dismiss();
                action.run();
              }}
            >
              <Text variant="smallBold" color="primary">
                {action.label}
              </Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Animated.View>
    );
  }

  const open = () => {
    dismiss();
    // Заявка открывает сам чат: его можно прочитать и там же принять.
    router.push(`/chats/${alert.chatId}`);
  };

  const who = alert.kind === 'message' ? alert.authorName : alert.inviterName;
  const what =
    alert.kind === 'message'
      ? (alert.text ?? 'Вложение')
      : alert.chatTitle
        ? `Зовёт вас в чат «${alert.chatTitle}»`
        : 'Зовёт вас в чат';

  return (
    <Animated.View style={[styles.wrapper, slideStyle]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          alert.kind === 'message' ? `Новое сообщение от ${who}` : `Заявка в чат от ${who}`
        }
        onPress={open}
        style={[styles.card, cardColors]}
      >
        <Avatar uri={null} name={who} size={Spacing.five} />

        <View style={styles.body}>
          <Text variant="smallBold" numberOfLines={1}>
            {who}
          </Text>
          <Text variant="small" color="textSecondary" numberOfLines={2}>
            {what}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}
