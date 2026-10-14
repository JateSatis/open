import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { sendFragmentReaction } from '@/features/chats/fragments/fragmentReactions';
import { myFragmentOn, useMessageFragments } from '@/features/chats/fragments/useMessageFragments';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import type { FragmentPanelSubject } from '@/features/interactions/comments/commentsPanelStore';
import { pickerGeometry, ReactionPicker } from '@/features/interactions/ReactionPicker';
import { audienceOf, menuReactionSet } from '@/features/interactions/reactionState';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type FragmentHeaderProps = {
  messageId: string;
  fragment: FragmentPanelSubject;
  /** Я участник чата сообщения — догадка ряда моей реакции. */
  amMember: boolean;
  /** Ширина панели — под неё раскладывается полный набор реакций. */
  width: number;
};

/** Сколько каждой реакции на фрагменте — оба ряда вместе, по убыванию. */
function merged(member: Readonly<Record<string, number>>, visitor: Readonly<Record<string, number>>) {
  const counts = new Map<string, number>();

  for (const row of [member, visitor]) {
    for (const [emoji, count] of Object.entries(row)) counts.set(emoji, (counts.get(emoji) ?? 0) + count);
  }

  return [...counts].sort((a, b) => b[1] - a[1]);
}

/**
 * Шапка панели фрагмента: цитата — выделенный кусок текста, под ней строка
 * реакций со счётчиками. Много реакций — строка листается вбок; тап — моя
 * реакция ставится или снимается; «+» — весь набор. Чужие реакции приходят
 * вживую сигналом в топик комментариев сообщения.
 */
export function FragmentHeader({ messageId, fragment, amMember, width }: FragmentHeaderProps) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const me = useCurrentUserId();
  const [picking, setPicking] = useState(false);
  const { data: fragments } = useMessageFragments(messageId, true);
  const shown = myFragmentOn(fragments, me, fragment.range);
  const counts = useMemo(
    () => merged(shown?.memberReactions ?? {}, shown?.visitorReactions ?? {}),
    [shown],
  );
  const mine = shown?.mine ?? null;
  const set = menuReactionSet(
    {
      members: shown?.memberReactions ?? {},
      visitors: shown?.visitorReactions ?? {},
      mine: mine ? { emoji: mine, audience: audienceOf(amMember) } : null,
    },
    audienceOf(amMember),
  );
  const geometry = pickerGeometry(width - Spacing.three * 2, { ...set, expandable: false });

  const toggle = (emoji: string) => {
    if (!me) return;

    setPicking(false);
    sendFragmentReaction(queryClient, {
      messageId,
      range: fragment.range,
      emoji: mine === emoji ? null : emoji,
      audience: audienceOf(amMember),
      me,
    });
  };

  return (
    <View style={styles.fragmentHeader}>
      <View
        testID="fragment-quote"
        style={[styles.fragmentQuote, { borderLeftColor: theme.primary, backgroundColor: theme.quoteBackground }]}
      >
        <Text numberOfLines={4}>{fragment.range.text}</Text>
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
