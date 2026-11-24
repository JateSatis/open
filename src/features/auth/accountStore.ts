import { createStore, useStore } from 'zustand';

import { perClient } from '@/api/perClient';
import { requestClient } from '@/api/requestClient';
import { useRequestClient } from './RequestClientContext';

/** Экран подписан на свой стор, фоновая операция передаёт исходный API в forClient. */
export function createAccountStore<State>(initial: () => State) {
  const forClient = perClient(
    () => createStore<State>(initial),
    store => store.setState(store.getInitialState(), true),
  );
  function useAccountStore<T>(select: (state: State) => T) {
    return useStore(forClient(useRequestClient()), select);
  }
  return Object.assign(useAccountStore, {
    forClient,
    getState: () => forClient(requestClient()).getState(),
    setState: (update: Partial<State> | ((state: State) => Partial<State>)) =>
      forClient(requestClient()).setState(update),
  });
}
