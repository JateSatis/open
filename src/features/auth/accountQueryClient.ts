import { perClient } from '@/api/perClient';
import { createAppQueryClient } from '@/lib/queryClient';

export const accountQueryClient = perClient(
  api => createAppQueryClient(api.localAccountId ?? null, api),
  client => {
    // Уже запущенная мутация может вернуть оптимистичный снимок в onError даже после clear().
    const cache = client.getQueryCache();
    cache.subscribe(event => {
      if (event.type === 'added') cache.remove(event.query);
    });
    void client.cancelQueries();
    client.clear();
  },
);
