// `@имена`. У человека, канала и группы — раздельные пространства: одно и то
// же имя может быть у всех троих сразу, сравнения между видами нет. Суффикс
// вида (`.ch`, `.di`) в базе не хранится — это только отображение.

import { supabase } from '@/api/supabase';

export type UsernameKind = 'profile' | 'channel' | 'group';

/**
 * Свободно ли имя среди сущностей своего вида, без учёта регистра. Своё
 * текущее имя занятым не считается: у профиля — всегда моё, у канала и группы
 * — сущности `ownId`.
 */
export async function isUsernameAvailable(
  kind: UsernameKind,
  username: string,
  ownId?: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_username_available', {
    target_kind: kind,
    candidate: username,
    own_id: ownId,
  });

  if (error) throw error;

  return data === true;
}
