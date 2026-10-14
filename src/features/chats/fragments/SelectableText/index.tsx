import { useEffect, useMemo, useRef } from 'react';
import { Text as RNText, StyleSheet, View } from 'react-native';

import { styles } from './styles';

import { useRowSelection, type TextSelection } from '@/features/chats/fragments/fragmentStore';
import { registerSelectableText } from '@/features/chats/fragments/selectableTexts';
import { caretAt, rangeRects } from '@/features/chats/fragments/textGeometry';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Typography } from '@/theme';

export type SelectableTextProps = {
  text: string;
  isOwn: boolean;
  /**
   * Ключ строки, если в этом облачке можно выделять. Нет (копия в меню, над
   * шитом, облачко комментария) — обычный текст.
   */
  rowKey?: string;
  /** Сообщение, чей это текст: у облачка островка — оригинал. */
  messageId: string;
  chatId: string;
};

/**
 * Текст облачка, в котором можно выделить кусок. Выделение — своё, не
 * системное: заливка по прямоугольникам строк из настоящего layout текста
 * (`textGeometry`) лежит под текстом, ручки — поверх. Жесты ручек ведёт строка
 * (`useSelectionHandles`), здесь только то, что видно.
 */
export function SelectableText({ text, isOwn, rowKey, messageId, chatId }: SelectableTextProps) {
  const theme = useTheme();
  const ref = useRef<RNText>(null);
  const selection = useRowSelection(rowKey);

  useEffect(() => {
    if (!rowKey) return;

    return registerSelectableText(rowKey, { ref, text, messageId, chatId });
  }, [chatId, messageId, rowKey, text]);

  return (
    <View>
      {selection ? <SelectionLayer selection={selection} isOwn={isOwn} part="fill" /> : null}
      {/* Свой `Text` ref не отдаёт — а мерить нужно сам нативный текст. */}
      <RNText ref={ref} style={[Typography.body, { color: isOwn ? theme.primaryText : theme.text }]}>
        {text}
      </RNText>
      {selection ? <SelectionLayer selection={selection} isOwn={isOwn} part="handles" /> : null}
    </View>
  );
}

function SelectionLayer({
  selection,
  isOwn,
  part,
}: {
  selection: TextSelection;
  isOwn: boolean;
  part: 'fill' | 'handles';
}) {
  const theme = useTheme();
  const { geometry, start, end } = selection;
  const rects = useMemo(() => rangeRects(geometry, start, end), [end, geometry, start]);

  if (part === 'fill') {
    const fill = isOwn ? theme.textSelectionOnPrimary : theme.textSelection;

    return (
      <View pointerEvents="none" testID="text-selection" style={StyleSheet.absoluteFill}>
        {rects.map((rect) => (
          <View
            key={`${rect.x}:${rect.y}`}
            style={[
              styles.rect,
              { left: rect.x, top: rect.y, width: rect.width, height: rect.height, backgroundColor: fill },
            ]}
          />
        ))}
      </View>
    );
  }

  const color = isOwn ? theme.selectionHandleOnPrimary : theme.selectionHandle;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {(['start', 'end'] as const).map((edge) => {
        const caret = caretAt(geometry, edge === 'start' ? start : end, edge);

        return (
          <View key={edge} testID={`selection-handle-${edge}`}>
            <View
              style={[
                styles.stem,
                {
                  left: caret.x - Sizes.selectionHandleStem / 2,
                  top: caret.top,
                  height: caret.bottom - caret.top,
                  backgroundColor: color,
                },
              ]}
            />
            <View
              style={[
                styles.drop,
                {
                  left: caret.x - Sizes.selectionHandle / 2,
                  top: caret.bottom - Sizes.selectionHandleStem,
                  backgroundColor: color,
                },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}
