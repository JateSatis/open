// Signatures only — no implementation yet. Placeholder types until the feed
// migration (excerpts/posts/clips/feed_items) and src/api/types.gen.ts exist.

import type { Page } from '@/api/chats';

export type FeedItemKind = 'excerpt' | 'post' | 'clip';

export type FeedItem = {
  id: string;
  kind: FeedItemKind;
  authorId: string;
  createdAt: string;
};

export function listFeed(params: { cursor?: string; limit?: number }): Promise<Page<FeedItem>> {
  throw new Error('Not implemented');
}

export function followUser(userId: string): Promise<void> {
  throw new Error('Not implemented');
}

export function unfollowUser(userId: string): Promise<void> {
  throw new Error('Not implemented');
}
