import { Text, type TextProps } from '@/components/Text';
import type { TextRange } from '@/features/search/searchText';

export type HighlightedTextProps = TextProps & {
  children: string;
  /** Что подсветить — отрезки `children`, по возрастанию, без пересечений. */
  ranges: TextRange[];
};

/** Текст с подсвеченными совпадениями запроса — цветом ссылки, как в Telegram. */
export function HighlightedText({ children, ranges, ...rest }: HighlightedTextProps) {
  if (ranges.length === 0) return <Text {...rest}>{children}</Text>;

  const parts: { text: string; match: boolean }[] = [];
  let cursor = 0;

  for (const { start, end } of ranges) {
    if (start > cursor) parts.push({ text: children.slice(cursor, start), match: false });
    parts.push({ text: children.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < children.length) parts.push({ text: children.slice(cursor), match: false });

  return (
    <Text {...rest}>
      {parts.map((part, index) =>
        part.match ? (
          <Text key={index} variant={rest.variant} color="primary" testID="search-highlight">
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}
