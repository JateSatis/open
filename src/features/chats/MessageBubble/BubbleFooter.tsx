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
  /** Маленькие реакции зрителей — в нижней строке, по центру между временем и просмотрами. */
  visitors: ReactNode;
};

/**
 * Низ облачка: сверху крупный ряд реакций (расширяет облачко до его предела,
 * дальше прокручивается вбок), а самой нижней строкой — полоска статуса:
 * слева время и статус, справа просмотры, между ними по центру реакции
 * зрителей. Ряд и строка зрителей прокручиваются сами по себе — время и
 * просмотры стоят на месте.
 */
export function BubbleFooter({ meta, reactions, views, visitors }: BubbleFooterProps) {
  return (
    <>
      {reactions ? (
        <View testID="bubble-footer-reactions" style={styles.footerReactions}>
          {reactions}
        </View>
      ) : null}

      <View testID="bubble-footer-info" style={styles.footer}>
        <View testID="bubble-footer-meta" style={styles.footerEdge}>
          {meta}
        </View>
        <View testID="bubble-footer-visitors" style={styles.footerMiddle}>
          {visitors}
        </View>
        {views ? (
          <View testID="bubble-footer-views" style={styles.footerEdge}>
            {views}
          </View>
        ) : null}
      </View>
    </>
  );
}
