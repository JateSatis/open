import { useMemo } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { ReactionChip } from './ReactionChip';
import { styles } from './styles';
import type { ReactionsTone } from './tones';
import { VisitorReactions } from './VisitorReactions';

import type { MessageReactions as Reactions, ReactionAudience } from '@/api/reactionCounts';
import { byPopularity, hasReactions } from '@/features/interactions/reactionState';

export type { ReactionsTone } from './tones';

const APPEAR_MS = 160;

export type MessageReactionsProps = {
  reactions: Reactions;
  tone: ReactionsTone;
  /**
   * Мой ряд: участник или посетитель. Тап ставит и снимает реакцию только в
   * своём ряду — реакция человека всегда попадает туда. Без него (копия
   * облачка в меню) ряды не нажимаются.
   */
  audience?: ReactionAudience;
  onToggle?: (emoji: string) => void;
  /**
   * Какой ряд рисовать. В облачке ряды стоят в разных строках: чипы
   * участников — своей строкой, зрители — в строке со временем.
   */
  part?: 'all' | 'members' | 'visitors';
};

/**
 * Реакции в облачке двумя рядами: участники — чипами, посетители — тихой
 * строкой под ними. Нет реакций — нет и блока, облачко не растёт.
 */
export function MessageReactions({
  reactions,
  tone,
  audience,
  onToggle,
  part = 'all',
}: MessageReactionsProps) {
  const members = useMemo(() => byPopularity(reactions.members), [reactions.members]);
  const visitors = useMemo(() => byPopularity(reactions.visitors), [reactions.visitors]);

  const showMembers = part !== 'visitors' && members.length > 0;
  const showVisitors = part !== 'members' && visitors.length > 0;

  if (!hasReactions(reactions) || (!showMembers && !showVisitors)) return null;

  const { mine } = reactions;
  const canTapMembers = onToggle && audience === 'member';
  const canTapVisitors = onToggle && audience === 'visitor';

  return (
    <Animated.View
      testID="message-reactions"
      entering={FadeIn.duration(APPEAR_MS)}
      exiting={FadeOut.duration(APPEAR_MS)}
      layout={LinearTransition.duration(APPEAR_MS)}
      style={[styles.block, tone === 'bare' && styles.bare]}
    >
      {showMembers ? (
        <View testID="member-reactions" style={styles.chips}>
          {members.map(([emoji, count]) => (
            <ReactionChip
              key={emoji}
              emoji={emoji}
              count={count}
              mine={mine?.audience === 'member' && mine.emoji === emoji}
              tone={tone}
              onPress={canTapMembers ? () => onToggle(emoji) : undefined}
            />
          ))}
        </View>
      ) : null}

      {showVisitors ? (
        <VisitorReactions
          entries={visitors}
          mine={mine?.audience === 'visitor' ? mine.emoji : null}
          tone={tone}
          onPress={canTapVisitors ? onToggle : undefined}
        />
      ) : null}
    </Animated.View>
  );
}
