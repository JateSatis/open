import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import { styles } from './styles';

import type { CommentTarget } from '@/api/comments';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export type CommentTargetViewProps = {
  /** `undefined` — ещё грузится. */
  target: CommentTarget | undefined;
  /** Облачко сообщения — то же, что в переписке. */
  bubble: ReactNode;
};

/** Раскрытое длинное сообщение занимает не больше этой доли окна и дальше листается. */
const EXPANDED_SHARE = 0.4;

/**
 * Сообщение, к которому комментарии, — сверху панели, в том же облачке, что
 * в переписке. Длинное свёрнуто и раскрывается тапом; удалённое честно
 * названо удалённым.
 */
export function CommentTargetView({ target, bubble }: CommentTargetViewProps) {
  const theme = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  const collapsible = contentHeight > Sizes.commentTargetCollapsed;

  if (!target) return <View style={[styles.target, { borderBottomColor: theme.border }]} />;

  if (target.state !== 'live') {
    return (
      <View style={[styles.target, { borderBottomColor: theme.border }]}>
        <Text color="textSecondary" style={styles.targetGone}>
          {target.state === 'deleted' ? 'Сообщение удалено' : 'Сообщение не найдено'}
        </Text>
      </View>
    );
  }

  const content = (
    <View onLayout={(event) => setContentHeight(event.nativeEvent.layout.height)}>{bubble}</View>
  );

  return (
    <View testID="comment-target" style={[styles.target, { borderBottomColor: theme.border }]}>
      {expanded ? (
        // Вложенный в список шита: листается сам, пока есть куда, а дальше
        // палец достаётся шиту.
        <ScrollView nestedScrollEnabled style={{ maxHeight: windowHeight * EXPANDED_SHARE }}>
          {content}
        </ScrollView>
      ) : (
        // Тап по свёрнутому раскрывает его; плеер голосового и плитки альбома
        // внутри ловят свои касания сами.
        <Pressable
          accessibilityLabel={collapsible ? 'Показать сообщение полностью' : undefined}
          disabled={!collapsible}
          onPress={() => setExpanded(true)}
          style={[styles.targetClip, { maxHeight: Sizes.commentTargetCollapsed }]}
        >
          {content}
        </Pressable>
      )}

      {collapsible ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setExpanded(!expanded)}
          style={styles.targetToggle}
        >
          <Text variant="small" color="primary">
            {expanded ? 'Свернуть' : 'Показать полностью'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
