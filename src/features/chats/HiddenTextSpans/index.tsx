import { Fragment } from 'react';
import { Text } from 'react-native';

import { hiddenSegments, isMaskedText, type HiddenRange } from '@/features/chats/hiddenText';
import { useTheme } from '@/hooks/use-theme';

export type HiddenTextSpansProps = {
  text: string;
  ranges: readonly HiddenRange[];
  /** Своё облачко — цвета на синем. */
  isOwn?: boolean;
};

/**
 * Содержимое текста со скрытыми кусками — внутри родительского `Text`.
 *
 * Зрителю сервер прислал «•» на месте скрытого: поверх — сплошная «замазка»
 * той же длины, как спойлер, но тап её не раскрывает — раскрывать нечего.
 * Участнику пришёл оригинал: скрытое читается, под ним тихая пометка, что
 * зрители его не видят.
 */
export function HiddenTextSpans({ text, ranges, isOwn = false }: HiddenTextSpansProps) {
  const theme = useTheme();

  if (ranges.length === 0) return text;

  const masked = isMaskedText(text, ranges);
  const spoiler = isOwn ? theme.hiddenTextSpoilerOnPrimary : theme.hiddenTextSpoiler;
  const mark = isOwn ? theme.hiddenTextMarkOnPrimary : theme.hiddenTextMark;

  return hiddenSegments(text, ranges).map((segment, index) =>
    segment.hidden ? (
      <Text
        key={index}
        testID={masked ? 'hidden-text-spoiler' : 'hidden-text-mark'}
        accessibilityLabel={masked ? 'Скрыто автором от зрителей' : undefined}
        style={masked ? { color: spoiler, backgroundColor: spoiler } : { backgroundColor: mark }}
      >
        {segment.text}
      </Text>
    ) : (
      <Fragment key={index}>{segment.text}</Fragment>
    ),
  );
}
