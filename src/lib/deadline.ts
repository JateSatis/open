/** Операция не уложилась в срок — для интерфейса это та же потеря связи. */
export class DeadlineError extends Error {
  constructor() {
    super('Network request timeout');
    this.name = 'DeadlineError';
  }
}

/**
 * Ждёт `promise` не дольше `ms`. Сама операция при этом не отменяется: если
 * она всё же завершится после срока, её результат получит `onLate` — чтобы,
 * например, убрать загруженный зря файл.
 */
export function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  onLate?: (value: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(new DeadlineError());
    }, ms);

    promise.then(
      (value) => {
        if (expired) {
          onLate?.(value);
          return;
        }

        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (expired) return;

        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
