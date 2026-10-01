export type MediaViewerItem = {
  id: string;
  kind: 'photo' | 'video';
  url: string;
  /** Размер оригинала — по нему увеличенное упирается в свои края. Неизвестен — края экрана. */
  width?: number | null;
  height?: number | null;
};
