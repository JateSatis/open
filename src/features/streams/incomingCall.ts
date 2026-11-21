import { router } from '@/navigation';
import { create } from 'zustand';

import type { IncomingCall } from '@/api/chats';
import { getCall } from '@/features/streams/callStore';
import { incomingTitle } from '@/features/streams/callText';
import { showNotice } from '@/features/notifications/alertsStore';
import { startRinger } from './ringer';
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

// После окончания серверного окна даже запоздавший ответ уже не может зазвонить.
const handledUntil = new Map<string, number>();
let stopRinger: (() => void) | undefined;
let expiry: ReturnType<typeof setTimeout> | null = null;

function forgetExpired(now: number) {
  for (const [id, until] of handledUntil) {
    if (until <= now) handledUntil.delete(id);
  }
}

function stopSignal() {
  if (expiry !== null) clearTimeout(expiry);

  expiry = null;
  stopRinger?.();
  stopRinger = undefined;
}

function clear() {
  stopSignal();
  useIncomingCall.setState({ ringing: null });
}

/** Звонок начали в чате, где я участник. */
export function ring(call: IncomingCall, now: number = Date.now()) {
  const left = Date.parse(call.startedAt) + RING_MS - now;

  forgetExpired(now);
  if (handledUntil.has(call.streamId) || !Number.isFinite(left) || left <= 0) return;
  handledUntil.set(call.streamId, now + left);
  if (getCall()?.streamId === call.streamId) return;

  // Уже говорю в другом звонке — полноэкранный звонок оборвал бы разговор
  // на полуслове. Хватит короткой карточки.
  if (isInCall()) {
    showNotice(`Входящий звонок · ${incomingTitle(call)}`, 'info', {
      label: 'Открыть чат',
      run: () => router.push({ name: 'Chat', params: { chatId: call.chatId } }),
    });
    return;
  }

  stopSignal();
  expiry = setTimeout(clear, left);
  stopRinger = startRinger();
  useIncomingCall.setState({ ringing: call });
}

export function declineRinging() {
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
  const now = Date.now();
  forgetExpired(now);
  if (!handledUntil.has(streamId)) handledUntil.set(streamId, now + RING_MS);
  if (useIncomingCall.getState().ringing?.streamId === streamId) clear();
}

/** Сброс при выходе из аккаунта. */
export function resetRinging() {
  handledUntil.clear();
  clear();
}
