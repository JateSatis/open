import { useMemo } from 'react';
import { FlatList, StyleSheet, useWindowDimensions } from 'react-native';

import type { MessageAttachment } from '@/api/chats';
import { mosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { MessageBubble } from '@/features/chats/MessageBubble';
import type { ChatMessage } from '@/features/chats/useChatMessages';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

/**
 * Стенд раскладки альбомов: фиктивные сообщения с медиа всех размеров и
 * пропорций, свои и чужие, с подписью и без, в разных состояниях доставки.
 * Картинок нет — плитки рисуются заглушками, видна только раскладка.
 * Dev-стенд, не продакшн: открывается диплинком openger://mosaic-lab
 */

const SHAPES = {
  P: [1080, 1920],
  L: [1920, 1080],
  S: [1000, 1000],
  PAN: [4000, 900],
  SCR: [1080, 4800],
  V: [720, 1280],
  N: [null, null],
} as const;

type Shape = keyof typeof SHAPES;

const ALBUMS: { shapes: Shape[]; text?: string; own?: boolean; status?: ChatMessage['status'] }[] =
  [
    { shapes: ['P'], own: true },
    { shapes: ['PAN'] },
    { shapes: ['SCR'], own: true, text: 'Длинный скриншот с подписью' },
    { shapes: ['L', 'L'] },
    { shapes: ['P', 'V'], own: true, status: 'sending' },
    { shapes: ['P', 'L', 'L'], text: 'Три файла, первый узкий' },
    { shapes: ['L', 'P', 'P'], own: true },
    { shapes: ['S', 'S', 'S', 'S'] },
    { shapes: ['L', 'S', 'V', 'S'], own: true, status: 'failed' },
    { shapes: ['P', 'L', 'S', 'P', 'L'] },
    { shapes: ['P', 'P', 'P', 'P', 'P', 'P', 'P'], own: true },
    { shapes: ['P', 'L', 'S', 'P', 'L', 'S', 'P', 'L', 'S', 'P'], text: 'Десять файлов' },
    { shapes: ['PAN', 'SCR', 'PAN', 'SCR', 'P', 'L', 'PAN', 'SCR', 'S', 'N'], own: true },
  ];

function fakeMessages(): ChatMessage[] {
  return ALBUMS.map((album, index) => ({
    id: `lab-${index}`,
    localId: album.status && album.status !== 'sent' ? `lab-${index}` : undefined,
    chatId: 'lab',
    authorId: album.own ? 'me' : 'other',
    kind: 'media' as const,
    text: album.text ?? null,
    createdAt: new Date(2026, 8, 26, 12, index).toISOString(),
    status: album.status ?? 'sent',
    attachments: album.shapes.map((shape, i): MessageAttachment => ({
      id: `lab-${index}-${i}`,
      url: `lab://${index}/${i}`,
      posterUrl: null,
      mimeType: shape === 'V' ? 'video/mp4' : 'image/jpeg',
      width: SHAPES[shape][0],
      height: SHAPES[shape][1],
      durationMs: shape === 'V' ? 12_000 : null,
    })),
  })).reverse();
}

export default function MosaicLabScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const bounds = useMemo(() => mosaicBounds(width - Spacing.three * 2), [width]);
  const messages = useMemo(() => fakeMessages(), []);

  return (
    <FlatList
      inverted
      data={messages}
      keyExtractor={(message) => message.id}
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <MessageBubble
          message={item}
          isOwn={item.authorId === 'me'}
          isRead={false}
          authorName="Собеседник"
          authorAvatarUrl={null}
          mediaBounds={bounds}
          onRetry={() => undefined}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.six,
  },
});
