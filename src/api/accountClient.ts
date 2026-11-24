import { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/api/database';
import { ownerOf, sameSession, type SessionOwner } from '@/features/auth/sessionOwner';

export class AccountClient extends SupabaseClient<Database> {
  // Без слота этот клиент служит публичному API или обмену токена провайдера.
  retired = false;
  /** Диск этого сеанса доступен также до подтверждения сети. */
  localSessionId?: string;
  sessionOwner?: () => SessionOwner | null;

  protected override accessToken = async () => {
    if (!this.sessionOwner) return null;
    const owner = this.sessionOwner();
    if (!owner) throw new Error('Требуется активная сессия аккаунта');
    const { data: { session }, error } = await this.auth.getSession();
    if (error) throw error;
    if (!session || !sameSession(owner, ownerOf(session)) || !sameSession(owner, this.sessionOwner())) {
      throw new Error('Сессия аккаунта изменилась');
    }
    return session.access_token;
  };
}
