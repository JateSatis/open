import type { ReactionsTone } from './tones';

import type { MessageReactions as Reactions, ReactionAudience } from '@/api/reactionCounts';

/**
 * Как реакции разложены по облачку:
 * - `split` — у сообщения чата: ряд участников и строка зрителей отдельно;
 * - `merged` — у комментария: один общий ряд, под реакцией аватары
 *   одного-двух поставивших;
 * - `mergedCounts` — у поста канала: один общий ряд без аватаров — у одной
 *   реакции только эмодзи, у нескольких число.
 * В обоих общих рядах реакцию нажимает любой — участник и зритель.
 */
export type ReactionsLayout = 'split' | 'merged' | 'mergedCounts';

/** Общий ряд: участники и зрители сложены, строки зрителей нет. */
export function isMergedLayout(layout: ReactionsLayout): boolean {
  return layout !== 'split';
}

/** Свежие имя и фото человека — из участников чата, если он там есть. */
export type ResolvePerson = (
  userId: string,
) => { name: string; avatarUrl: string | null } | undefined;

export type BubbleReactionsProps = {
  /** Ключ памяти рядов (сдвиг прокрутки): у облачка и его копии один. */
  memoryKey: string;
  reactions: Reactions;
  tone: ReactionsTone;
  layout: ReactionsLayout;
  /** Мой ряд у сообщения: тап ставит и снимает реакцию только в ряду участников, если я участник. */
  audience?: ReactionAudience;
  /** Нет обработчика — копия облачка: ничего не нажимается и не прокручивается. */
  onToggle?: (emoji: string) => void;
  resolvePerson?: ResolvePerson;
};
