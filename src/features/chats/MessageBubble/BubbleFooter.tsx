import { useCallback, useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

import { readFooterLayout, writeFooterLayout } from './footerLayoutCache';
import { styles } from './styles';

import { Spacing } from '@/theme';

export type BubbleFooterProps = {
  /** Чипы реакций участников. Нет реакций — нет и строки. */
  members: ReactNode;
  /** Маленькие реакции зрителей — в строке со временем, после него. */
  visitors: ReactNode;
  /** Кнопка комментариев — правее всего остального в своей строке. */
  comments: ReactNode;
  /** Тихая кнопка всегда стоит в строке со временем, размером с его шрифт. */
  quiet: boolean;
  /** Время — в левом нижнем углу. */
  meta: ReactNode;
  /** Просмотры — у правого края нижней строки, перед кнопкой комментариев. */
  views: ReactNode;
  /**
   * Ширина содержимого облачка без низа — текста, цитат, голосового. У
   * подписи альбома её задаёт мозаика. `null` — ещё не измерена.
   */
  contentWidth: number | null;
  /**
   * Чей это низ — id сообщения. Замеры запоминаются по нему, и копия облачка
   * с первого кадра разложена как оригинал (`footerLayoutCache`).
   */
  layoutKey?: string;
};

type Widths = { chips: number; visitors: number; meta: number; views: number; button: number };

const GAP = Spacing.two;

/**
 * Низ облачка. Ширину облачка задаёт содержимое, а не реакции и кнопки,
 * поэтому раскладка подстраивается под неё:
 * - нижняя строка: слева время и реакции зрителей, справа просмотры;
 * - кнопка комментариев и чипы участников помещаются в одну строку — так и
 *   стоят, кнопка справа от чипов;
 * - не помещаются — кнопка уходит под чипы, в нижнюю строку, правее
 *   просмотров.
 *
 * Решение — по ширинам без самой кнопки: так строка, куда её поставили, не
 * раздвигает облачко, и раскладка не перескакивает туда-обратно.
 */
export function BubbleFooter({
  members,
  visitors,
  comments,
  quiet,
  meta,
  views,
  contentWidth,
  layoutKey,
}: BubbleFooterProps) {
  const [widths, setWidths] = useState<Partial<Widths>>(() => {
    if (!layoutKey) return {};

    const { chips, visitors, meta, views, button } = readFooterLayout(layoutKey);

    return { chips, visitors, meta, views, button };
  });

  const measure = useCallback(
    (key: keyof Widths) => (event: LayoutChangeEvent) => {
      const { width } = event.nativeEvent.layout;

      if (layoutKey) writeFooterLayout(layoutKey, { [key]: width });

      setWidths((current) => (current[key] === width ? current : { ...current, [key]: width }));
    },
    [layoutKey],
  );

  const { chips, button } = widths;
  const info =
    (widths.meta ?? 0) +
    (visitors ? GAP + (widths.visitors ?? 0) : 0) +
    (views ? GAP + (widths.views ?? 0) : 0);
  const room =
    contentWidth !== null && chips !== undefined ? Math.max(contentWidth, chips, info) : null;
  const besideChips =
    Boolean(comments) &&
    !quiet &&
    Boolean(members) &&
    room !== null &&
    button !== undefined &&
    chips !== undefined &&
    chips + GAP + button <= room;

  const commentsButton = comments ? (
    <View testID="bubble-footer-button" onLayout={measure('button')}>
      {comments}
    </View>
  ) : null;

  return (
    <>
      {members ? (
        <View testID="bubble-footer-chips" style={styles.footer}>
          <View
            testID="bubble-footer-chips-content"
            onLayout={measure('chips')}
            style={styles.footerShrink}
          >
            {members}
          </View>
          {besideChips ? (
            <>
              <View style={styles.footerSpacer} />
              {commentsButton}
            </>
          ) : null}
        </View>
      ) : null}

      <View testID="bubble-footer-info" style={styles.footer}>
        <View testID="bubble-footer-meta" onLayout={measure('meta')}>
          {meta}
        </View>
        {visitors ? (
          <View onLayout={measure('visitors')} style={styles.footerShrink}>
            {visitors}
          </View>
        ) : null}
        <View style={styles.footerSpacer} />
        {views ? (
          <View testID="bubble-footer-views" onLayout={measure('views')}>
            {views}
          </View>
        ) : null}
        {besideChips ? null : commentsButton}
      </View>
    </>
  );
}
