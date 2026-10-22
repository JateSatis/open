import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { SHOW_IN_CHAT } from './MediaTab';
import { TabStatus, tabStatusOf } from './TabStatus';
import { chatInfoKeys, useChatVoices } from './queries';

import type { ChatVoiceItem } from '@/api/chatInfo';
import { AnchoredMenu, type MenuAnchor } from '@/components/AnchoredMenu';
import { InfoTabList } from '@/components/InfoPage';
import { Text } from '@/components/Text';
import { hiddenMediaLabel } from '@/features/chats/HiddenMediaTile';
import { DELETED_ACCOUNT } from '@/features/chats/messageQuote';
import { formatDuration, stopVoice, VideoNotePlayer } from '@/features/media';
import { toggleVoice, useVoicePlayback } from '@/features/media/voicePlayback';
import { useMediaSource } from '@/hooks/use-media-source';
import { useTheme } from '@/hooks/use-theme';
import { formatDateTime } from '@/lib/dates';
import { InfoPageSizes, Radii, Sizes, Spacing } from '@/theme';

const S = InfoPageSizes;
const SKELETON_ROWS = 8;

type Row = { type: 'voice'; item: ChatVoiceItem } | { type: 'skeleton'; key: string };

export type VoicesTabProps = {
  tab: number;
  chatId: string;
  onShowInChat: (messageId: string, seq: number) => void;
};

/**
 * Вкладка «Голосовые»: голосовые и кружки чата, свежие сверху. Тап играет на
 * месте, без перехода в чат; долгое нажатие — «Показать в чате».
 */
export function VoicesTab({ tab, chatId, onShowInChat }: VoicesTabProps) {
  const queryClient = useQueryClient();
  const query = useChatVoices(chatId);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; item: ChatVoiceItem } | null>(null);

  const rows = useMemo<Row[]>(() => {
    if (query.data === undefined && query.status !== 'error') {
      return Array.from({ length: SKELETON_ROWS }, (_, at) => ({
        type: 'skeleton',
        key: `s${at}`,
      }));
    }

    return (query.data?.pages ?? []).flatMap((page) =>
      page.items.map((item) => ({ type: 'voice' as const, item })),
    );
  }, [query.data, query.status]);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const retry = useCallback(() => {
    if (query.data === undefined) {
      void queryClient.resetQueries({ queryKey: chatInfoKeys.voices(chatId), exact: true });
    } else {
      void fetchNextPage();
    }
  }, [chatId, fetchNextPage, query.data, queryClient]);

  const toggleNote = useCallback((item: ChatVoiceItem) => {
    stopVoice();
    setOpenNote((current) => (current === item.messageId ? null : item.messageId));
  }, []);

  const openMenu = useCallback(
    (item: ChatVoiceItem, anchor: MenuAnchor) => setMenu({ item, anchor }),
    [],
  );

  return (
    <>
      <InfoTabList
        tab={tab}
        testID="info-voices"
        data={rows}
        extraData={openNote}
        keyExtractor={(row) => (row.type === 'voice' ? row.item.messageId : row.key)}
        getItemType={(row) => (row.type === 'voice' ? row.item.kind : 'skeleton')}
        renderItem={({ item: row }) =>
          row.type === 'skeleton' ? (
            <SkeletonRow />
          ) : (
            <VoiceRow
              item={row.item}
              noteOpen={openNote === row.item.messageId}
              onToggleNote={toggleNote}
              onLongPress={openMenu}
            />
          )
        }
        onEndReached={loadMore}
        onEndReachedThreshold={1}
        footer={<TabStatus state={tabStatusOf(query)} what="голосовые" onRetry={retry} />}
      />

      <AnchoredMenu
        testID="info-voice-menu"
        anchor={menu?.anchor ?? null}
        actions={SHOW_IN_CHAT}
        onSelect={() => {
          if (menu) onShowInChat(menu.item.messageId, menu.item.seq);
        }}
        onClosed={() => setMenu(null)}
      />
    </>
  );
}

function SkeletonRow() {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      <View style={[styles.circle, { backgroundColor: theme.backgroundElement }]} />
      <View style={styles.text}>
        <View style={[styles.skeletonLine, { backgroundColor: theme.backgroundElement }]} />
        <View style={[styles.skeletonLineShort, { backgroundColor: theme.backgroundElement }]} />
      </View>
    </View>
  );
}

type VoiceRowProps = {
  item: ChatVoiceItem;
  noteOpen: boolean;
  onToggleNote: (item: ChatVoiceItem) => void;
  onLongPress: (item: ChatVoiceItem, anchor: MenuAnchor) => void;
};

