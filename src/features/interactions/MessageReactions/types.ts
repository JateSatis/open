import type { ReactionsTone } from './tones';

import type { MessageReactions as Reactions, ReactionAudience } from '@/api/reactionCounts';

/**
 * Как реакции разложены по облачку: у сообщения — ряд участников и строка
 * зрителей отдельно, у комментария — один общий ряд.
 */
export type ReactionsLayout = 'split' | 'merged';

/** Свежие имя и фото человека — из участников чата, если он там есть. */
export type ResolvePerson = (
  userId: string,
) => { name: string; avatarUrl: string | null } | undefined;

export type BubbleReactionsProps = {
  /** Ключ памяти рядов (сдвиг, масштаб): у облачка и его копии один. */
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
