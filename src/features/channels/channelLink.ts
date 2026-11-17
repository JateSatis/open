/** Схема диплинков приложения (app.json, `scheme`). */
const APP_SCHEME = 'openger';

/**
 * Ссылка на канал для буфера: `openger://c/<имя>`. Открытая на телефоне с
 * Open, ведёт на экран канала (маршрут `ChannelLink`). Когда
 * появится домен, формат сменится на https, а маршрут останется прежним —
 * старые ссылки продолжат работать.
 */
export function channelLink(username: string): string {
  return `${APP_SCHEME}://c/${username}`;
}
