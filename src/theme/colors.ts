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
    /** Текст и значки на `mediaScrim` — белые в обеих темах, фон под ними всегда тёмный. */
    textOnMedia: '#ffffff',
    /** Затемнение фона под модальными окнами — одинаковое в обеих темах. */
    overlay: 'rgba(0, 0, 0, 0.5)',
    /** Непроигранные столбики волны голосового в чужом облачке. */
    waveformRest: 'rgba(96, 100, 108, 0.35)',
    /** То же в своём облачке, на `primary`. */
    waveformRestOnPrimary: 'rgba(255, 255, 255, 0.45)',
    /** Фон строки выбранного сообщения и короткая подсветка того, к которому прыгнули. */
    messageHighlight: 'rgba(60, 135, 247, 0.18)',
    /** Подложка цитаты в чужом облачке. */
    quoteBackground: 'rgba(60, 135, 247, 0.10)',
    /** То же в своём облачке, на `primary`. */
    quoteBackgroundOnPrimary: 'rgba(255, 255, 255, 0.18)',
    /** Чип реакции участников в чужом облачке и под альбомом без подписи. */
    reactionChip: 'rgba(60, 135, 247, 0.12)',
    /** То же в своём облачке, на `primary`. */
    reactionChipOnPrimary: 'rgba(255, 255, 255, 0.2)',
    /** Моя реакция в своём облачке: чип светлый, число — цветом `primary`. */
    reactionChipMineOnPrimary: '#ffffff',
    /** Тихий ряд реакций посетителей в своём облачке. */
    reactionVisitorsOnPrimary: 'rgba(255, 255, 255, 0.7)',
    /** Подсветка моей реакции в тихом ряду посетителей. */
    reactionVisitorMine: 'rgba(60, 135, 247, 0.16)',
    /** То же в своём облачке. */
    /** Отметка «В эфире» — красная, как запись: её нельзя не заметить. */
    onAir: '#E5484D',
    /** Полоса идущего звонка и «Вернуться к звонку». */
    callBar: '#30A46C',
    /** Экран звонка и входящего — тёмный в обеих темах, как у системной звонилки. */
    callBackground: '#101214',
    /** Круглые кнопки на экране звонка. */
    callControl: 'rgba(255, 255, 255, 0.14)',
    /** Включённая кнопка (громкая связь) — светлая. */
    callControlActive: '#ffffff',
    /** Приглушённый текст на тёмном экране звонка. */
    textOnCallSecondary: 'rgba(255, 255, 255, 0.7)',
    reactionVisitorMineOnPrimary: 'rgba(255, 255, 255, 0.24)',
    /** Пунктир вокруг островка пересылки — акцентный, но тише облачков внутри. */
    islandBorder: 'rgba(60, 135, 247, 0.6)',
    /** Плашка с чатом, откуда переслали. */
    islandPlate: 'rgba(60, 135, 247, 0.12)',
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
    textOnMedia: '#ffffff',
    overlay: 'rgba(0, 0, 0, 0.5)',
    waveformRest: 'rgba(176, 180, 186, 0.35)',
    waveformRestOnPrimary: 'rgba(255, 255, 255, 0.45)',
    messageHighlight: 'rgba(60, 135, 247, 0.28)',
    quoteBackground: 'rgba(60, 135, 247, 0.18)',
    quoteBackgroundOnPrimary: 'rgba(255, 255, 255, 0.18)',
    reactionChip: 'rgba(60, 135, 247, 0.22)',
    reactionChipOnPrimary: 'rgba(255, 255, 255, 0.2)',
    reactionChipMineOnPrimary: '#ffffff',
    reactionVisitorsOnPrimary: 'rgba(255, 255, 255, 0.7)',
    reactionVisitorMine: 'rgba(60, 135, 247, 0.28)',
    reactionVisitorMineOnPrimary: 'rgba(255, 255, 255, 0.24)',
    onAir: '#FF6369',
    callBar: '#2F9E64',
    callBackground: '#101214',
    callControl: 'rgba(255, 255, 255, 0.14)',
    callControlActive: '#ffffff',
    textOnCallSecondary: 'rgba(255, 255, 255, 0.7)',
    islandBorder: 'rgba(60, 135, 247, 0.7)',
    islandPlate: 'rgba(60, 135, 247, 0.22)',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;
