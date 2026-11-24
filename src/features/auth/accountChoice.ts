import type { Session } from '@supabase/supabase-js';
import { requestSelection } from '@/api/screenRequest';
import { confirm } from '@/components/ConfirmDialog/store';
import { callParticipation, getCall } from '@/features/streams/callStore';
import type { AccountSlot } from './accountStorage';
import { addSession, getSelectedAccountId, selectAccount, useSessionStore } from './sessionStore';

async function allowSwitch(selection: number) {
  const current = () => selection === requestSelection();
  const call = getCall();
  const participation = callParticipation();
  if (call && current()) {
    const agreed = await confirm({
      title: 'Выйти из звонка и переключиться?',
      confirmLabel: 'Переключиться',
      cancelLabel: 'Отмена',
    });
    if (!agreed) return () => false;
  }
  return () => current() && (!getCall() || (call !== null && participation === callParticipation()));
}

export async function chooseSavedAccount(slot: AccountSlot, selection: number) {
  const allowed = await allowSwitch(selection);
  await selectAccount(slot.userId, () => allowed() && useSessionStore.getState().accounts.includes(slot));
}

export function activateProviderSession(selection: number) {
  return async (session: Session) => {
    if (selection !== requestSelection()) return false;
    if (session.user.id === getSelectedAccountId()) return true;
    const allowed = await allowSwitch(selection);
    return addSession(session, allowed);
  };
}
