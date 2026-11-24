// Каталог аккаунтов записывается целиком. Выбор, добавление, отзыв и привязка
// последовательно фиксируют изменения, включая ответ SDK для конкретного сеанса.
function serialQueue() {
  let pending = Promise.resolve();
  return function enqueue<T>(change: () => Promise<T>): Promise<T> {
    const result = pending.then(change);
    pending = result.then(() => undefined, () => undefined);
    return result;
  };
}

export const withSessionChange = serialQueue();
// Выбор с диска не ждёт сетевых операций регистрации, выхода или привязки.
export const withAccountIndex = serialQueue();
