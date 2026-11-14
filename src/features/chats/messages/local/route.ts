import { localHistory } from './database';
import { stillReader } from './reader';

export function routeOptions<T>(reader: string | null, key: string, fetch: () => Promise<T>) {
  return {
    initialData: () => (reader ? localHistory().route<T>(reader, key) : undefined),
    initialDataUpdatedAt: 0,
    queryFn: async () => {
      const result = await fetch();
      if (reader && stillReader(reader)) localHistory().setRoute(reader, key, result);
      return result;
    },
  };
}