const VoiceRow = memo(function VoiceRow({
  item,
  noteOpen,
  onToggleNote,
  onLongPress,
}: VoiceRowProps) {
  const theme = useTheme();
  const ref = useRef<View>(null);
  const playback = useVoicePlayback(item.url);
  const isNote = item.kind === 'video_note';
  const author = item.authorName ?? DELETED_ACCOUNT;
  const progress =
    playback.isActive && playback.durationMs > 0 ? playback.positionMs / playback.durationMs : 0;

  const poster = useMediaSource(item.posterUrl);

  const press = () => {
    // Автор скрыл запись от меня — файла нет, играть нечего.
    if (item.hidden) return;

    if (isNote) {
      onToggleNote(item);
      return;
    }

    toggleVoice({ key: item.url, uri: item.url, durationMs: item.durationMs });
  };

  return (
    <Pressable
      ref={ref}
      testID="info-voice-row"
      accessibilityRole="button"
      accessibilityLabel={
        item.hidden
          ? hiddenMediaLabel(isNote ? 'video' : 'voice')
          : isNote
            ? 'Видеосообщение'
            : 'Голосовое сообщение'
      }
      onPress={press}
      onLongPress={() =>
        ref.current?.measureInWindow((x, y, width, height) =>
          onLongPress(item, { x, y, width, height }),
        )
      }
      style={({ pressed }) => [pressed && { backgroundColor: theme.backgroundElement }]}
    >
      <View style={styles.row}>
        {item.hidden ? (
          <View
            testID="info-voice-hidden"
            style={[styles.circle, styles.centered, { backgroundColor: theme.backgroundSelected }]}
          >
            <SymbolView
              name={{ ios: 'eye.slash', android: 'visibility_off', web: 'visibility_off' }}
              size={Sizes.callIcon}
              tintColor={theme.textSecondary}
            />
          </View>
        ) : isNote ? (
          <View style={[styles.circle, { backgroundColor: theme.backgroundElement }]}>
            {poster ? <Image source={poster} style={styles.fill} contentFit="cover" /> : null}
            <View style={[StyleSheet.absoluteFill, styles.centered]}>
              <SymbolView
                name={{ ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }}
                size={Sizes.callIcon}
                tintColor={theme.textOnMedia}
              />
            </View>
          </View>
        ) : (
          <View style={[styles.circle, styles.centered, { backgroundColor: theme.primary }]}>
            {playback.loading ? (
              <ActivityIndicator color={theme.primaryText} />
            ) : (
              <SymbolView
                name={
                  playback.playing
                    ? { ios: 'pause.fill', android: 'pause', web: 'pause' }
                    : { ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }
                }
                size={Sizes.callIcon}
                tintColor={theme.primaryText}
              />
            )}
          </View>
        )}
        <View style={styles.text}>
          <Text variant="bodyBold" numberOfLines={1}>
            {/* Время чата бывает скрыто — тогда строку называет вид записи. */}
            {item.createdAt
              ? formatDateTime(item.createdAt)
              : item.kind === 'video_note'
                ? 'Видеосообщение'
                : 'Голосовое'}
          </Text>
          <Text variant="small" color="textSecondary" numberOfLines={1}>
            {item.hidden
              ? `${author} • ${hiddenMediaLabel(isNote ? 'video' : 'voice')} • ${formatDuration(item.durationMs)}`
              : `${author} • ${formatDuration(playback.isActive ? playback.positionMs : item.durationMs)}`}
          </Text>
          {playback.isActive ? (
            <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
              <View
                style={[
                  styles.trackFill,
                  { backgroundColor: theme.primary, width: `${progress * 100}%` },
                ]}
              />
            </View>
          ) : null}
        </View>
      </View>
      {isNote && noteOpen ? (
        <View style={styles.note}>
          <VideoNotePlayer uri={item.url} durationMs={item.durationMs} size={NOTE_SIZE} autoPlay />
        </View>
      ) : null}
    </Pressable>
  );
});

/** Открытый на месте кружок — крупно, но не во весь экран. */
const NOTE_SIZE = S.noteSize;

const styles = StyleSheet.create({
  row: {
    height: S.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  circle: {
    width: S.voiceButton,
    height: S.voiceButton,
    borderRadius: Radii.full,
    overflow: 'hidden',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  text: {
    flex: 1,
    gap: Spacing.half,
  },
  track: {
    height: Spacing.half,
    borderRadius: Radii.full,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
  },
  skeletonLine: {
    height: Spacing.three,
    width: '50%',
    borderRadius: Radii.sm,
  },
  skeletonLineShort: {
    height: Spacing.three,
    width: '30%',
    borderRadius: Radii.sm,
  },
  note: {
    alignItems: 'center',
    paddingBottom: Spacing.three,
  },
});
