import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  useReanimatedKeyboardAnimation,
  useWindowDimensions as useKeyboardWindow,
} from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useForwardSelection } from './useForwardSelection';

import type { ForwardPick } from '@/features/chats/composerDraftStore';
import { ForwardChatPicker } from '@/features/chats/ForwardChatPicker';
import { ForwardComposer } from '@/features/chats/ForwardComposer';
import { sendForwardPick } from '@/features/chats/sendForwardPick';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { SavedTargetRow } from '@/features/saved/SavedTargetRow';
import { useTheme } from '@/hooks/use-theme';

export type ForwardSheetProps = {
  pick: ForwardPick;
  /** Отправлено: лист закрывается, человек — там, откуда пересылал. */
  onSent: () => void;
};

/**
 * Лист «Кому переслать»: «Сохранённые» и чаты — мультивыбором, внизу — поле
 * подписи с отправкой. Клавиатуру поле обходит само, как экран нового чата:
 * KeyboardAvoidingView на Android с edge-to-edge его не поднимает.
 */
export function ForwardSheet({ pick, onSent }: ForwardSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const currentUserId = useCurrentUserId();
  const selection = useForwardSelection();
  const keyboard = useReanimatedKeyboardAnimation();
  const { height: windowHeight } = useKeyboardWindow();
  const containerRef = useRef<View | null>(null);
  const [bottomOffset, setBottomOffset] = useState(0);

  // Что лежит под экраном до низа окна: клавиатура это перекрывает.
  const measureBottomOffset = useCallback(() => {
    containerRef.current?.measureInWindow((_x, y, _width, height) =>
      setBottomOffset(Math.max(0, windowHeight - (y + height))),
    );
  }, [windowHeight]);

  const keyboardInsetStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(Math.abs(keyboard.height.value) - bottomOffset, insets.bottom),
  }));

  const { targets } = selection;
  // Лист уезжает не сразу: второй тап по «Отправить» не должен переслать дважды.
  const sent = useRef(false);
  const send = useCallback(
    (text: string) => {
      if (sent.current) return;

      sent.current = true;
      sendForwardPick(queryClient, currentUserId, pick, targets, text);
      onSent();
    },
    [currentUserId, onSent, pick, queryClient, targets],
  );

  return (
    <Animated.View
      ref={containerRef}
      onLayout={measureBottomOffset}
      style={[styles.screen, { backgroundColor: theme.background }, keyboardInsetStyle]}
    >
      <ForwardChatPicker
        selectedIds={selection.chatIds}
        onToggle={selection.toggleChat}
        header={
          <SavedTargetRow
            selected={selection.saved}
            onToggle={selection.toggleSaved}
            open={selection.settingsOpen}
            onToggleOpen={selection.toggleSettings}
            tags={selection.tags}
            selectedTagIds={selection.tagIds}
            onToggleTag={selection.toggleTag}
            onCreateTag={selection.createTag}
            watchLater={selection.watchLater}
            onToggleWatchLater={selection.toggleWatchLater}
          />
        }
      />

      <ForwardComposer canSend={selection.hasTargets} onSend={send} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
});
