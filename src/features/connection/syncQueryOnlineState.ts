import { onlineManager } from '@tanstack/react-query';

import { getConnectionStatus, subscribeToConnectionStatus } from './connectionStore';

export function syncQueryOnlineState() {
  const sync = () => {
    // После возврата Wi-Fi запрос уже может пройти, пока сокет ещё подключается.
    onlineManager.setOnline(getConnectionStatus() !== 'offline');
  };

  const unsubscribe = subscribeToConnectionStatus(sync);
  sync();
  return unsubscribe;
}
