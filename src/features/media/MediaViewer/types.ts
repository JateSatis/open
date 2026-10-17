export type MediaViewerItem = {
  id: string;
  kind: 'photo' | 'video';
  url: string;
  /**
   * Картинка, которую показывает плитка этого медиа: у фото — само фото, у
   * видео — постер. С неё начинается перелёт и под ней грузится видео.
   */
  thumbUrl?: string | null;
  /** Размер оригинала — по нему увеличенное упирается в свои края. Неизвестен — края экрана. */
  width?: number | null;
  height?: number | null;
};
