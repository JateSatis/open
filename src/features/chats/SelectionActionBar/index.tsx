import { View } from 'react-native';

import { styles } from './styles';

import { Button } from '@/components/Button';
import {
  SELECTION_ACTIONS,
  type SelectionActionContext,
  type SelectionActionId,
} from '@/features/chats/messageActions';
import { useTheme } from '@/hooks/use-theme';

export type SelectionActionBarProps = {
  context: SelectionActionContext;
  onAction: (id: SelectionActionId) => void;
};

/**
 * Панель действий над выбранными сообщениями — на месте поля ввода, пока
 * идёт выбор. Кнопки берутся из `SELECTION_ACTIONS`: новое действие
 * добавляется туда одной записью.
 */
export function SelectionActionBar({ context, onAction }: SelectionActionBarProps) {
  const theme = useTheme();

  return (
    <View
      testID="selection-action-bar"
      style={[styles.bar, { borderTopColor: theme.border, backgroundColor: theme.background }]}
    >
      {SELECTION_ACTIONS.map((action) => (
        <Button
          key={action.id}
          label={action.label}
          variant={action.destructive ? 'danger' : 'secondary'}
          disabled={!action.isEnabled(context)}
          onPress={() => onAction(action.id)}
          style={styles.action}
        />
      ))}
    </View>
  );
}
