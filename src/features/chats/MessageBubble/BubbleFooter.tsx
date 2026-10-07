import type { ReactNode } from 'react';
import { View } from 'react-native';

import { styles } from './styles';

export type BubbleFooterProps = {
  /** Время, статус и «ред.» — в левом нижнем углу. */
  meta: ReactNode;
  /** Крупный ряд реакций — между статусом и просмотрами. Нет реакций — нет и ряда. */
  reactions: ReactNode;
  /** Просмотры — у правого края нижней строки. */
  views: ReactNode;
  /** Маленькие реакции зрителей — отдельной строкой под нижней, по центру. */
  visitors: ReactNode;
};

/**
 * Низ облачка: слева время и статус, справа просмотры, всё между ними —
 * крупный ряд реакций. Ряд расширяет облачко, пока оно не упрётся в свой
 * предел, дальше прокручивается вбок. Под строкой — реакции зрителей.
 */
export function BubbleFooter({ meta, reactions, views, visitors }: BubbleFooterProps) {
  return (
    <>
      <View testID="bubble-footer-info" style={styles.footer}>
        <View testID="bubble-footer-meta">{meta}</View>
        {reactions ? (
          <View testID="bubble-footer-reactions" style={styles.footerReactions}>
            {reactions}
          </View>
        ) : (
          <View style={styles.footerSpacer} />
        )}
        {views ? <View testID="bubble-footer-views">{views}</View> : null}
      </View>

      {visitors}
    </>
  );
}
