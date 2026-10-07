/** Тени. Цвет — токен `shadow` темы; здесь — только форма. */
export const Shadows = {
  /** Плавающая кнопка над списком: отделяет нейтральную плашку от строк под ней. */
  floating: {
    elevation: 6,
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
} as const;
