import type { AccountClient } from './accountClient';

/** Разные SDK-клиенты никогда не объединяют запросы и их результаты. */
export function perClient<T>(create: (api: AccountClient) => T) {
  const values = new WeakMap<AccountClient, T>();
  return (api: AccountClient) => {
    let value = values.get(api);
    if (value === undefined) {
      value = create(api);
      values.set(api, value);
    }
    return value;
  };
}

/** Непрозрачная метка исходящей записи. SDK и его токены не попадают в модель UI. */
export const clientIdentity = perClient(() => Symbol('account'));
