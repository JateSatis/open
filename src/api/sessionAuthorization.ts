import { requestClient } from '@/api/requestClient';
import { ownerOf, sameSession, type SessionOwner } from '@/features/auth/sessionOwner';

// После долгого фона SDK обновляет JWT. Закрепляем свежий токен именно
// запрошенного сеанса, чтобы последующий HTTP-запрос не взял чужой.
export async function sessionAuthorization(owner: SessionOwner, api = requestClient()) {
  if (api.sessionOwner && !sameSession(owner, api.sessionOwner())) throw new Error('Сессия аккаунта изменилась');
  const { data: { session }, error } = await api.auth.getSession();
  if (error) throw error;
  if (!session || !sameSession(owner, ownerOf(session)) || api.sessionOwner && !sameSession(owner, api.sessionOwner())) {
    throw new Error('Сессия аккаунта изменилась');
  }
  return `Bearer ${session.access_token}`;
}
