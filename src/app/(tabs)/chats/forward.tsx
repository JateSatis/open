import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import {
  cancelForwardPick,
  completeForwardPick,
  readForwardPick,
} from '@/features/chats/composerDraftStore';
import { ForwardSheet } from '@/features/chats/ForwardSheet';

/**
 * «Переслать» → лист «Кому переслать»: чаты и «Сохранённые» мультивыбором,
 * отправка — отсюда же. После отправки лист закрывается, человек остаётся в
 * переписке, откуда пересылал.
 */
export default function ForwardScreen() {
  const router = useRouter();
  // Что пересылать — снимком на открытие: после отправки стор очищается.
  const [pick] = useState(readForwardPick);

  // Ушёл без отправки — пересылать нечего.
  useEffect(() => () => cancelForwardPick(), []);

  useEffect(() => {
    if (!pick) router.back();
  }, [pick, router]);

  if (!pick) return null;

  return (
    <ForwardSheet
      pick={pick}
      onSent={() => {
        completeForwardPick();
        router.back();
      }}
    />
  );
}
