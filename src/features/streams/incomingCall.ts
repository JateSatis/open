import { router } from 'expo-router';
import { create } from 'zustand';

import type { IncomingCall } from '@/api/chats';
import { getCall } from '@/features/streams/callStore';
import { incomingTitle } from '@/features/streams/callText';
import { showNotice } from '@/features/notifications/alertsStore';
import { isInCall } from '@/store/callPresence';

/** Сколько звонит входящий. Дальше звонок идёт без звонка — через полосу в чате. */
export const RING_MS = 45_000;

type IncomingState = { ringing: IncomingCall | null };

/**
 * Входящий звонок, который звонит прямо сейчас. Отклонение — только у меня и
 * только на этом устройстве: для остальных звонок идёт, а я могу войти позже
 * через полосу звонка в чате.
 */
export const useIncomingCall = create<IncomingState>(() => ({ ringing: null }));

const declined = new Set<string>();
let expiry: ReturnType<typeof setTimeout> | null = null;

function clear() {
  if (expiry) clearTimeout(expiry);

  expiry = null;
  useIncomingCall.setState({ ringing: null });
}

/** Звонок начали в чате, где я участник. */
export function ring(call: IncomingCall, now: number = Date.now()) {
  const left = Date.parse(call.startedAt) + RING_MS - now;

  if (declined.has(call.streamId) || left <= 0) return;
  if (getCall()?.streamId === call.streamId) return;
  if (useIncomingCall.getState().ringing?.streamId === call.streamId) return;

  // Уже говорю в другом звонке — полноэкранный звонок оборвал бы разговор
  // на полуслове. Хватит короткой карточки.
  if (isInCall()) {
    showNotice(`Входящий звонок · ${incomingTitle(call)}`, 'info', {
      label: 'Открыть чат',
      run: () => router.push(`/chats/${call.chatId}`),
    });
    return;
  }

  if (expiry) clearTimeout(expiry);

  useIncomingCall.setState({ ringing: call });
  expiry = setTimeout(clear, left);
}

export function declineRinging() {
  const current = useIncomingCall.getState().ringing;

  if (current) declined.add(current.streamId);

  clear();
}

/** Принять: звонок перестаёт звонить, дальше — вход (`useJoinCall`). */
export function takeRinging(): IncomingCall | null {
  const current = useIncomingCall.getState().ringing;

  clear();

  return current;
}

/** Звонок кончился, пока звонил, или я вошёл в него с другого экрана. */
export function stopRinging(streamId: string) {
  if (useIncomingCall.getState().ringing?.streamId === streamId) clear();
}

/** Сброс при выходе из аккаунта. */
export function resetRinging() {
  declined.clear();
  clear();
}
