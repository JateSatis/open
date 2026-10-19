import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { LOCK_DISTANCE, styles } from './styles';
import { useRecordGesture, type RecordGestureAction } from './useRecordGesture';

import { useSlidePageSwipeHold } from '@/components/SlidePage/context';
import type { HoldToRecord } from '@/features/media/useHoldToRecord';
import { useTheme } from '@/hooks/use-theme';
import { ComposerSizes } from '@/theme';

const MIC = { ios: 'mic.fill', android: 'mic', web: 'mic' } as const;
const SEND = { ios: 'arrow.up', android: 'send', web: 'send' } as const;

/**
 * Где палец относительно точки касания, на UI-потоке: за ним едут круг под
 * пальцем, подсказка отмены и замок — кадр в кадр, без круга через JS.
 */
export type RecordDrag = {
  x: SharedValue<number>;
  y: SharedValue<number>;
};

export function useRecordDrag(): RecordDrag {
  return { x: useSharedValue(0), y: useSharedValue(0) };
}

export type RecordButtonProps = {
  hold: HoldToRecord;
  drag: RecordDrag;
  /** Записывать сейчас нельзя — например, в правке, где уже есть текст. */
  disabled?: boolean;
};

/**
 * Кнопка записи — микрофон в круге. Под пальцем во время записи — большой
 * круг с микрофоном, над ним замок; закреплённая запись — со стрелкой
 * «Отправить». Сам жест — в `useRecordGesture`.
 */
export function RecordButton({ hold, drag, disabled = false }: RecordButtonProps) {
  const theme = useTheme();
  const active = hold.phase !== 'idle';
  const locked = hold.phase === 'locked';
  const lockedShared = useSharedValue(false);
  const grow = useSharedValue(0);

  useEffect(() => {
    lockedShared.value = locked;
  }, [locked, lockedShared]);

  useEffect(() => {
    grow.value = withTiming(active ? 1 : 0, { duration: 160 });
  }, [active, grow]);

  // Жест собирается один раз, а действия берутся по ссылке: иначе каждая
  // перерисовка во время записи (десять в секунду) пересоздавала бы его.
  const holdRef = useRef(hold);

  useEffect(() => {
    holdRef.current = hold;
  }, [hold]);

  const dispatch = useCallback((action: RecordGestureAction) => holdRef.current[action](), []);

  const gesture = useRecordGesture({ drag, locked: lockedShared, onAction: dispatch });

  // Идёт запись — страница не уезжает, и с замком, когда палец уже отпущен.
  useSlidePageSwipeHold(active);

  const circleStyle = useAnimatedStyle(() => ({
    opacity: grow.value,
    transform: [
      { translateX: lockedShared.value ? 0 : drag.x.value },
      { translateY: lockedShared.value ? 0 : drag.y.value },
      { scale: interpolate(grow.value, [0, 1], [0.4, 1]) },
    ],
  }));

  const lockStyle = useAnimatedStyle(() => {
    const progress = Math.min(1, -drag.y.value / LOCK_DISTANCE);

    return {
      opacity: lockedShared.value ? 1 : grow.value * (1 - progress * 0.3),
      transform: [{ translateY: lockedShared.value ? 0 : drag.y.value * 0.4 }],
    };
  });

  if (disabled) {
    return (
      <View
        testID="record-voice-button"
        accessibilityRole="button"
        accessibilityLabel="Голосовое сообщение: удерживайте, чтобы записать"
        accessibilityState={{ disabled: true }}
        style={[styles.slot, styles.disabled]}
      >
        <View style={[styles.button, { backgroundColor: theme.backgroundElement }]}>
          <SymbolView name={MIC} size={ComposerSizes.buttonIcon} tintColor={theme.textSecondary} />
        </View>
      </View>
    );
  }

  return (
    <GestureDetector gesture={gesture}>
      <View
        testID="record-voice-button"
        accessibilityRole="button"
        accessibilityLabel="Голосовое сообщение: удерживайте, чтобы записать"
        style={styles.slot}
      >
        <View
          style={[
            styles.button,
            { backgroundColor: theme.backgroundElement, opacity: active ? 0 : 1 },
          ]}
        >
          <SymbolView name={MIC} size={ComposerSizes.buttonIcon} tintColor={theme.textSecondary} />
        </View>

        {active ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.lock, { backgroundColor: theme.backgroundElement }, lockStyle]}
          >
            <SymbolView
              name={
                locked
                  ? { ios: 'lock.fill', android: 'lock', web: 'lock' }
                  : { ios: 'lock.open', android: 'lock_open', web: 'lock_open' }
              }
              size={ComposerSizes.buttonIcon}
              tintColor={theme.text}
            />
            {locked ? null : (
              <SymbolView
                name={{ ios: 'chevron.up', android: 'keyboard_arrow_up', web: 'keyboard_arrow_up' }}
                size={ComposerSizes.buttonIcon}
                tintColor={theme.textSecondary}
              />
            )}
          </Animated.View>
        ) : null}

        <Animated.View
          pointerEvents="none"
          style={[styles.circle, { backgroundColor: theme.primary }, circleStyle]}
        >
          <SymbolView
            name={locked ? SEND : MIC}
            size={ComposerSizes.buttonIcon + ComposerSizes.buttonIcon / 2}
            tintColor={theme.primaryText}
          />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
