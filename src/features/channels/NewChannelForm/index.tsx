import { useCallback, useRef, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import {
  KeyboardAwareScrollView,
  useReanimatedKeyboardAnimation,
  useWindowDimensions as useKeyboardWindow,
} from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from './styles';

import type { CreatedChannel } from '@/api/channels';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Text } from '@/components/Text';
import { ChannelAvatarPicker } from '@/features/channels/ChannelAvatarPicker';
import {
  CHANNEL_DESCRIPTION_MAX_LENGTH,
  CHANNEL_TITLE_MAX_LENGTH,
} from '@/features/channels/limits';
import { UsernameField } from '@/features/channels/UsernameField';
import { describeCreateChannelError, useCreateChannel } from '@/features/channels/useCreateChannel';
import { useUsernameAvailability } from '@/features/channels/useUsernameAvailability';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type NewChannelFormProps = {
  onCreated: (created: CreatedChannel) => void;
};

/**
 * Форма нового канала: аватарка, название, описание, `@имя`. «Создать» стоит
 * над клавиатурой и активна, когда есть название и имя свободно. Сбой
 * создания форму не сбрасывает.
 */
export function NewChannelForm({ onCreated }: NewChannelFormProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const userId = useCurrentUserId();
  const keyboard = useReanimatedKeyboardAnimation();
  const { height: windowHeight } = useKeyboardWindow();
  const containerRef = useRef<View | null>(null);
  const [bottomOffset, setBottomOffset] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [username, setUsername] = useState('');
  const availability = useUsernameAvailability(username);
  const create = useCreateChannel(userId, onCreated);

  // Что лежит под формой до низа окна — таб-бар: клавиатура поднимает низ на
  // свою высоту за его вычетом, как на экране нового чата.
  const measureBottomOffset = useCallback(() => {
    containerRef.current?.measureInWindow((_x, y, _width, height) =>
      setBottomOffset(Math.max(0, windowHeight - (y + height))),
    );
  }, [windowHeight]);

  const keyboardInsetStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(Math.abs(keyboard.height.value) - bottomOffset, 0),
  }));

  const canCreate = title.trim() !== '' && availability.status === 'available';

  const submit = () => {
    if (!canCreate) return;

    create.mutate({ title, username, description, avatarUri });
  };

  return (
    <Animated.View
      ref={containerRef}
      onLayout={measureBottomOffset}
      style={[styles.flex, { backgroundColor: theme.background }, keyboardInsetStyle]}
    >
      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={styles.fields}
        keyboardShouldPersistTaps="handled"
        // Поле в фокусе встаёт над кнопкой «Создать», а не только над клавиатурой.
        bottomOffset={footerHeight + Spacing.three}
      >
        <ChannelAvatarPicker uri={avatarUri} onChange={setAvatarUri} disabled={create.isPending} />

        <Input
          testID="channel-title"
          label="Название"
          value={title}
          onChangeText={setTitle}
          maxLength={CHANNEL_TITLE_MAX_LENGTH}
          placeholder="Как называется канал"
        />

        <Input
          testID="channel-description"
          label="Описание"
          value={description}
          onChangeText={setDescription}
          maxLength={CHANNEL_DESCRIPTION_MAX_LENGTH}
          multiline
          style={styles.description}
          placeholder="Необязательно"
        />

        <UsernameField value={username} onChangeText={setUsername} availability={availability} />
      </KeyboardAwareScrollView>

      <View
        onLayout={(event: LayoutChangeEvent) => setFooterHeight(event.nativeEvent.layout.height)}
        style={[
          styles.footer,
          { borderTopColor: theme.border, paddingBottom: Math.max(insets.bottom, Spacing.two) },
        ]}
      >
        {create.error ? (
          <Text testID="create-channel-error" variant="small" color="danger">
            {describeCreateChannelError(create.error)}
          </Text>
        ) : null}

        <Button
          testID="create-channel-button"
          label="Создать"
          disabled={!canCreate}
          loading={create.isPending}
          onPress={submit}
        />

        <Text variant="caption" color="textSecondary">
          Канал публичный: посты сможет прочитать кто угодно.
        </Text>
      </View>
    </Animated.View>
  );
}
