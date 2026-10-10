import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/** На старте состояние бывает `unknown` — приложение при этом на экране. */
function isForeground(state: AppStateStatus | null): boolean {
  return state !== 'background' && state !== 'inactive';
}

/** Приложение на экране, а не в фоне: видео играет, только пока это так. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(isForeground(AppState.currentState));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      setActive(isForeground(state)),
    );

    return () => subscription.remove();
  }, []);

  return active;
}
