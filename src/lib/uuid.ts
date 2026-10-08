/**
 * Случайный uuid v4 для id, которые выбирает клиент (повтор публикации не
 * создаёт дубль). Не секрет — сервер проверяет права, а не id.
 */
export function randomUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);

    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
