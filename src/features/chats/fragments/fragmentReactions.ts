// Своя реакция на фрагмент текста. Как у сообщений (`reactionSender`): на
// экране — сразу, в базу — очередью: на один фрагмент в полёте не больше
// одного запроса, быстрые тапы меняют лишь желаемое, и в базе остаётся
// последний выбор. Живёт вне компонентов — закрытое меню реакцию не обрывает.

import type { QueryClient } from '@tanstack/react-query';

import {
  setFragmentReaction,
  type Fragment,
  type FragmentRange,
} from '@/api/fragments';
import type { ReactionAudience, ReactionCounts } from '@/api/reactionCounts';
import {
  fragmentsKey,
  setMessageFragments,
} from '@/features/chats/fragments/useMessageFragments';
import { showNotice } from '@/features/notifications/alertsStore';
import { withDeadline } from '@/lib/deadline';
import { isNetworkError } from '@/lib/network';

/** Дольше реакция не ждёт ответа: без связи интерфейс не висит, а откатывается. */
const DEADLINE_MS = 15000;

export type FragmentReactionIntent = {
  messageId: string;
  /** Мой фрагмент на этом диапазоне (code points). */
  range: FragmentRange;
  /** Какой реакция должна стать; `null` — снять. */
  emoji: string | null;
  /** Ряд — догадка по участию в чате сообщения; решит база. */
  audience: ReactionAudience;
  me: string;
};

const wanted = new Map<string, FragmentReactionIntent>();
const inFlight = new Set<string>();

function keyOf({ messageId, range }: Pick<FragmentReactionIntent, 'messageId' | 'range'>) {
  return `${messageId}:${range.start}-${range.end}`;
}

function shift(counts: ReactionCounts, emoji: string | null | undefined, delta: number): ReactionCounts {
  if (!emoji) return counts;

  const next = { ...counts, [emoji]: (counts[emoji] ?? 0) + delta };

  if (next[emoji] <= 0) delete next[emoji];

  return next;
}

/** Моя реакция на моём фрагменте диапазона — сразу в кеше; фрагмента нет — появляется. */
function applyLocally(queryClient: QueryClient, intent: FragmentReactionIntent) {
  const { messageId, range, emoji, audience, me } = intent;

  setMessageFragments(queryClient, messageId, (fragments) => {
    const index = fragments.findIndex(
      (fragment) =>
        fragment.authorId === me &&
        !fragment.lost &&
        fragment.start === range.start &&
        fragment.end === range.end,
    );
    const base: Fragment =
      index >= 0
        ? fragments[index]
        : {
            id: `local:${keyOf(intent)}`,
            messageId,
            authorId: me,
            start: range.start,
            end: range.end,
            exactText: range.text,
            lost: false,
            memberReactions: {},
            visitorReactions: {},
            reactionsCount: 0,
            commentsCount: 0,
            mine: null,
          };

    if (base.mine === emoji) return fragments;

    const row = audience === 'member' ? 'memberReactions' : 'visitorReactions';
    const next: Fragment = {
      ...base,
      [row]: shift(shift(base[row], base.mine, -1), emoji, 1),
      reactionsCount: base.reactionsCount - (base.mine ? 1 : 0) + (emoji ? 1 : 0),
      mine: emoji,
    };

    return index >= 0
      ? fragments.map((fragment, at) => (at === index ? next : fragment))
      : [...fragments, next];
  });
}

function isReactionLimit(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'OR001';
}

async function drain(queryClient: QueryClient, key: string) {
  inFlight.add(key);

  let last: FragmentReactionIntent | undefined;

  try {
    for (;;) {
      const intent = wanted.get(key);

      if (!intent || intent === last) return;

      last = intent;
      await withDeadline(setFragmentReaction(intent.messageId, intent.range, intent.emoji), DEADLINE_MS);

      // Пока ехал запрос, человек передумал — отправляем новое желаемое.
      if (wanted.get(key) !== intent) continue;

      wanted.delete(key);
      return;
    }
  } catch (cause) {
    wanted.delete(key);
    showNotice(
      isNetworkError(cause)
        ? 'Не удалось поставить реакцию: нет связи'
        : isReactionLimit(cause)
          ? 'Разных реакций уже слишком много — выберите из поставленных'
          : 'Не удалось поставить реакцию',
      'error',
    );
  } finally {
    inFlight.delete(key);
    // Счётчики и id фрагмента — из базы: и после успеха, и как откат.
    if (last) void queryClient.invalidateQueries({ queryKey: fragmentsKey(last.messageId) });
  }
}

/** Ставит, меняет или снимает мою реакцию на мой фрагмент этого диапазона. */
export function sendFragmentReaction(queryClient: QueryClient, intent: FragmentReactionIntent) {
  const key = keyOf(intent);

  applyLocally(queryClient, intent);
  wanted.set(key, intent);

  if (!inFlight.has(key)) void drain(queryClient, key);
}
