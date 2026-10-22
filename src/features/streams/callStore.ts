import { create } from 'zustand';

import type { StreamRole } from '@/api/streams';

/** Как звонок подключён прямо сейчас. */
export type CallConnection = 'connecting' | 'connected' | 'reconnecting';

export type CallSpeaker = {
  /** Identity в комнате LiveKit — не id человека: кто это, говорит база (`listCallPeople`). */
  id: string;
  /** Имени в комнате нет — его подставляет экран звонка из базы. */
  name: string;
  /** Начавший звонок — первым в списке. */
  host: boolean;
  isLocal: boolean;
  speaking: boolean;
  micOn: boolean;
};

export type ActiveCall = {
  streamId: string;
  chatId: string;
  chatTitle: string;
  role: StreamRole;
  connection: CallConnection;
  /** Мой микрофон. У слушателя всегда false — публиковать ему нечем. */
  micOn: boolean;
  /** Громкая связь; иначе разговорный динамик (или гарнитура). */
  speakerOn: boolean;
  speakers: CallSpeaker[];
  listeners: number;
  /** Когда я вошёл — для таймера на экране звонка. */
  joinedAt: number;
};

type CallStoreState = { call: ActiveCall | null };

/**
 * Состояние идущего звонка — чисто клиентское: живёт, пока жива комната
 * LiveKit в этом процессе (`callSession`). Серверное — идёт ли звонок в чате
 * и сколько в нём людей — читается запросами (`useLiveStream`), а не отсюда.
 */
export const useCallStore = create<CallStoreState>(() => ({ call: null }));

export function getCall(): ActiveCall | null {
  return useCallStore.getState().call;
}

export function setCall(call: ActiveCall | null) {
  useCallStore.setState({ call });
}

export function patchCall(patch: Partial<ActiveCall>) {
  const call = getCall();

  if (call) setCall({ ...call, ...patch });
}

export function useActiveCall(): ActiveCall | null {
  return useCallStore((state) => state.call);
}

/** Участник комнаты в том виде, в каком его отдаёт LiveKit. */
export type RoomMember = {
  identity: string;
  name: string | undefined;
  metadata: string | undefined;
  isLocal: boolean;
  isSpeaking: boolean;
  isMicrophoneEnabled: boolean;
};

export function roleOf(metadata: string | undefined): StreamRole | null {
  if (!metadata) return null;

  try {
    const role = (JSON.parse(metadata) as { role?: unknown }).role;

    return role === 'host' || role === 'speaker' || role === 'listener' ? role : null;
  } catch {
    return null;
  }
}

/**
 * Кто говорит и сколько слушают — по составу комнаты. Роль берётся из
 * метаданных токена, которые подписал сервер, — подделать её участник не
 * может. Начавший звонок — первым, дальше по имени (`speakerOrder`): список
 * не прыгает, когда кто-то начинает говорить.
 */
export function toRoster(members: RoomMember[]): { speakers: CallSpeaker[]; listeners: number } {
  const speakers: CallSpeaker[] = [];
  let listeners = 0;

  for (const member of members) {
    const role = roleOf(member.metadata);

    if (role === 'listener' || role === null) {
      // Без роли — не наш токен; говорить он всё равно не может.
      listeners += role === 'listener' ? 1 : 0;
      continue;
    }

    speakers.push({
      id: member.identity,
      name: member.name || 'Без имени',
      isLocal: member.isLocal,
      speaking: member.isSpeaking && member.isMicrophoneEnabled,
      micOn: member.isMicrophoneEnabled,
      host: role === 'host',
    });
  }

  return { speakers: speakers.sort(speakerOrder), listeners };
}

/**
 * Порядок говорящих: начавший первым, дальше по имени, при равных — по
 * identity. Имена в комнате пустые — экран звонка сортирует заново, получив
 * их из базы.
 */
export function speakerOrder(a: CallSpeaker, b: CallSpeaker): number {
  if (a.host !== b.host) return a.host ? -1 : 1;

  return a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id);
}
