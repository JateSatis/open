import { getHistoryItems, getHistoryGroupKeys } from '@/api/historyWindow';
import type { Message } from '@/api/messageRows';
import { mergeMessages, type ChatHistory } from './historyCache';

export async function readForwardSlices(messages: Message[]) {
  const byChat = new Map<string, Set<string>>();
  const requested = new Set<string>();
  for (const message of messages) {
    if (!message.forward && !message.forwardGroup) continue;
    const keys = byChat.get(message.chatId) ?? new Set<string>();
    keys.add(message.id);
    requested.add(message.id);
    for (const id of [
      ...(message.forward?.items.map((item) => item.id) ?? []),
      ...(message.forwardItemKeys ?? []),
    ]) {
      keys.add(id);
      requested.add(id);
    }
    byChat.set(message.chatId, keys);
  }
  // Membership is cheap and viewer-filtered. Discover newly published siblings
  // only inside the already verified range; content stays bounded by that range.
  const groups = new Map<string, { message: Message; start: number; end: number }>();
  for (const message of messages) {
    if (!message.forward && !message.forwardGroup) continue;
    const range = message.forwardRange ?? { start: 0, end: 99 };
    const previous = groups.get(message.id);
    groups.set(message.id, {
      message,
      start: Math.min(previous?.start ?? range.start, range.start),
      end: Math.max(previous?.end ?? range.end, range.end),
    });
  }
  for (const { message, start, end } of groups.values()) {
    const members = await getHistoryGroupKeys(message.chatId, message.id);
    for (const member of members) {
      if (member.position < start || member.position > end) continue;
      byChat.get(message.chatId)!.add(member.key);
      requested.add(member.key);
    }
  }
  const fresh: Message[] = [];
  for (const [chatId, keys] of byChat) {
    const ids = [...keys];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const rows = await getHistoryItems(chatId, ids.slice(offset, offset + 100));
      fresh.push(...rows.map((row) => row.message));
    }
  }
  return {
    requested,
    messages: mergeMessages({ items: [], nextCursor: null }, fresh, 'older').items,
  };
}

/** A response removes only requested occurrences; neighbours loaded while the
 * request was in flight remain in the cache. */
export function patchForwardSlices(
  history: ChatHistory,
  fresh: Awaited<ReturnType<typeof readForwardSlices>>,
): ChatHistory {
  if (!fresh.requested.size) return history;
  const groups = new Map(fresh.messages.map((message) => [message.id, message]));
  const items = history.items.flatMap((message) => {
    if ((!message.forward && !message.forwardGroup) || !fresh.requested.has(message.id))
      return [message];
    const received = groups.get(message.id);
    const range = message.forwardRange;
    const next =
      received?.forward && range
        ? {
            ...received,
            forward: {
              ...received.forward,
              items: received.forward.items.filter(
                (item) => item.position >= range.start && item.position <= range.end,
              ),
            },
          }
        : received;
    if (next?.hidden)
      return [
        {
          ...message,
          ...next,
          forwardItemKeys: [
            ...new Set([
              ...(message.forwardItemKeys ?? []),
              ...(message.forward?.items.map((item) => item.id) ?? []),
            ]),
          ],
        },
      ];
    if (!message.forward?.items.length) return next ? [{ ...message, ...next }] : [];
    const versions = new Map(next?.forward?.items.map((item) => [item.id, item]));
    const kept = message.forward.items.flatMap((item) => {
      if (!fresh.requested.has(item.id)) return [item];
      const version = versions.get(item.id);
      return version ? [version] : [];
    });
    const existing = new Set(kept.map((item) => item.id));
    for (const item of next?.forward?.items ?? []) if (!existing.has(item.id)) kept.push(item);
    kept.sort((a, b) => a.position - b.position);
    if (!kept.length && !next) return [];
    return [
      { ...message, ...next, forward: { ...(next?.forward ?? message.forward), items: kept } },
    ];
  });
  return { ...history, items };
}
