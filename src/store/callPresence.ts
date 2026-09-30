import { create } from 'zustand';

// Идёт ли у меня звонок. Отдельно от состояния звонка (features/streams), чтобы
// другим фичам — записи голосового, входящему звонку — не тянуть за собой
// LiveKit: им нужно знать только «микрофон занят звонком».

type CallPresenceState = { inCall: boolean };

const useCallPresenceStore = create<CallPresenceState>(() => ({ inCall: false }));

export function setInCall(inCall: boolean) {
  useCallPresenceStore.setState({ inCall });
}

export function isInCall(): boolean {
  return useCallPresenceStore.getState().inCall;
}

export function useInCall(): boolean {
  return useCallPresenceStore((state) => state.inCall);
}
