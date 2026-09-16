import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { styles } from './styles';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

export type MessageComposerProps = {
  onSend: (text: string) => void;
  onTyping: () => void;
  /**
   * Members write, everyone else reads. The server decides — hiding the field
   * is only the polite half of that rule.
   */
  canSend: boolean;
};

export function MessageComposer({ onSend, onTyping, canSend }: MessageComposerProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState('');

  if (!canSend) {
    return (
      <View style={[styles.notice, { borderTopColor: theme.border }]}>
        <Text variant="small" color="textSecondary">
          Читать этот чат может кто угодно, писать — только участники.
        </Text>
      </View>
    );
  }

  const submit = () => {
    if (!draft.trim()) return;

    onSend(draft);
    setDraft('');
  };

  return (
    <View style={[styles.container, { borderTopColor: theme.border }]}>
      <TextInput
        accessibilityLabel="Сообщение"
        placeholder="Сообщение"
        placeholderTextColor={theme.textSecondary}
        value={draft}
        multiline
        onChangeText={(value) => {
          setDraft(value);
          onTyping();
        }}
        style={[styles.field, { color: theme.text, borderColor: theme.border }]}
      />
      <Button label="Отправить" size="sm" disabled={!draft.trim()} onPress={submit} />
    </View>
  );
}
