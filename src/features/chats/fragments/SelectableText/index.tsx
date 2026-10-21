import { useEffect, useMemo, useRef } from 'react';
import { Text as RNText, StyleSheet, View } from 'react-native';

import { ClusterMode } from './ClusterMode';
import { styles } from './styles';

import type { TextGeometry } from '../../../../../modules/text-geometry';

import {
  useFragmentModeActive,
  useRowQuoteHighlight,
  useRowSelection,
  type TextSelection,
} from '@/features/chats/fragments/fragmentStore';
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
  amMember: boolean;
  /** Показываемых кластеров у сообщения: есть — в режиме они подсвечиваются. */
  clustersCount?: number;
};

/**
 * Текст облачка, в котором можно выделить кусок. Выделение — своё, не
 * системное: заливка по прямоугольникам строк из настоящего layout текста
 * (`textGeometry`) лежит под текстом, ручки — поверх. Жесты ручек ведёт строка
 * (`useSelectionHandles`), здесь только то, что видно.
 */
export function SelectableText({
  text,
  isOwn,
  rowKey,
  messageId,
  chatId,
  amMember,
  clustersCount = 0,
}: SelectableTextProps) {
  const theme = useTheme();
  const ref = useRef<RNText>(null);
  const selection = useRowSelection(rowKey);
  const quote = useRowQuoteHighlight(rowKey);
  // Текст сменился правкой — прежняя геометрия к нему не подходит.
  const shownQuote = quote && quote.text === text ? quote : null;
  const fragmentMode = useFragmentModeActive(rowKey);

  useEffect(() => {
    if (!rowKey) return;

    return registerSelectableText(rowKey, { ref, text, messageId, chatId, amMember });
  }, [amMember, chatId, messageId, rowKey, text]);

  const content = (
    <>
      {shownQuote ? (
        <RangeFill
          testID="quote-highlight"
          geometry={shownQuote.geometry}
          start={shownQuote.start}
          end={shownQuote.end}
          color={isOwn ? theme.fragmentHighlightOnPrimary : theme.fragmentHighlight}
        />
      ) : null}
      {selection ? <SelectionLayer selection={selection} isOwn={isOwn} part="fill" /> : null}
      {/* Свой `Text` ref не отдаёт — а мерить нужно сам нативный текст. */}
      <RNText
        ref={ref}
        style={[Typography.body, { color: isOwn ? theme.primaryText : theme.text }]}
      >
        {text}
      </RNText>
      {/* Пока выделение тянут словами, ручек нет: они появятся, когда палец отпустят. */}
      {selection && selection.dragging !== 'words' ? (
        <SelectionLayer selection={selection} isOwn={isOwn} part="handles" />
      ) : null}
    </>
  );

  // В режиме — с подсветкой кластеров; облачка списка без неё лишнего не держат.
  if (fragmentMode && rowKey) {
    return (
      <ClusterMode
        textRef={ref}
        text={text}
        isOwn={isOwn}
        rowKey={rowKey}
        messageId={messageId}
        chatId={chatId}
        amMember={amMember}
        clustersCount={clustersCount}
      >
        {content}
      </ClusterMode>
    );
  }

  return <View>{content}</View>;
}

/**
 * Заливка диапазона под текстом — по строке на строку, без хвостов строк и
 * межстрочья: у выделения и у куска, к которому пришли по цитате.
 */
function RangeFill({
  testID,
  geometry,
  start,
  end,
  color,
}: {
  testID: string;
  geometry: TextGeometry;
  start: number;
  end: number;
  color: string;
}) {
  const rects = useMemo(() => rangeRects(geometry, start, end), [end, geometry, start]);

  return (
    <View pointerEvents="none" testID={testID} style={StyleSheet.absoluteFill}>
      {rects.map((rect) => (
        <View
          key={`${rect.x}:${rect.y}`}
          style={[
            styles.rect,
            {
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              backgroundColor: color,
            },
          ]}
        />
      ))}
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

  if (part === 'fill') {
    return (
      <RangeFill
        testID="text-selection"
        geometry={geometry}
        start={start}
        end={end}
        color={isOwn ? theme.textSelectionOnPrimary : theme.textSelection}
      />
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
