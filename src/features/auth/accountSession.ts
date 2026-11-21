import type { Session } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { createAccountClient } from '@/api/supabase';
import { isNetworkError } from '@/lib/network';
import { readAccountSession, type AccountSlot } from './accountStorage';
import type { AuthBootstrap } from './sessionState';

export class AccountSession {
  readonly client;
  session: Session | null;
  status: AuthBootstrap['sdkStatus'];
  private stopped = false;
  private readonly unsubscribe: () => void;

  constructor(
    readonly slot: AccountSlot,
    initial: Session | null,
    changed: (account: AccountSession) => void,
  ) {
    const client = createAccountClient(slot.key);
    this.client = client;
    this.session = initial;
    this.status = initial ? 'session' : 'pending';
    let decided = false;

    const update = (session: Session | null, status: AuthBootstrap['sdkStatus']) => {
      if (this.stopped || this.status === 'signedOut') return;
      decided = true;
      this.session = session?.user.id === slot.userId ? session : null;
      this.status = this.session ? status : 'signedOut';
      changed(this);
    };
    const { data } = client.auth.onAuthStateChange((event, session) => {
      // INITIAL_SESSION(null) также приходит при временной ошибке обновления.
      if (event === 'INITIAL_SESSION' && (decided || !session)) return;
      update(session, 'session');
    });
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') void client.auth.startAutoRefresh();
      else void client.auth.stopAutoRefresh();
    });
    this.unsubscribe = () => {
      data.subscription.unsubscribe();
      appState.remove();
    };

    const finish = async (session: Session | null, error: unknown) => {
      // SDK запускает таймер в конце своей асинхронной инициализации.
      if (this.stopped) {
        await client.auth.dispose();
        return;
      }
      if (AppState.currentState === 'background') void client.auth.stopAutoRefresh();
      if (decided) return;
      if (!session && isNetworkError(error)) {
        const stored = await readAccountSession(slot.key);
        if (!decided) update(stored, 'offline');
      } else {
        update(session, 'session');
      }
    };
    void client.auth.getSession().then(
      ({ data: { session }, error }) => finish(session, error),
      (error: unknown) => finish(null, error),
    ).catch(() => {
      // Сетевой сбой сам по себе не лишает пользователя его локального выбора.
      if (!this.stopped && !decided) {
        this.status = 'offline';
        changed(this);
      }
    });
  }

  dispose() {
    this.stopped = true;
    this.unsubscribe();
    void this.client.auth.dispose();
    void this.client.removeAllChannels();
  }
}
