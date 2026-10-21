// Отказы базы, которыми она защищает людей от нежеланного контакта (миграции
// этапа 3 приватности). Текст — для человека: заблокированному о блокировке
// не сообщается, ему отвечают тем же, что и при недоступном пользователе.

/** Заявку ещё не приняли: в ней только одно текстовое сообщение. */
export const REQUEST_PENDING_CODE = 'OPN07';
/** Блокировка в любую сторону. */
export const USER_UNAVAILABLE_CODE = 'OPN08';
/** Повторная заявка той же паре — рано или больше нельзя. */
export const REQUEST_RETRY_CODE = 'OPN09';
/** Лимит обращений к не-друзьям за сутки. */
export const CONTACT_LIMIT_CODE = 'OPN10';
/** Автоограничение: на аккаунт массово жаловались или блокировали. */
export const CONTACT_RESTRICTED_CODE = 'OPN11';
/** Лимит жалоб. */
export const REPORT_LIMIT_CODE = 'OPN12';

export const USER_UNAVAILABLE_TEXT = 'Пользователь недоступен';

const TEXTS: Record<string, string> = {
  [REQUEST_PENDING_CODE]: 'Писать можно, когда собеседник примет заявку.',
  [USER_UNAVAILABLE_CODE]: USER_UNAVAILABLE_TEXT,
  [REQUEST_RETRY_CODE]: 'Новую заявку этому человеку отправить пока нельзя.',
  [CONTACT_LIMIT_CODE]: 'Слишком много заявок незнакомым людям. Попробуйте завтра.',
  [CONTACT_RESTRICTED_CODE]:
    'Сейчас вы не можете обращаться к людям, которые вам не друзья. Попробуйте позже.',
  [REPORT_LIMIT_CODE]: 'Слишком много жалоб. Попробуйте позже.',
};

/** Отказ базы с понятным текстом. */
export class ContactRefusedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ContactRefusedError';
  }
}

function codeOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;

  const { code } = error as { code: unknown };

  return typeof code === 'string' ? code : null;
}

/** Текст отказа для человека; `null` — это не отказ в контакте. */
export function describeContactRefusal(error: unknown): string | null {
  if (error instanceof ContactRefusedError) return error.message;

  const code = codeOf(error);

  return code ? (TEXTS[code] ?? null) : null;
}

/** Отказ в контакте — понятной ошибкой, остальное — как есть. */
export function toContactError(error: unknown): unknown {
  const code = codeOf(error);
  const text = code ? TEXTS[code] : undefined;

  return code && text ? new ContactRefusedError(code, text) : error;
}
