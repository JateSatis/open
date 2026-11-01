import type { Message } from '@/api/messageRows';

export const MESSAGE_PAGE_SIZE = 30;

/** Страница переписки с курсором — номером самого старого сообщения на ней. */
export type MessagePage = { items: Message[]; nextCursor: number | null };
