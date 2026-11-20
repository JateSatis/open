import { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/api/database';
import { checkResponseOwner, requestOwner } from '@/features/auth/sessionState';

export class AccountClient extends SupabaseClient<Database> {
  // REST, Storage и Functions запрашивают токен и вне React Query. Фиксируем
  // владельца до getSession: за время refresh SDK может подтвердить другой ID.
  protected override accessToken = async () => {
    const owner = requestOwner();
    const {
      data: { session },
    } = await this.auth.getSession();
    checkResponseOwner(owner, session?.user.id);
    return session?.access_token ?? null;
  };
}
