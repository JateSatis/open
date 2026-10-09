import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

/** Столько висит короткое объяснение — прочитать и не мешать. */
const TOAST_MS = 2000;

export type PreviewToastState = {
  message: string | null;
  show: (message: string) => void;
};

/**
 * Короткое объяснение внутри предпросмотра. Общие уведомления приложения
 * рисуются в главном окне и оказались бы под окном шита.
 */
export function usePreviewToast(): PreviewToastState {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const show = useCallback((next: string) => {
    if (timer.current) clearTimeout(timer.current);

    setMessage(next);
    timer.current = setTimeout(() => setMessage(null), TOAST_MS);
  }, []);

  return useMemo(() => ({ message, show }), [message, show]);
}

export function PreviewToast({ toast, bottom }: { toast: PreviewToastState; bottom: number }) {
  const theme = useTheme();

  if (!toast.message) return null;

  return (
    <Animated.View
      testID="media-preview-toast"
      entering={FadeIn}
      exiting={FadeOut}
      pointerEvents="none"
      style={[styles.toast, { bottom, backgroundColor: theme.mediaScrim }]}
    >
      <Text variant="small" color="textOnMedia">
        {toast.message}
      </Text>
    </Animated.View>
  );
}
