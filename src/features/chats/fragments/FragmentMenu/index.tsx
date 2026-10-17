import { useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { fragmentMenuLayout } from './fragmentMenuLayout';
import { styles } from './styles';

import type { Fragment } from '@/api/fragments';
import type { MessageReactions } from '@/api/reactionCounts';
import { sendFragmentReaction } from '@/features/chats/fragments/fragmentReactions';
import {
  clearTextSelection,
  useTextSelection,
  type TextSelection,
} from '@/features/chats/fragments/fragmentStore';
import { boundsOf, rangeRects } from '@/features/chats/fragments/textGeometry';
import { toServerRange } from '@/features/chats/fragments/textOffsets';
import { myFragmentOn, useMessageFragments } from '@/features/chats/fragments/useMessageFragments';
import type { AnchorRect } from '@/features/chats/MessageContextMenu';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { pickerGeometry, ReactionPicker } from '@/features/interactions/ReactionPicker';
import { audienceOf, menuReactionSet } from '@/features/interactions/reactionState';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing } from '@/theme';

/** Блок реакций — пять в сжатом виде и стрелка раскрытия. */
const PICKER_COLUMNS = 6;

export type FragmentMenuProps = {
  /** Окно списка в координатах окна: меню не залезает на шапку и поле ввода. */
  measureViewport: () => Promise<AnchorRect | null>;
  /** Кнопка комментария: панель кластера или области этого куска. */
  onComment: (selection: TextSelection) => unknown;
};

function reactionsOf(fragment: Fragment | null, amMember: boolean): MessageReactions {
  return {
    members: fragment?.memberReactions ?? {},
    visitors: fragment?.visitorReactions ?? {},
    mine: fragment?.mine ? { emoji: fragment.mine, audience: audienceOf(amMember) } : null,
  };
}

/**
 * Меню выделенного куска текста: блок реакций (как в меню сообщения — пять и
 * стрелка) и круглая кнопка комментария. Стоит под выделением, не закрывая
 * его, а снизу места нет — над ним. Пока тянут ручку, меню нет; отпустили —
 * встаёт под новое выделение.
 *
 * Не окно, а слой экрана: под ним остаётся живая переписка с ручками.
 */
export function FragmentMenu({ measureViewport, onComment }: FragmentMenuProps) {
  const selection = useTextSelection();

  if (!selection || selection.dragging) return null;

  return (
    <MenuBody
      key={`${selection.rowKey}:${selection.start}-${selection.end}`}
      selection={selection}
      measureViewport={measureViewport}
      onComment={onComment}
    />
  );
}

function MenuBody({
  selection,
  measureViewport,
  onComment,
}: FragmentMenuProps & { selection: TextSelection }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const me = useCurrentUserId();
  const { width: screenWidth } = useWindowDimensions();
  const hostRef = useRef<View>(null);
  const [frame, setFrame] = useState<{ host: AnchorRect; viewport: AnchorRect } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const { messageId, text, start, end, amMember } = selection;
  const range = useMemo(() => toServerRange(text, start, end), [end, start, text]);
  const { data: fragments } = useMessageFragments(messageId);
  const mine = myFragmentOn(fragments, me, range);
  const reactions = reactionsOf(mine, amMember);
  const set = menuReactionSet(reactions, audienceOf(amMember));
  const geometry = useMemo(
    () => pickerGeometry(PICKER_COLUMNS * Sizes.reactionCell + Spacing.one * 2, set),
    // Набор — на момент открытия меню, как у меню сообщения.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      new Promise<AnchorRect | null>((resolve) =>
        hostRef.current
          ? hostRef.current.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }))
          : resolve(null),
      ),
      measureViewport(),
    ]).then(([host, viewport]) => {
      if (!cancelled && host && viewport) setFrame({ host, viewport });
    });

    return () => {
      cancelled = true;
    };
  }, [measureViewport]);

  const bounds = useMemo(
    () => boundsOf(rangeRects(selection.geometry, start, end)),
    [end, selection.geometry, start],
  );

  const select = (emoji: string) => {
    if (!me) return;

    sendFragmentReaction(queryClient, {
      messageId,
      range,
      emoji: mine?.mine === emoji ? null : emoji,
      audience: audienceOf(amMember),
      me,
    });
    clearTextSelection();
  };

  const width = geometry.width + Spacing.two + Sizes.fragmentCommentButton;
  const place =
    frame && bounds
      ? fragmentMenuLayout({
          selection: {
            x: selection.textInWindow.x + bounds.x,
            y: selection.textInWindow.y + bounds.y,
            width: bounds.width,
            height: bounds.height,
          },
          handleSpace: Sizes.selectionHandle,
          viewport: { top: frame.viewport.y, bottom: frame.viewport.y + frame.viewport.height },
          screenWidth,
          width,
          height: geometry.collapsedHeight,
          gap: Spacing.two,
        })
      : null;

  // Тап мимо выделения его снимает. Подложка — вокруг текста с ручками: сам
  // текст остаётся живым (ручки тянутся, тап по облачку снимает выделение
  // через строку), всё остальное — переписка, шапка — ловит тап здесь.
  const hole = frame
    ? {
        left: selection.textInWindow.x - frame.host.x - Sizes.selectionHandleHit,
        top: selection.textInWindow.y - frame.host.y - Sizes.selectionHandleHit,
        right:
          selection.textInWindow.x - frame.host.x + selection.geometry.width + Sizes.selectionHandleHit,
        bottom:
          selection.textInWindow.y -
          frame.host.y +
          selection.geometry.height +
          Sizes.selectionHandle +
          Sizes.selectionHandleHit,
      }
    : null;

  return (
    <View ref={hostRef} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {hole && frame
        ? [
            { left: 0, right: 0, top: 0, height: Math.max(0, hole.top) },
            { left: 0, right: 0, top: hole.bottom, bottom: 0 },
            { left: 0, width: Math.max(0, hole.left), top: hole.top, height: hole.bottom - hole.top },
            { left: hole.right, right: 0, top: hole.top, height: hole.bottom - hole.top },
          ].map((area, index) => (
            <Pressable
              // Четыре куска одной подложки — порядок не меняется.
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              testID={index === 0 ? 'fragment-dismiss' : undefined}
              accessibilityLabel="Снять выделение"
              onPressIn={clearTextSelection}
              style={[styles.scrim, area]}
            />
          ))
        : null}
      {place && frame ? (
        <Animated.View
          testID="fragment-menu"
          entering={FadeIn.duration(120)}
          pointerEvents="box-none"
          style={[
            styles.menu,
            { left: place.left - frame.host.x, top: place.top - frame.host.y, width },
          ]}
        >
          <ReactionPicker
            geometry={geometry}
            selected={mine?.mine ?? null}
            expanded={expanded}
            maxHeight={frame.viewport.y + frame.viewport.height - place.top}
            onToggleExpanded={() => setExpanded((open) => !open)}
            onSelect={select}
            style={[styles.picker, { backgroundColor: theme.backgroundElement }]}
          />
          <Pressable
            testID="fragment-comment"
            accessibilityRole="button"
            accessibilityLabel="Добавить комментарий"
            onPress={() => onComment(selection)}
            style={({ pressed }) => [
              styles.comment,
              { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
            ]}
          >
            <SymbolView
              name={{ ios: 'bubble.left', android: 'chat_bubble_outline', web: 'chat_bubble_outline' }}
              size={Spacing.four}
              tintColor={theme.text}
            />
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}
