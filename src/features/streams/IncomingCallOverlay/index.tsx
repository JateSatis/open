import { useQueryClient } from '@tanstack/react-query';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useCallback } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from './styles';
import { useRinger } from './useRinger';
import { useRingingRecheck } from './useRingingRecheck';

import type { ChatSummary } from '@/api/chats';
import type { LiveStream } from '@/api/streams';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { chatsQueryKey } from '@/features/chats/useChats';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { incomingTitle } from '@/features/streams/callText';
import { declineRinging, takeRinging, useIncomingCall } from '@/features/streams/incomingCall';
import { useJoinCall } from '@/features/streams/useJoinCall';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

type RoundButtonProps = {
  label: string;
  icon: SymbolViewProps['name'];
  color: string;
  onPress: () => void;
};

function RoundButton({ label, icon, color, onPress }: RoundButtonProps) {
  const theme = useTheme();

  return (
    <View style={styles.action}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => [
          styles.round,
          { backgroundColor: color, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <SymbolView name={icon} size={Sizes.callControlIcon} tintColor={theme.textOnMedia} />
      </Pressable>
      <Text variant="small" color="textOnMedia">
        {label}
      </Text>
    </View>
  );
}

/**
 * Входящий звонок поверх любого экрана — окном, а не слоем в дереве: таб-бар
 * и шапки нативные, слой их не перекроет. Звонок публичный, и это сказано
 * прямо на экране — до того, как человек нажмёт «Присоединиться».
 */
export function IncomingCallOverlay() {
  const ringing = useIncomingCall((state) => state.ringing);
  const currentUserId = useCurrentUserId();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { join } = useJoinCall();

  useRinger(ringing !== null);

  // Звонок, найденный запросом, а не событием, называем по кешу списка чатов.
  const describe = useCallback(
    (stream: LiveStream) => {
      const chat = queryClient
        .getQueryData<ChatSummary[]>(chatsQueryKey)
        ?.find((candidate) => candidate.id === stream.chatId);
      const host = chat?.participants.find((person) => person.id === stream.hostId);

      return {
        chatTitle: chat?.title ?? null,
        chatKind: chat?.kind ?? 'group',
        hostName: host?.displayName ?? 'Звонок',
      };
    },
    [queryClient],
  );

  useRingingRecheck(currentUserId, describe);

  const accept = () => {
    const call = takeRinging();

    if (!call) return;

    void join(call.streamId, {
      chatId: call.chatId,
      chatTitle: incomingTitle(call),
      isDirect: call.chatKind === 'direct',
      isMember: true,
    });
  };

  if (!ringing) return null;

  const title = incomingTitle(ringing);
  const who = ringing.chatKind === 'group' ? `${ringing.hostName} звонит` : 'Звонит вам';

  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={declineRinging}
    >
      <View
        testID="incoming-call"
        style={[
          styles.screen,
          {
            backgroundColor: theme.callBackground,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          },
        ]}
      >
        <View style={styles.header}>
          <Avatar name={title} size={Sizes.incomingAvatar} />
          <Text variant="title" color="textOnMedia" numberOfLines={2} style={styles.centered}>
            {title}
          </Text>
          <Text variant="body" style={[styles.centered, { color: theme.textOnCallSecondary }]}>
            {who}
          </Text>

          <View style={[styles.onAir, { borderColor: theme.onAir }]}>
            <View style={[styles.dot, { backgroundColor: theme.onAir }]} />
            <Text variant="smallBold" style={{ color: theme.onAir }}>
              В эфире: вас услышат слушатели
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <RoundButton
            label="Отклонить"
            icon={{ ios: 'phone.down.fill', android: 'call_end', web: 'call_end' }}
            color={theme.danger}
            onPress={declineRinging}
          />
          <RoundButton
            label="Присоединиться"
            icon={{ ios: 'phone.fill', android: 'call', web: 'call' }}
            color={theme.success}
            onPress={accept}
          />
        </View>
      </View>
    </Modal>
  );
}
