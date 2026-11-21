import { supabase } from './supabase';
import { isCurrentSession, ownerOf, sameSession, type SessionOwner } from '@/features/auth/sessionOwner';

// После долгого фона SDK обновляет JWT. Закрепляем свежий токен именно
// запрошенного сеанса, чтобы последующий HTTP-запрос не взял чужой.
export async function sessionAuthorization(owner: SessionOwner) {
  if (!isCurrentSession(owner)) throw new Error('Сессия аккаунта изменилась');
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session || !sameSession(owner, ownerOf(session)) || !isCurrentSession(owner)) {
    throw new Error('Сессия аккаунта изменилась');
  }
  return `Bearer ${session.access_token}`;
}
