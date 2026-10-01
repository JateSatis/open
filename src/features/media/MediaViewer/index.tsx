import { useCallback, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, useWindowDimensions, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MediaViewerPage } from './MediaViewerPage';
import { styles } from './styles';
import { useViewerGestures } from './useViewerGestures';
import { fittedSize } from './viewerMath';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';
import type { MediaViewerItem } from './types';

export type { MediaViewerItem };

export type MediaViewerProps = {
  visible: boolean;
  items: MediaViewerItem[];
  initialIndex: number;
  onClose: () => void;
};

/**
 * Полноэкранный просмотр вложений одного сообщения. Видео проигрывается
 * само и останавливается по тапу — сложный плеер (перемотка, громкость)
 * сюда сознательно не входит, это следующая задача.
 *
 * Окно рождается заново на каждое открытие: листание, увеличение и уход
 * вниз начинаются с нуля.
 */
export function MediaViewer({ visible, items, initialIndex, onClose }: MediaViewerProps) {
  if (!visible) return null;

  return <ViewerWindow items={items} initialIndex={initialIndex} onClose={onClose} />;
}

function ViewerWindow({ items, initialIndex, onClose }: Omit<MediaViewerProps, 'visible'>) {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  // Пауза по тапу — у активной страницы: тап ловит общий жест просмотрщика.
  const togglesRef = useRef(new Map<number, () => void>());

  const active = items[activeIndex];
  const content = useMemo(
    () =>
      fittedSize(
        { width: active?.width ?? null, height: active?.height ?? null },
        { width, height },
      ),
    [active, height, width],
  );

  const onTap = useCallback(() => togglesRef.current.get(activeIndex)?.(), [activeIndex]);

  const { gesture, pagerStyle, activeStyle, backgroundStyle } = useViewerGestures({
    count: items.length,
    initialIndex,
    width,
    height,
    contentWidth: content.width,
    contentHeight: content.height,
    onPageChange: setActiveIndex,
    onTap,
    onClose,
  });

  const registerToggle = useCallback((index: number, toggle: (() => void) | null) => {
    if (toggle) togglesRef.current.set(index, toggle);
    else togglesRef.current.delete(index);
  }, []);

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      {/* Своё окно на Android — свой корень жестов, как у шитов. */}
      <GestureHandlerRootView style={styles.container}>
        <Animated.View
          pointerEvents="none"
          style={[styles.fill, { backgroundColor: theme.viewerBackground }, backgroundStyle]}
        />

        <GestureDetector gesture={gesture}>
          <View testID="media-viewer" style={styles.container}>
            <Animated.View style={[styles.pager, { width: width * items.length }, pagerStyle]}>
              {items.map((item, index) => (
                <View
                  key={item.id}
                  style={[styles.page, { left: index * width, width, height }]}
                >
                  <Animated.View style={[styles.container, index === activeIndex && activeStyle]}>
                    <MediaViewerPage
                      item={item}
                      width={width}
                      height={height}
                      isActive={index === activeIndex}
                      onToggleReady={(toggle) => registerToggle(index, toggle)}
                    />
                  </Animated.View>
                </View>
              ))}
            </Animated.View>
          </View>
        </GestureDetector>

        <Animated.View style={[styles.closeWrap, { top: insets.top + Spacing.two }, backgroundStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Закрыть просмотр"
            onPress={onClose}
            style={[styles.closeButton, { backgroundColor: theme.mediaScrim }]}
          >
            <Text variant="bodyBold" color="textInverse">
              ✕
            </Text>
          </Pressable>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}
