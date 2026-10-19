/** Тени. Цвет — токен `shadow` темы; здесь — только форма. */
export const Shadows = {
  /** Плавающая кнопка над списком: отделяет нейтральную плашку от строк под ней. */
  floating: {
    elevation: 6,
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  /** Шапка экрана над содержимым — как тень нативной шапки стека на Android. */
  header: {
    elevation: 4,
    shadowOpacity: 0.15,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  /** Текст и значки прямо на видео, без подложки: читаются и на светлом кадре. */
  onMedia: {
    shadowOpacity: 0.5,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  /** То же для текста: `textShadow*` вместо `shadow*`. */
  textOnMedia: {
    textShadowRadius: 3,
    textShadowOffset: { width: 0, height: 1 },
  },
} as const;
