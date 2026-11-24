import { useMemo } from 'react';

import { requestSelection } from '@/api/screenRequest';
import { showNotice } from './alertsStore';

/** Поздний ответ действия может показать уведомление только на исходном экране аккаунта. */
export function useScreenNotice(): typeof showNotice {
  return useMemo(() => {
    const selection = requestSelection();
    return (...args) => {
      if (selection === requestSelection()) showNotice(...args);
    };
  }, []);
}
