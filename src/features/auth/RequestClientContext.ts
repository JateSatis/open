import { createContext, useContext } from 'react';

import type { AccountClient } from '@/api/accountClient';
import { requestClient } from '@/api/requestClient';

export const RequestClientContext = createContext<AccountClient | null>(null);

export function useRequestClient() {
  return useContext(RequestClientContext) ?? requestClient();
}
