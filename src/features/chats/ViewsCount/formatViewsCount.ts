/**
 * Число просмотров коротко, как в Telegram: до тысячи — как есть, дальше —
 * тысячи и миллионы с одной цифрой после запятой, пока число двузначное не
 * перевалило: 1,2K, 15K, 2,4M. Округление вниз — не показывать больше, чем
 * набралось.
 */
export function formatViewsCount(count: number): string {
  if (count < 1000) return String(count);

  const [value, suffix] = count < 1_000_000 ? [count / 1000, 'K'] : [count / 1_000_000, 'M'];

  if (value >= 10) return `${Math.floor(value)}${suffix}`;

  const tenths = Math.floor(value * 10) / 10;

  return `${String(tenths).replace('.', ',')}${suffix}`;
}
