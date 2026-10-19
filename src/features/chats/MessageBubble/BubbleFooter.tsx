import type { ReactNode } from 'react';
import { View } from 'react-native';

import { styles } from './styles';

export type BubbleFooterProps = {
  /** Время, статус и «ред.» — в левом нижнем углу. */
  meta: ReactNode;
  /** Крупный ряд реакций — над полоской статуса. Нет реакций — нет и ряда. */
  reactions: ReactNode;
  /** Просмотры — у правого края нижней строки. */
  views: ReactNode;
  /** Маленькие реакции зрителей — строкой под крупным рядом, над полоской статуса. */
  visitors: ReactNode;
};

/**
 * Низ облачка: сверху крупный ряд реакций (расширяет облачко до его предела,
 * дальше прокручивается вбок), под ним реакции зрителей, а самой нижней
 * строкой — полоска статуса: слева время и статус, справа просмотры. Ряд
 * прокручивается сам по себе — полоску он не двигает и не перекрывает.
 */
export function BubbleFooter({ meta, reactions, views, visitors }: BubbleFooterProps) {
  return (
    <>
      {reactions ? (
        <View testID="bubble-footer-reactions" style={styles.footerReactions}>
          {reactions}
        </View>
      ) : null}

      {visitors}

      <View testID="bubble-footer-info" style={styles.footer}>
        <View testID="bubble-footer-meta">{meta}</View>
        <View style={styles.footerSpacer} />
        {views ? <View testID="bubble-footer-views">{views}</View> : null}
      </View>
    </>
  );
}
