import type { ChatMessage } from '@/features/chats/messages/types';

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** «27.09.2026 14:05» — дата нужна: выбранное может растянуться на несколько дней. */
function formatStamp(iso: string): string {
  const date = new Date(iso);

  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * Текст для буфера обмена. Одно сообщение — как есть. Несколько — в порядке
 * переписки, у каждого автор и время, как в Telegram: иначе вставленная
 * куда-то реплика теряет, кто и когда её сказал. Сообщения без текста
 * пропускаются — голосовое или фото в буфер текстом не положить.
 */
export function formatMessagesForCopy(
  messages: ChatMessage[],
  authorName: (authorId: string | null) => string,
): string {
  const withText = messages
    .filter((message) => message.text?.trim())
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

  if (withText.length === 1) return withText[0].text ?? '';

  return withText
    .map(
      (message) =>
        `${authorName(message.authorId)}, [${formatStamp(message.createdAt)}]\n${message.text}`,
    )
    .join('\n\n');
}
