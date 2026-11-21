import { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/api/database';
import { checkResponseOwner, requestOwner } from '@/features/auth/sessionState';

export class AccountClient extends SupabaseClient<Database> {
  /** Отложенный запрос прежнего клиента может продолжиться после смены аккаунта. */
  isSelected: () => boolean = () => true;
  // REST, Storage и Functions запрашивают токен и вне React Query. Фиксируем
  // владельца до getSession: за время refresh SDK может подтвердить другой ID.
  protected override accessToken = async () => {
    if (!this.isSelected()) throw new Error('Сессия аккаунта изменилась');
    const owner = requestOwner();
    const {
      data: { session },
    } = await this.auth.getSession();
    if (!this.isSelected()) throw new Error('Сессия аккаунта изменилась');
    checkResponseOwner(owner, session?.user.id);
    return session?.access_token ?? null;
  };
}
