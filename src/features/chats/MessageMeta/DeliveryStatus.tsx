import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing, type ThemeColor } from '@/theme';

/** Что с моим сообщением: едет, доехало, его прочли или оно не ушло. */
export type DeliveryState = 'sending' | 'sent' | 'read' | 'failed';

export type DeliveryStatusProps = {
  state: DeliveryState;
  /** Цвет галочек и лоадера — тот же, что у времени. */
  tone: ThemeColor;
  /** Тап по значку ошибки. Нет — значок не нажимается (копия облачка). */
  onRetry?: () => void;
};

/**
 * Иконка статуса справа от времени, как в Telegram. Место у неё одно во всех
 * состояниях: лоадер сменяется галочкой, а облачко не меняет ширину.
 */
export function DeliveryStatus({ state, tone, onRetry }: DeliveryStatusProps) {
  const theme = useTheme();
  const tint = theme[tone];

  if (state === 'failed') {
    return (
      <Pressable
        testID="message-retry"
        accessibilityRole="button"
        accessibilityLabel="Не отправлено. Повторить"
        disabled={!onRetry}
        hitSlop={Spacing.two}
        onPress={onRetry}
        style={styles.status}
      >
        {/* Сплошной круг, а не значок-контур: красная линия тонет на синем
            своём облачке, а залитый круг читается на любом фоне. */}
        <View style={[styles.failed, { backgroundColor: theme.danger }]}>
          <Text variant="meta" color="primaryText" style={styles.failedMark}>
            !
          </Text>
        </View>
      </Pressable>
    );
  }

  return (
    <View
      testID={`message-status-${state}`}
      accessible
      accessibilityLabel={LABELS[state]}
      style={styles.status}
    >
      {state === 'sending' ? (
        <ActivityIndicator size="small" color={tint} style={styles.spinner} />
      ) : state === 'sent' ? (
        <Check tint={tint} />
      ) : Platform.OS === 'ios' ? (
        // В SF Symbols двойной галочки нет — две одинарные внахлёст.
        <View style={styles.doubleCheck}>
          <Check tint={tint} />
          <View style={styles.secondCheck}>
            <Check tint={tint} />
          </View>
        </View>
      ) : (
        <SymbolView
          name={{ ios: 'checkmark', android: 'done_all', web: 'done_all' }}
          size={Sizes.deliveryStatusIcon}
          tintColor={tint}
        />
      )}
    </View>
  );
}

const LABELS: Record<Exclude<DeliveryState, 'failed'>, string> = {
  sending: 'Отправляется',
  sent: 'Отправлено',
  read: 'Прочитано',
};

function Check({ tint }: { tint: string }) {
  return (
    <SymbolView
      name={{ ios: 'checkmark', android: 'done', web: 'done' }}
      size={Sizes.deliveryStatusIcon}
      tintColor={tint}
    />
  );
}
