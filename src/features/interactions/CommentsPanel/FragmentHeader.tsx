import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { styles } from './styles';

import type { ReactionCounts } from '@/api/reactionCounts';
import { Text } from '@/components/Text';
import { pickerGeometry, ReactionPicker } from '@/features/interactions/ReactionPicker';
import { audienceOf, menuReactionSet } from '@/features/interactions/reactionState';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type FragmentHeaderProps = {
  /** Кусок текста — цитата в шапке. */
  quote: string;
  memberReactions: ReactionCounts;
  visitorReactions: ReactionCounts;
  /** Моя реакция здесь — отмечена; тап по ней снимает. */
  mine: string | null;
  /** Я участник чата сообщения — догадка ряда моей реакции. */
  amMember: boolean;
  /** Ширина панели — под неё раскладывается полный набор реакций. */
  width: number;
  onToggle: (emoji: string) => void;
};

/** Сколько каждой реакции — оба ряда вместе, по убыванию. */
function merged(member: ReactionCounts, visitor: ReactionCounts) {
  const counts = new Map<string, number>();

  for (const row of [member, visitor]) {
    for (const [emoji, count] of Object.entries(row)) counts.set(emoji, (counts.get(emoji) ?? 0) + count);
  }

  return [...counts].sort((a, b) => b[1] - a[1]);
}

/**
 * Шапка боковой панели куска текста: цитата, под ней строка сводных реакций
 * со счётчиками. Много реакций — строка листается вбок; тап — моя реакция
 * ставится или снимается; «+» — весь набор. Чья это сводка и куда уходит
 * реакция — решает панель кластера или области.
 */
export function FragmentHeader({
  quote,
  memberReactions,
  visitorReactions,
  mine,
  amMember,
  width,
  onToggle,
}: FragmentHeaderProps) {
  const theme = useTheme();
  const [picking, setPicking] = useState(false);
  const counts = useMemo(
    () => merged(memberReactions, visitorReactions),
    [memberReactions, visitorReactions],
  );
  const set = menuReactionSet(
    {
      members: memberReactions,
      visitors: visitorReactions,
      mine: mine ? { emoji: mine, audience: audienceOf(amMember) } : null,
    },
    audienceOf(amMember),
  );
  const geometry = pickerGeometry(width - Spacing.three * 2, { ...set, expandable: false });

  const toggle = (emoji: string) => {
    setPicking(false);
    onToggle(emoji);
  };

  return (
    <View style={styles.fragmentHeader}>
      <View
        testID="fragment-quote"
        style={[styles.fragmentQuote, { borderLeftColor: theme.primary, backgroundColor: theme.quoteBackground }]}
      >
        <Text numberOfLines={4}>{quote}</Text>
      </View>

      <ScrollView
        testID="fragment-reactions"
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.fragmentReactions}
      >
        {counts.map(([emoji, count]) => (
          <Pressable
            key={emoji}
            testID={`fragment-reaction-${emoji}`}
            accessibilityRole="button"
            accessibilityLabel={mine === emoji ? `Снять реакцию ${emoji}` : `Реакция ${emoji}, ${count}`}
            accessibilityState={{ selected: mine === emoji }}
            onPress={() => toggle(emoji)}
            style={[
              styles.fragmentChip,
              { backgroundColor: mine === emoji ? theme.messageHighlight : theme.backgroundElement },
            ]}
          >
            <Text variant="small">{emoji}</Text>
            <Text variant="small" color={mine === emoji ? 'primary' : 'textSecondary'}>
              {count}
            </Text>
          </Pressable>
        ))}
        <Pressable
          testID="fragment-reaction-add"
          accessibilityRole="button"
          accessibilityLabel={picking ? 'Скрыть реакции' : 'Все реакции'}
          accessibilityState={{ expanded: picking }}
          onPress={() => setPicking((open) => !open)}
          style={[styles.fragmentChip, { backgroundColor: theme.backgroundElement }]}
        >
          <Text variant="small" color="textSecondary">
            {picking ? '×' : '+'}
          </Text>
        </Pressable>
      </ScrollView>

      {picking ? (
        <View style={[styles.fragmentPicker, { height: geometry.collapsedHeight }]}>
          <ReactionPicker
            geometry={geometry}
            selected={mine}
            expanded={false}
            maxHeight={geometry.collapsedHeight}
            onToggleExpanded={() => undefined}
            onSelect={toggle}
          />
        </View>
      ) : null}
    </View>
  );
}
