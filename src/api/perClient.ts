import type { AccountClient } from './accountClient';

const releases = new WeakMap<AccountClient, Set<() => void>>();

export function releaseClientResources(api: AccountClient) {
  releases.get(api)?.forEach(release => release());
  releases.delete(api);
}

/** Разные SDK-клиенты никогда не объединяют запросы и их результаты. */
export function perClient<T>(create: (api: AccountClient) => T, dispose?: (value: T) => void) {
  const values = new WeakMap<AccountClient, T>();
  return (api: AccountClient) => {
    const existing = values.get(api);
    if (existing !== undefined) return existing;

    const value = create(api);
    values.set(api, value);
    if (dispose) {
      const owned = releases.get(api) ?? new Set<() => void>();
      owned.add(() => {
        values.delete(api);
        dispose(value);
      });
      releases.set(api, owned);
    }
    return value;
  };
}

/** Непрозрачная метка исходящей записи. SDK и его токены не попадают в модель UI. */
export const clientIdentity = perClient(() => Symbol('account'));
