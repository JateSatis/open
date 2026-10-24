import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { styles } from './styles';

import { ComposerButton } from '@/features/chats/MessageComposer/ComposerButton';
import { useTheme } from '@/hooks/use-theme';

export type ForwardComposerProps = {
  /** Есть хоть один адресат: без него отправлять некуда. */
  canSend: boolean;
  /** Подпись — необязательна; уходит в каждый выбранный чат. */
  onSend: (text: string) => void;
};

/** Поле подписи с кнопкой отправки — внизу листа «Кому переслать», как в чате. */
export function ForwardComposer({ canSend, onSend }: ForwardComposerProps) {
  const theme = useTheme();
  const [text, setText] = useState('');

  return (
    <View style={[styles.container, { borderTopColor: theme.border, backgroundColor: theme.background }]}>
      <View style={[styles.fieldBox, { borderColor: theme.border }]}>
        <TextInput
          testID="forward-caption"
          accessibilityLabel="Подпись"
          placeholder="Подпись — необязательно"
          placeholderTextColor={theme.textSecondary}
          value={text}
          onChangeText={setText}
          multiline
          style={[styles.field, { color: theme.text }]}
        />
      </View>

      <ComposerButton
        testID="forward-send"
        icon={{ ios: 'arrow.up', android: 'send', web: 'send' }}
        accessibilityLabel="Отправить"
        variant="primary"
        disabled={!canSend}
        onPress={() => onSend(text)}
      />
    </View>
  );
}
