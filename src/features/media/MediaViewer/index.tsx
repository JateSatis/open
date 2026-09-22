import { useCallback, useState } from 'react';
import { FlatList, Modal, Pressable, useWindowDimensions, View, type ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MediaViewerPage } from './MediaViewerPage';
import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';
import type { MediaViewerItem } from './types';

export type { MediaViewerItem };

// Один и тот же объект на все рендеры: FlatList сравнивает конфиг по
// ссылке, и новый литерал при каждом рендере пересоздавал бы подписку на
// видимость без необходимости.
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 60 };

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
 */
export function MediaViewer({ visible, items, initialIndex, onClose }: MediaViewerProps) {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [activeIndex, setActiveIndex] = useState(initialIndex);

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];

    if (first && typeof first.index === 'number') setActiveIndex(first.index);
  }, []);

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.container, { backgroundColor: theme.viewerBackground }]}>
        <FlatList
          testID="media-viewer-list"
          data={items}
          keyExtractor={(item) => item.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={VIEWABILITY_CONFIG}
          renderItem={({ item, index }) => (
            <MediaViewerPage item={item} width={width} height={height} isActive={index === activeIndex} />
          )}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть просмотр"
          onPress={onClose}
          style={[
            styles.closeButton,
            { top: insets.top + Spacing.two, backgroundColor: theme.mediaScrim },
          ]}
        >
          <Text variant="bodyBold" color="textInverse">
            ✕
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}
