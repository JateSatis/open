import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouteParams, useRouter } from '@/navigation';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { styles } from './styles';

import { createChat, DuplicateChatError, type CreateChatResult } from '@/api/invites';
import { PlainPageBar } from '@/components/PageBar';
import { SlidePage, useSlideBack } from '@/components/SlidePage';
import { Text } from '@/components/Text';
import { claimKeyboardForChat } from '@/features/chats/composerKeyboard';
import {
  DIALOGUE_REQUEST_COUNTER_FROM,
  DIALOGUE_REQUEST_MAX_LENGTH,
} from '@/features/chats/limits';
import { MessageComposer } from '@/features/chats/MessageComposer';
import { useChatKeyboardInset } from '@/features/chats/useChatKeyboardInset';
import { chatsQueryKey } from '@/features/chats/useChats';
import { describeCreateChatError } from '@/features/chats/useCreateChat';
import { invitesQueryKey } from '@/features/chats/useInvites';
import { useProfile } from '@/features/profile/queries';
import { displayNameOf } from '@/features/profile/username';
import { useTheme } from '@/hooks/use-theme';

const noop = () => undefined;

/**
 * Первое сообщение человеку, который мне не друг, — заявка на диалог. Чата
 * ещё нет: он появится вместе с текстом. Только текст, одно сообщение —
 * так решает база; здесь лишь нет кнопок вложений, голосового и кружка.
 */
export function DialogueRequestScreen() {
  const { userId } = useRouteParams<'Request'>();
  const router = useRouter();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { data: profile } = useProfile(userId);
  const name = profile ? displayNameOf(profile) : 'Новый диалог';
  const [text, setText] = useState('');
  const toChats = useCallback(() => router.replace({ name: 'Tabs', params: { screen: 'chats' } }), [router]);
  const slide = useSlideBack(toChats);
  const { containerRef, onLayout, style: keyboardStyle } = useChatKeyboardInset();
  const left = DIALOGUE_REQUEST_MAX_LENGTH - text.length;

  const openChat = useCallback(
    (chatId: string) => {
      void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
      router.replace({ name: 'Chat', params: { chatId } });
    },
    [queryClient, router],
  );

  const send = useMutation({
    // Без связи React Query поставил бы отправку на паузу молча.
    networkMode: 'always',
    mutationFn: (requestText: string) => createChat({ inviteeIds: [userId], requestText }),
    onSuccess: (result: CreateChatResult) => {
      if (result.outcome === 'incoming_invite') {
        void queryClient.invalidateQueries({ queryKey: invitesQueryKey });
      }

      // Пока писал, подружились или он сам позвал меня — открывается чат.
      if (result.outcome !== 'request_needed') openChat(result.chatId);
    },
    onError: (cause: Error) => {
      if (cause instanceof DuplicateChatError) openChat(cause.chatId);
    },
  });

  const problem =
    send.error && !(send.error instanceof DuplicateChatError)
      ? describeCreateChatError(send.error)
      : null;

  return (
    <SlidePage slide={slide}>
      <PlainPageBar title={name} onBack={slide.close} />
      <Animated.View
        ref={containerRef}
        onLayout={onLayout}
        style={[styles.flex, { backgroundColor: theme.background }, keyboardStyle]}
      >
        <View style={styles.hint}>
          <Text variant="bodyBold" style={styles.center}>
            Заявка на диалог
          </Text>
          <Text color="textSecondary" style={styles.center}>
            {`${name} вам не друг, поэтому первое сообщение уйдёт заявкой: только текст, одно сообщение. Писать дальше можно будет, когда заявку примут. До этого её видите только вы двое — потом диалог станет публичным, как любой в Open.`}
          </Text>
        </View>

        {problem ? (
          <Text variant="small" color="danger" style={styles.banner}>
            {problem}
          </Text>
        ) : null}

        {left <= DIALOGUE_REQUEST_COUNTER_FROM ? (
          <Text variant="caption" color="textSecondary" style={styles.banner}>
            {`Осталось символов: ${left}`}
          </Text>
        ) : null}

        <MessageComposer
          text={text}
          onChangeText={(value) => setText(value.slice(0, DIALOGUE_REQUEST_MAX_LENGTH))}
          canSend
          placeholder="Текст заявки"
          // Заявку видят двое, но после принятия она — первое сообщение публичного диалога.
          audience="Когда заявку примут, это сообщение увидят все, кто откроет чат."
          hintAudience="увидят все, когда заявку примут"
          // Второе нажатие, пока первое в пути, создало бы ту же заявку дважды.
          onSend={() => {
            if (!send.isPending) send.mutate(text);
          }}
          onTyping={noop}
          onFieldActivate={claimKeyboardForChat}
        />
      </Animated.View>
    </SlidePage>
  );
}
