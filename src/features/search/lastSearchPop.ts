import { create } from 'zustand';

/**
 * Последний поп, который смотрели в просмотре выдачи. Сетка, вернувшись,
 * прокручивается к нему, если он ушёл с экрана. Клиентское состояние экрана,
 * не данные сервера.
 */
export const useLastSearchPop = create<{ id: string | null }>(() => ({ id: null }));

export function setLastSearchPop(pop: { id: string }) {
  useLastSearchPop.setState({ id: pop.id });
}
