import { useEffect, useRef, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { MediaLimits } from '@/features/media/constants';
import { RecordButton, useRecordDrag } from '@/features/media/RecordButton';
import { RecordingBar } from '@/features/media/RecordingBar';
import type { LocalMedia } from '@/features/media/types';
import { useHoldToRecord } from '@/features/media/useHoldToRecord';
import { useVoiceRecorder } from '@/features/media/useVoiceRecorder';
import { useTheme } from '@/hooks/use-theme';

export type HoldToRecordRowProps = {
  /** Строка ввода как есть: поле и её кнопки. На время записи её закрывает полоса. */
  children: ReactNode;
  /** Готовое голосовое. Отправка — дело того, кто встроил строку. */
  onSend: (media: LocalMedia) => void;
  /** Идёт запись. Зовётся часто — троттлинг на стороне получателя. */
  onActivity?: () => void;
  /** Кнопка записи есть, но записывать сейчас нельзя. */
  recordDisabled?: boolean;
  /**
   * Кнопка на месте микрофона, пока запись не идёт: «Отправить», когда в поле
   * есть что отправить. Начатая запись доживает до конца — её кнопка не
   * размонтируется, даже если на её место просится другая.
   */
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Строка ввода с кнопкой записи голосового справа (или с `trailing` на её
 * месте). Переиспользуется всюду, где можно ответить голосом: в чате, в
 * комментариях и при правке голосового. Встраивающему не нужно знать ни про жест, ни про
 * рекордер — он получает готовый `LocalMedia`.
 */
export function HoldToRecordRow({
  children,
  onSend,
  onActivity,
  recordDisabled = false,
  trailing,
  style,
}: HoldToRecordRowProps) {
  const theme = useTheme();
  const interruptedRef = useRef<() => void>(() => undefined);
  const recorder = useVoiceRecorder({ onInterrupted: () => interruptedRef.current() });
  const hold = useHoldToRecord({
    recorder,
    maxDurationMs: MediaLimits.voice.maxDurationMs,
    onSend,
    onActivity,
  });
  const drag = useRecordDrag();

  useEffect(() => {
    interruptedRef.current = hold.interrupted;
  }, [hold.interrupted]);

  return (
    <View style={[styles.row, style]}>
      <View style={styles.content}>
        {children}
        {hold.phase === 'idle' ? null : <RecordingBar hold={hold} drag={drag} />}
      </View>

      {/* Идущая запись доживает до конца, даже если кнопка стала неактивной. */}
      {trailing && hold.phase === 'idle' ? (
        trailing
      ) : (
        <RecordButton hold={hold} drag={drag} disabled={recordDisabled && hold.phase === 'idle'} />
      )}

      {hold.notice ? (
        <View
          accessibilityLiveRegion="polite"
          style={[styles.notice, { backgroundColor: theme.backgroundElement }]}
        >
          <Text variant="small">{hold.notice}</Text>
        </View>
      ) : null}
    </View>
  );
}
