import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useContext, useMemo, useRef } from 'react';
import { Pressable, ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { PagerGestureContext } from './PopPager';
import type { PopoverAnchor } from './PopReactionPopover';
import { styles } from './styles';

import type { PopReactions } from '@/api/pops';
import { Text } from '@/components/Text';
import { formatViewsCount } from '@/features/chats/ViewsCount/formatViewsCount';
import { ReactionBadge } from '@/features/interactions/MessageReactions/ReactionBadge';
import { popReactionColumn } from '@/features/pops/popReactions';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing } from '@/theme';

export type PopSideColumnProps = {
  reactions: PopReactions;
  viewsCount: number;
  onReaction: (emoji: string) => void;
  /** «+» нажат; где он на экране — к нему прижмётся выбор реакции. */
  /**
   * «+» нажат. `fromBottom` — от низа «+» до низа колонки: к нему прижмётся
   * выбор реакции.
   */
  onAddReaction: (anchor: PopoverAnchor) => void;
};

function SideIcon({
  name,
  label,
  testID,
  onPress,
  onLayout,
}: {
  name: SymbolViewProps['name'];
  label: string;
  testID: string;
  onPress?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onLayout={onLayout}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Индикатор без действия глотает тап: он не должен уйти видео как пауза.
      onPress={onPress ?? noop}
      hitSlop={Spacing.one}
      style={[styles.sideButton, styles.onMediaShadow, { shadowColor: theme.shadow }]}
    >
      <SymbolView name={name} size={Sizes.popSideIcon} tintColor={theme.textOnMedia} />
    </Pressable>
  );
}

const noop = () => undefined;

/**
 * Колонка справа, сверху вниз: столбик реакций, «+», комментарии,
 * просмотры, «⋯». Комментарии и «⋯» пока только индикаторы — комментарии к
 * попу и меню придут следующими этапами.
 */
export function PopSideColumn({
  reactions,
  viewsCount,
  onReaction,
  onAddReaction,
}: PopSideColumnProps) {
  const theme = useTheme();
  // Раскладка, а не замер в окне: колонка едет вместе с лентой страниц, и
  // замер в окне посреди её сдвига врал.
  const columnHeight = useRef(0);
  const plusBottom = useRef(0);
  const pager = useContext(PagerGestureContext);
  // Палец в столбике реакций — листание попсов ждёт, пока прокрутка столбика не откажется.
  const columnScroll = useMemo(() => {
    const native = Gesture.Native();

    return pager ? native.blocksExternalGesture(pager) : native;
  }, [pager]);
  const column = popReactionColumn(reactions);
  const openPicker = () => onAddReaction({ fromBottom: columnHeight.current - plusBottom.current });
  const height = Math.min(column.length, Sizes.popReactionsVisible) * Sizes.popReactionCell;

  return (
    <View
      testID="pop-side-column"
      style={styles.sideColumn}
      onLayout={(event) => {
        columnHeight.current = event.nativeEvent.layout.height;
      }}
    >
      <GestureDetector gesture={columnScroll}>
        <ScrollView
          testID="pop-reactions"
          style={{ height }}
          contentContainerStyle={styles.reactionsContent}
          showsVerticalScrollIndicator={false}
        >
          {column.map(([emoji, count]) => (
            <View key={emoji} style={styles.reactionCell}>
              <ReactionBadge
                emoji={emoji}
                count={count}
                people={null}
                mine={reactions.mine === emoji}
                tone="media"
                onPress={() => onReaction(emoji)}
              />
            </View>
          ))}
        </ScrollView>
      </GestureDetector>

      <SideIcon
        testID="pop-add-reaction"
        name={{ ios: 'plus', android: 'add', web: 'add' }}
        label="Поставить реакцию"
        onPress={openPicker}
        onLayout={(event) => {
          const { y, height } = event.nativeEvent.layout;

          plusBottom.current = y + height;
        }}
      />
      <SideIcon
        testID="pop-comments"
        name={{ ios: 'bubble.right.fill', android: 'chat_bubble', web: 'chat_bubble' }}
        label="Комментарии"
      />
      <View
        testID="pop-views"
        accessible
        accessibilityLabel={`Просмотры: ${viewsCount}`}
        style={[styles.sideStat, styles.onMediaShadow, { shadowColor: theme.shadow }]}
      >
        <SymbolView
          name={{ ios: 'eye.fill', android: 'visibility', web: 'visibility' }}
          size={Sizes.popSideIcon}
          tintColor={theme.textOnMedia}
        />
        <Text
          variant="smallBold"
          color="textOnMedia"
          style={[styles.onMediaText, { textShadowColor: theme.shadow }]}
        >
          {formatViewsCount(viewsCount)}
        </Text>
      </View>
      <SideIcon
        testID="pop-more"
        name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }}
        label="Ещё"
      />
    </View>
  );
}
