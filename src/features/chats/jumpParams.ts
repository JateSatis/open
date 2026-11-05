/**
 * Параметры адреса, с которыми в чат приходят «к сообщению»: куда прыгнуть,
 * ключ перехода и комментарий, на котором открыть шит. Их читает
 * `useQuoteNavigation`, а перенаправление чата постов на экран канала
 * передаёт их дальше.
 */
export type JumpParams = {
  jumpTo?: string;
  jumpSeq?: string;
  jumpKey?: string;
  comments?: string;
  comment?: string;
  commentRoot?: string;
};

export const JUMP_PARAM_NAMES = [
  'jumpTo',
  'jumpSeq',
  'jumpKey',
  'comments',
  'comment',
  'commentRoot',
] as const;

let lastJumpKey = 0;

/** Миллисекунды плюс счётчик: два быстрых тапа всегда получают разные ключи. */
export function nextJumpKey(): string {
  lastJumpKey = Math.max(Date.now(), lastJumpKey + 1);

  return String(lastJumpKey);
}

/** Только заданные параметры прыжка — без чужих ключей адреса и без пустых. */
export function pickJumpParams(params: JumpParams): JumpParams {
  const picked: JumpParams = {};

  for (const name of JUMP_PARAM_NAMES) {
    const value = params[name];
    if (typeof value === 'string' && value !== '') picked[name] = value;
  }

  return picked;
}

/**
 * Ключ перехода, если по адресу есть что исполнить: шит комментария или
 * прыжок к сообщению. Ключ, а не id сообщения: к тому же сообщению могут
 * прийти и второй раз, вернувшись на уже открытый экран.
 */
export function jumpRequestOf(params: JumpParams): string | undefined {
  const actionable = Boolean(
    (params.comments && params.comment) || (params.jumpTo && params.jumpSeq),
  );

  return actionable ? (params.jumpKey ?? params.jumpTo ?? params.comments) : undefined;
}
