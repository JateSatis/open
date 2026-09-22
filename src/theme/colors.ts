import '@/global.css';

export const Colors = {
  light: {
    text: '#000000',
    textSecondary: '#60646C',
    textInverse: '#ffffff',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    border: '#E0E1E6',
    primary: '#3C87F7',
    primaryText: '#ffffff',
    danger: '#E5484D',
    success: '#30A46C',
    /** Полноэкранный просмотр медиа — фон один и тот же в обеих темах, как летбокс. */
    viewerBackground: '#000000',
    /** Полупрозрачная плашка для контролов и бейджей поверх фото/видео. */
    mediaScrim: 'rgba(0, 0, 0, 0.5)',
    /** Затемнение фона под модальными окнами — одинаковое в обеих темах. */
    overlay: 'rgba(0, 0, 0, 0.5)',
  },
  dark: {
    text: '#ffffff',
    textSecondary: '#B0B4BA',
    textInverse: '#000000',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    border: '#2E3135',
    primary: '#3C87F7',
    primaryText: '#ffffff',
    danger: '#FF6369',
    success: '#3DD68C',
    viewerBackground: '#000000',
    mediaScrim: 'rgba(0, 0, 0, 0.5)',
    overlay: 'rgba(0, 0, 0, 0.5)',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;
