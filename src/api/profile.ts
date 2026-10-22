// Профиль глазами смотрящего: имя, username, фото, «О себе» и статус
// таблица `profiles` клиенту не отдаёт — их отдаёт `profile_cards`, которая
// применяет настройки идентичности (миграция
// `20261101100000_identity_aliases.sql`). Тот, от кого человек скрыт, видит
// псевдоним без username, «О себе» и статуса. Свой профиль — всегда настоящий.

import { ProfileUnavailableError } from '@/api/profileErrors';
import { supabase } from '@/api/supabase';
import type { Database, TablesUpdate } from '@/api/types.gen';

type ProfileRow = Database['public']['Functions']['profile_cards']['Returns'][number];

export type Profile = {
  id: string;
  /** Null until the user picks one or after they clear it — it is optional. */
  username: string | null;
  /** Null when the OAuth provider sent no name. */
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  /** Короткая строка под именем: «в отпуске до понедельника». */
  status: string | null;
  /**
   * Имя скрыто от меня настройкой человека: `displayName` — его псевдоним,
   * username, «О себе» и статуса нет. У своего профиля — `false`.
   */
  masked?: boolean;
};

export type ProfileUpdateInput = Partial<
  Pick<Profile, 'username' | 'displayName' | 'avatarUrl' | 'bio' | 'status'>
>;

/** Thrown when the unique index on profiles.username rejects the update. */
export class UsernameTakenError extends Error {
  constructor(username: string) {
    super(`Username "${username}" is already taken`);
    this.name = 'UsernameTakenError';
  }
}

export { ProfileUnavailableError };

export class NotAuthenticatedError extends Error {
  constructor() {
    super('No active session');
    this.name = 'NotAuthenticatedError';
  }
}

// Колонки результата rpc генератор типов не размечает как nullable.
function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    username: row.username ?? null,
    displayName: row.display_name ?? null,
    avatarUrl: row.avatar_url ?? null,
    bio: row.bio ?? null,
    status: row.status ?? null,
    masked: row.masked === true,
  };
}

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  const userId = data.session?.user.id;

  if (!userId) {
    throw new NotAuthenticatedError();
  }

  return userId;
}

/** Люди глазами смотрящего вне диалогов — не больше 200 за раз. Удалённых и заблокировавших меня нет. */
export async function getProfiles(userIds: string[]): Promise<Profile[]> {
  if (userIds.length === 0) return [];

  const { data, error } = await supabase.rpc('profile_cards', { ids: userIds });

  if (error) throw error;

  return (data ?? []).map(toProfile);
}

export async function getProfile(userId: string): Promise<Profile> {
  const [profile] = await getProfiles([userId]);

  // Аккаунт удалён или его владелец меня заблокировал.
  if (!profile) throw new ProfileUnavailableError();

  return profile;
}

export async function getMyProfile(): Promise<Profile> {
  return getProfile(await requireUserId());
}

export async function updateMyProfile(input: ProfileUpdateInput): Promise<Profile> {
  const userId = await requireUserId();

  const patch: TablesUpdate<'profiles'> = {};

  if ('username' in input) {
    patch.username = input.username ?? null;
  }
  if ('displayName' in input) {
    patch.display_name = input.displayName ?? null;
  }
  if ('avatarUrl' in input) {
    patch.avatar_url = input.avatarUrl ?? null;
  }
  if ('bio' in input) {
    patch.bio = input.bio ?? null;
  }
  if ('status' in input) {
    patch.status = input.status ?? null;
  }

  // Обновлённую строку таблица не отдаёт — имя читается только через
  // `profile_cards`, и свой профиль она отдаёт настоящим.
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);

  if (error) {
    // 23505 is Postgres unique_violation. The only unique key a profile
    // update can hit is the username among other profiles.
    if (error.code === '23505' && typeof patch.username === 'string') {
      throw new UsernameTakenError(patch.username);
    }

    throw error;
  }

  return getProfile(userId);
}
