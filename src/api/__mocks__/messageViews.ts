// Ручной мок просмотров для тестов экранов: запись молча проходит, свежих
// чисел нет. Тест, которому нужны просмотры, подменяет функции сам.

export const MAX_VIEWS_BATCH = 200;
export const recordMessageViews = jest.fn(() => Promise.resolve());
export const listMessageViews = jest.fn(() => Promise.resolve([]));
