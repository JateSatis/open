// Дата рождения и настройки конфиденциальности. Строка приватная: читает
// только владелец, пишут только функции базы (миграция
// 20261029100000_privacy_settings.sql). Возраст считает сервер — клиент лишь
// показывает, что тот ответил.

import { supabase } from '@/api/supabase';
import type { Database } from '@/api/types.gen';

type PrivacyRow = Database['public']['Functions']['my_privacy_settings']['Returns'];

/** Видимость: всем, только друзьям, никому. */
export type Visibility = 'everyone' | 'friends' | 'nobody';

export type PrivacySettings = {
  /** `YYYY-MM-DD`; null — дату ещё не указали. */
  birthDate: string | null;
  friendsListVisibility: Visibility;
  /** Кто видит, что я в сети: «в сети», «был(а) в …», «печатает». */
  activityStatusVisibility: Visibility;
  /** Кто видит время сообщений и прочтение в диалогах, где я участвую. */
  messageTimeVisibility: Visibility;
  /** Кто может найти меня в поиске. */
  searchVisibility: Visibility;
};

/** Настройки, которые клиент уже умеет менять. Остальные ждут этапов 3–6. */
export type EditablePrivacySetting =
  | 'friends_list_visibility'
  | 'activity_status_visibility'
  | 'message_activity_metadata_visibility'
  | 'account_search_visibility';

/** Будущая дата. */
export const BIRTH_DATE_IN_FUTURE_CODE = 'OPN03';
/** Младше 13. */
export const BIRTH_DATE_TOO_YOUNG_CODE = 'OPN04';

export class BirthDateTooYoungError extends Error {
  constructor() {
    super('Регистрация в Open возможна с 13 лет');
    this.name = 'BirthDateTooYoungError';
  }
}

export class BirthDateInFutureError extends Error {
  constructor() {
    super('Дата рождения не может быть в будущем');
    this.name = 'BirthDateInFutureError';
  }
}

function toVisibility(value: string | null | undefined): Visibility {
  return value === 'everyone' || value === 'friends' ? value : 'nobody';
}

function toSettings(row: PrivacyRow): PrivacySettings {
  return {
    birthDate: row.birth_date,
    friendsListVisibility: toVisibility(row.friends_list_visibility),
    activityStatusVisibility: toVisibility(row.activity_status_visibility),
    messageTimeVisibility: toVisibility(row.message_activity_metadata_visibility),
    searchVisibility: toVisibility(row.account_search_visibility),
  };
}

/**
 * Мои дата и настройки. null — строки нет: так бывает только у удалённого
 * аккаунта, чей сеанс ещё не погас.
 */
export async function getMyPrivacySettings(): Promise<PrivacySettings | null> {
  const { data, error } = await supabase.rpc('my_privacy_settings');

  if (error) throw error;
  // Функция, вернувшая «нет строки», приходит записью из одних null.
  if (!data || !data.id) return null;

  return toSettings(data);
}

export async function setBirthDate(birthDate: string): Promise<void> {
  const { error } = await supabase.rpc('set_birth_date', { p_birth_date: birthDate });

  if (!error) return;
  if (error.code === BIRTH_DATE_TOO_YOUNG_CODE) throw new BirthDateTooYoungError();
  if (error.code === BIRTH_DATE_IN_FUTURE_CODE) throw new BirthDateInFutureError();

  throw error;
}

export async function setPrivacySetting(
  key: EditablePrivacySetting,
  value: Visibility,
): Promise<void> {
  const { error } = await supabase.rpc('set_privacy_setting', { p_key: key, p_value: value });

  if (error) throw error;
}
