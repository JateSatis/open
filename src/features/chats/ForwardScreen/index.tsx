import { useRouter } from '@/navigation';
import { useEffect, useRef, useState } from 'react';

import {
  cancelForwardPick,
  completeForwardPick,
  readForwardPick,
} from '@/features/chats/composerDraftStore';
import { ForwardSheet } from '@/features/chats/ForwardSheet';

export function ForwardScreen() {
  const { back: onClose } = useRouter();
  // Лист сохраняет выбор до закрытия, даже когда отправка уже очистила стор.
  const [pick] = useState(readForwardPick);
  const sent = useRef(false);

  useEffect(() => {
    return () => {
      if (!sent.current) cancelForwardPick();
    };
  }, []);

  useEffect(() => {
    if (!pick) onClose();
  }, [onClose, pick]);

  if (!pick) return null;

  return (
    <ForwardSheet
      pick={pick}
      onSent={() => {
        sent.current = true;
        completeForwardPick();
        onClose();
      }}
    />
  );
}
