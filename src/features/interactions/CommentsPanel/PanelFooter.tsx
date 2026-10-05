import type { ComponentProps } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CommentComposer } from './CommentComposer';
import { styles } from './styles';
import type { PanelActions } from './usePanelActions';

import { SelectionActionBar } from '@/features/chats/SelectionActionBar';
import { COMMENT_SELECTION_ACTIONS } from '@/features/interactions/comments/useCommentReplySelection';
import { useTheme } from '@/hooks/use-theme';

export type PanelFooterProps = {
  /** Сдвиг над клавиатурой и вместе с шитом — из `usePanelSheet`. */
  style: ComponentProps<typeof Animated.View>['style'];
  onHeight: (height: number) => void;
  actions: PanelActions;
  /** Сообщение удалено — новые комментарии не принимаются. */
  closed: boolean;
  /** Подпись пустого поля: в окне треда — куда уйдёт сообщение. */
  placeholder: string;
};

/**
 * Низ панели — у края экрана, над клавиатурой своего поля: поле ввода или,
 * в режиме выбора, панель действий над выбранным.
 */
export function PanelFooter({ style, onHeight, actions, closed, placeholder }: PanelFooterProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { selection } = actions;

  return (
    <Animated.View
      testID="comments-footer"
      style={[styles.footer, { backgroundColor: theme.background, paddingBottom: insets.bottom }, style]}
      onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
    >
      {selection.isActive ? (
        <SelectionActionBar
          context={actions.selectionContext}
          actions={COMMENT_SELECTION_ACTIONS}
          onAction={actions.runSelectionAction}
        />
      ) : null}
      {/* Поле прячется, а не размонтируется: черновик и рекордер остаются. */}
      <View style={selection.isActive ? styles.hidden : undefined}>
        <CommentComposer
          draft={actions.draft}
          edit={actions.edit}
          inputRef={actions.inputRef}
          closed={closed}
          placeholder={placeholder}
          onSend={actions.submit}
          onSendVoice={actions.sendVoice}
        />
      </View>
    </Animated.View>
  );
}
