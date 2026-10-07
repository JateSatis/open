import type { ReactNode } from 'react';
import { View } from 'react-native';

import { styles } from './styles';

export type BubbleFooterProps = {
  /** Чипы реакций участников. Нет реакций — нет и строки. */
  members: ReactNode;
  /** Маленькие реакции зрителей — в строке со временем, после него. */
  visitors: ReactNode;
  /** Время, статус и «ред.» — в левом нижнем углу. */
  meta: ReactNode;
  /** Просмотры — у правого края нижней строки. */
  views: ReactNode;
};

/**
 * Низ облачка: чипы участников своей строкой, под ними — нижняя строка со
 * временем и статусом слева и просмотрами справа. Между ними — реакции
 * зрителей; облачко шире не становится, они ужимаются.
 */
export function BubbleFooter({ members, visitors, meta, views }: BubbleFooterProps) {
  return (
    <>
      {members ? (
        <View testID="bubble-footer-chips" style={styles.footer}>
          <View style={styles.footerShrink}>{members}</View>
        </View>
      ) : null}

      <View testID="bubble-footer-info" style={styles.footer}>
        <View testID="bubble-footer-meta">{meta}</View>
        {visitors ? <View style={styles.footerShrink}>{visitors}</View> : null}
        <View style={styles.footerSpacer} />
        {views ? <View testID="bubble-footer-views">{views}</View> : null}
      </View>
    </>
  );
}
