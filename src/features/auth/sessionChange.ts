// Каталог аккаунтов записывается целиком. Выбор, добавление, отзыв и привязка
// последовательно фиксируют изменения, включая ответ SDK для конкретного сеанса.
let pending = Promise.resolve();

export function withSessionChange<T>(change: () => Promise<T>): Promise<T> {
  const result = pending.then(change);
  pending = result.then(() => undefined, () => undefined);
  return result;
}
