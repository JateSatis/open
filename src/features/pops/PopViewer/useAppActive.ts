import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/** Приложение на экране, а не в фоне: видео играет, только пока это так. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState !== 'background');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      setActive(state === 'active'),
    );

    return () => subscription.remove();
  }, []);

  return active;
}
