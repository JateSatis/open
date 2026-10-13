/**
 * Параметры адреса, с которыми в чат приходят «к сообщению»: куда прыгнуть,
 * ключ перехода и комментарий, на котором открыть шит. Их читает
 * `useQuoteNavigation`, а перенаправление чата постов на экран канала
 * передаёт их дальше.
 */
export type JumpParams = {
  jumpTo?: string;
  jumpAt?: string;
  jumpKey?: string;
  comments?: string;
  comment?: string;
};

const JUMP_PARAM_NAMES = ['jumpTo', 'jumpAt', 'jumpKey', 'comments', 'comment'] as const;

/** Только заданные параметры прыжка — без чужих ключей адреса и без пустых. */
export function pickJumpParams(params: JumpParams): JumpParams {
  const picked: JumpParams = {};

  for (const name of JUMP_PARAM_NAMES) {
    const value = params[name];
    if (typeof value === 'string' && value !== '') picked[name] = value;
  }

  return picked;
}

/** Ключ перехода: по нему экран узнаёт новый приход, даже к тому же сообщению. */
export function jumpRequestOf(params: JumpParams): string | undefined {
  return params.jumpKey ?? params.jumpTo;
}
