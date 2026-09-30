import { create } from 'zustand';

import type { StreamRole } from '@/api/streams';

/** Как звонок подключён прямо сейчас. */
export type CallConnection = 'connecting' | 'connected' | 'reconnecting';

export type CallSpeaker = {
  /** id пользователя — он же identity в комнате LiveKit. */
  id: string;
  name: string;
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
 * может. Начавший звонок — первым, дальше по имени: список не прыгает, когда
 * кто-то начинает говорить.
 */
export function toRoster(members: RoomMember[]): { speakers: CallSpeaker[]; listeners: number } {
  const speakers: (CallSpeaker & { isHost: boolean })[] = [];
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
      isHost: role === 'host',
    });
  }

  speakers.sort((a, b) => {
    if (a.isHost !== b.isHost) return a.isHost ? -1 : 1;

    return a.name.localeCompare(b.name, 'ru');
  });

  return { speakers: speakers.map(({ isHost: _host, ...speaker }) => speaker), listeners };
}
