import { Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import {
  SELECTION_ACTIONS,
  type SelectionAction,
  type SelectionActionContext,
  type SelectionActionId,
} from '@/features/chats/messageActions';
import { useTheme } from '@/hooks/use-theme';

/** Насколько можно ужать подпись, чтобы она осталась одним словом. */
const MIN_LABEL_SCALE = 0.8;

export type SelectionActionBarProps = {
  context: SelectionActionContext;
  onAction: (id: SelectionActionId) => void;
  /** Свой набор кнопок — у комментариев нет пересылки. По умолчанию — как у сообщений. */
  actions?: readonly SelectionAction[];
};

/**
 * Панель действий над выбранными сообщениями — на месте поля ввода, пока
 * идёт выбор. Кнопки берутся из `SELECTION_ACTIONS`: новое действие
 * добавляется туда одной записью. Кнопок четыре на ширину телефона, поэтому
 * они компактнее обычных: подпись в одну строку, не ломается посередине слова.
 */
export function SelectionActionBar({
  context,
  onAction,
  actions = SELECTION_ACTIONS,
}: SelectionActionBarProps) {
  const theme = useTheme();

  return (
    <View
      testID="selection-action-bar"
      style={[styles.bar, { borderTopColor: theme.border, backgroundColor: theme.background }]}
    >
      {actions.map((action) => {
        const enabled = action.isEnabled(context);

        return (
          <Pressable
            key={action.id}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityState={{ disabled: !enabled }}
            disabled={!enabled}
            onPress={() => onAction(action.id)}
            style={[
              styles.action,
              { backgroundColor: action.destructive ? theme.danger : theme.backgroundElement },
              !enabled && styles.disabled,
            ]}
          >
            <Text
              variant="smallBold"
              color={action.destructive ? 'primaryText' : 'text'}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={MIN_LABEL_SCALE}
            >
              {action.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
