/** Замеры низа облачка: ширина содержимого и частей низа. */
export type FooterLayout = {
  contentWidth?: number;
  chips?: number;
  visitors?: number;
  meta?: number;
  views?: number;
  button?: number;
};

/** Столько облачков помнить: больше на экране и рядом с ним не бывает. */
const MAX_ENTRIES = 500;

const cache = new Map<string, FooterLayout>();

/**
 * Последние замеры низа облачка этого сообщения. Копия облачка (над шитом
 * комментариев, в меню) рождается заново и без замеров поставила бы кнопку
 * комментариев в строку со временем, а через пару кадров перенесла бы её к
 * реакциям — копия заметно дёргалась бы. С замерами оригинала она с первого
 * кадра разложена так же, как он.
 */
export function readFooterLayout(key: string): FooterLayout {
  return cache.get(key) ?? {};
}

export function writeFooterLayout(key: string, patch: FooterLayout) {
  const next = { ...cache.get(key), ...patch };

  // Свежие — в конец: вытесняются самые давние.
  cache.delete(key);
  cache.set(key, next);

  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;

    if (oldest !== undefined) cache.delete(oldest);
  }
}
