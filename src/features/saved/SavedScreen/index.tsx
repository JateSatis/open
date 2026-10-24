import { useMemo, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useSharedValue, withTiming } from 'react-native-reanimated';

import { styles } from './styles';

import { SegmentedControl } from '@/components/SegmentedControl';
import { mosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { bubbleAsideWidth } from '@/features/chats/MessageBubble/layout';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { SavedAllTab } from '@/features/saved/SavedAllTab';
import { SavedWatchLaterTab } from '@/features/saved/SavedWatchLaterTab';
import { useSavedTags } from '@/features/saved/useSavedTags';
import { useTheme } from '@/hooks/use-theme';
import { Motion, Spacing } from '@/theme';

const TABS = ['Все', 'Посмотреть позже'] as const;

/**
 * «Сохранённые сообщения»: под шапкой — переключатель «Все | Посмотреть
 * позже». Обе вкладки живут, пока открыт экран, а неактивная лишь
 * невидима: переключение не теряет прокрутку другой. «Посмотреть позже»
 * грузится при первом заходе на неё.
 */
export function SavedScreen() {
  const theme = useTheme();
  const currentUserId = useCurrentUserId();
  const { width: windowWidth } = useWindowDimensions();
  const { tags } = useSavedTags();
  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const mediaBounds = useMemo(
    () => mosaicBounds(windowWidth - Spacing.three * 2, false, bubbleAsideWidth(true)),
    [windowWidth],
  );
  const [tab, setTab] = useState(0);
  const [laterOpened, setLaterOpened] = useState(false);
  const position = useSharedValue(0);

  const select = (index: number) => {
    setTab(index);
    if (index === 1) setLaterOpened(true);
    position.set(withTiming(index, { duration: Motion.segmentMs }));
  };

  const shared = { currentUserId, tags, tagsById };

  return (
    <View testID="saved-screen" style={[styles.screen, { backgroundColor: theme.background }]}>
      <View style={styles.tabs}>
        <SegmentedControl
          segments={TABS}
          position={position}
          selectedIndex={tab}
          onSelect={select}
        />
      </View>

      <View style={styles.pages}>
        <View
          testID="saved-tab-all"
          pointerEvents={tab === 0 ? 'auto' : 'none'}
          importantForAccessibility={tab === 0 ? 'auto' : 'no-hide-descendants'}
          accessibilityElementsHidden={tab !== 0}
          style={[styles.page, tab !== 0 && styles.hidden]}
        >
          <SavedAllTab {...shared} mediaBounds={mediaBounds} active={tab === 0} />
        </View>

        {laterOpened ? (
          <View
            testID="saved-tab-later"
            pointerEvents={tab === 1 ? 'auto' : 'none'}
            importantForAccessibility={tab === 1 ? 'auto' : 'no-hide-descendants'}
            accessibilityElementsHidden={tab !== 1}
            style={[styles.page, tab !== 1 && styles.hidden]}
          >
            <SavedWatchLaterTab {...shared} active={tab === 1} />
          </View>
        ) : null}
      </View>
    </View>
  );
}
