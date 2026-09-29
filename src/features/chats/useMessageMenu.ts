import { impactAsync, ImpactFeedbackStyle } from 'expo-haptics';
import { useCallback, useState } from 'react';
import { Keyboard } from 'react-native';

import type { AnchorRect } from '@/features/chats/MessageContextMenu';
import { setLiftedMessage } from '@/features/chats/MessageRow/liftedStore';
import type { ChatMessage } from '@/features/chats/messages/types';

export type MenuTarget = { message: ChatMessage; anchor: AnchorRect };

/** Контекстное меню сообщения: над каким оно открыто и где. */
export function useMessageMenu() {
  const [target, setTarget] = useState<MenuTarget | null>(null);

  const open = useCallback((message: ChatMessage, anchor: AnchorRect) => {
    impactAsync(ImpactFeedbackStyle.Medium).catch(() => undefined);
    Keyboard.dismiss();
    setLiftedMessage(message.id);
    setTarget({ message, anchor });
  }, []);

  const close = useCallback(() => {
    setLiftedMessage(null);
    setTarget(null);
  }, []);

  return { target, open, close };
}
