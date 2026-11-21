// SDK signOut удаляет текущую локальную сессию после сетевого await.
// Вход и привязка, выдающие новую сессию, должны дождаться этой записи.
let pending = Promise.resolve();

export function withSessionChange<T>(change: () => Promise<T>): Promise<T> {
  const result = pending.then(change);
  pending = result.then(() => undefined, () => undefined);
  return result;
}
