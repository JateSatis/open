import { useCallback, useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

import { readFooterLayout, writeFooterLayout } from './footerLayoutCache';
import { styles } from './styles';

import { Spacing } from '@/theme';

export type BubbleFooterProps = {
  isOwn: boolean;
  /** Чипы реакций участников. Нет реакций — нет и строки. */
  members: ReactNode;
  /** Маленькие реакции зрителей — в строке со временем. */
  visitors: ReactNode;
  /** Кнопка комментариев — у внешнего края облачка: у чужого слева, у своего справа. */
  comments: ReactNode;
  /** Тихая кнопка всегда стоит в строке со временем, размером с его шрифт. */
  quiet: boolean;
  meta: ReactNode;
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

type Widths = { chips: number; visitors: number; meta: number; button: number };

const GAP = Spacing.two;

/**
 * Низ облачка. Ширину облачка задаёт содержимое, а не реакции и кнопки,
 * поэтому раскладка подстраивается под неё:
 * - кнопка комментариев и чипы участников помещаются в одну строку — так и
 *   стоят, кнопка у внешнего края;
 * - не помещаются — кнопка уходит под чипы, в строку с реакциями зрителей и
 *   временем.
 *
 * Решение — по ширинам без самой кнопки: так строка, куда её поставили, не
 * раздвигает облачко, и раскладка не перескакивает туда-обратно.
 */
export function BubbleFooter({
  isOwn,
  members,
  visitors,
  comments,
  quiet,
  meta,
  contentWidth,
  layoutKey,
}: BubbleFooterProps) {
  const [widths, setWidths] = useState<Partial<Widths>>(() => {
    if (!layoutKey) return {};

    const { chips, visitors, meta, button } = readFooterLayout(layoutKey);

    return { chips, visitors, meta, button };
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
  const info = (visitors ? (widths.visitors ?? 0) + GAP : 0) + (widths.meta ?? 0);
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
          {besideChips && !isOwn ? commentsButton : null}
          <View
            testID="bubble-footer-chips-content"
            onLayout={measure('chips')}
            style={styles.footerShrink}
          >
            {members}
          </View>
          {besideChips && isOwn ? (
            <>
              <View style={styles.footerSpacer} />
              {commentsButton}
            </>
          ) : null}
        </View>
      ) : null}

      <View testID="bubble-footer-info" style={styles.footer}>
        {!besideChips && !isOwn ? commentsButton : null}
        {visitors ? (
          <View onLayout={measure('visitors')} style={styles.footerShrink}>
            {visitors}
          </View>
        ) : null}
        <View style={styles.footerSpacer} />
        <View testID="bubble-footer-meta" onLayout={measure('meta')}>
          {meta}
        </View>
        {!besideChips && isOwn ? commentsButton : null}
      </View>
    </>
  );
}
