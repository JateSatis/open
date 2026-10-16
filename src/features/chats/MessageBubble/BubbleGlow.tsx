import { Image, StyleSheet } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

// Форма ореола нарисована заранее: альфа гаснет от края облачка наружу и к
// верху и низу. Тень или размытие на каждом облачке длинного списка стоили бы
// кадров прокрутки, а растянутая картинка с заливкой цветом — ничего.
const GLOW = require('../../../../assets/images/bubble-glow.png');

/**
 * Мягкий ореол цвета приложения с внешней стороны облачка, у которого на
 * тексте есть кластеры фрагментов: у своего (справа) — слева, у чужого —
 * справа. Лежит вне облачка и раскладку не трогает. `inset` — верхний
 * отступ облачка.
 */
export function BubbleGlow({ isOwn, inset = 0 }: { isOwn: boolean; inset?: number }) {
  const theme = useTheme();

  return (
    <Image
      testID="bubble-glow"
      source={GLOW}
      resizeMode="stretch"
      style={[
        styles.glow,
        isOwn ? styles.own : styles.other,
        { top: inset, tintColor: theme.bubbleGlow },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  glow: {
    position: 'absolute',
    // Процент высоты Yoga считает от содержимого без отступов: у облачка с
    // отступами ореол встаёт напротив содержимого (`inset`) и гаснет, не
    // доходя до скруглённых углов.
    height: '100%',
    width: Sizes.bubbleGlow,
    pointerEvents: 'none',
  },
  // Картинка гаснет слева направо — у своего облачка она зеркальна.
  own: {
    left: -Sizes.bubbleGlow,
    transform: [{ scaleX: -1 }],
  },
  other: {
    right: -Sizes.bubbleGlow,
  },
});
