import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PopPublishForm } from './PopPublishForm';
import { PopVideoPreview } from './PopVideoPreview';
import { styles } from './styles';
import { acceptsPopVideo, usePopVideoPick, type PickedPopVideo } from './usePopVideoPick';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { useChannel } from '@/features/channels/useChannel';
import { setDraftPop } from '@/features/chats/composerDraftStore';
import {
  armMediaSheet,
  MediaPickSheet,
  openMediaSheet,
  releaseMediaSheetArm,
} from '@/features/chats/MediaPickerSheet';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { publishNewPop } from '@/features/pops/publishing';
import { useTheme } from '@/hooks/use-theme';
import { randomUuid } from '@/lib/uuid';
import { Sizes } from '@/theme';

/**
 * Откуда открыт редактор: из «Постов» выбранное видео уходит вложением в пост,
 * из «Попсов» — публикуется отсюда же, с подписью.
 */
export type PopEditorSource = 'posts' | 'pops';

export type PopEditorProps = { channelId: string; from: PopEditorSource };

/**
 * Редактор попа — пока заглушка: тёмный экран, превью выбранного видео и «М»
 * в левом нижнем углу, которая открывает шит медиа в режиме одного видео.
 * Позже здесь будет редактор видео как в TikTok.
 */
export function PopEditor({ channelId, from }: PopEditorProps) {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();
  const { data: channel } = useChannel(channelId);
  const [caption, setCaption] = useState('');
  const [alsoPost, setAlsoPost] = useState(true);

  // Из «Постов» выбор сразу становится вложением поста: результат — через
  // черновик чата постов, не через параметры маршрута.
  const accept = useCallback(
    (video: PickedPopVideo) => {
      if (from !== 'posts' || !channel) return;

      setDraftPop(channel.postsChatId, {
        type: 'new',
        popId: randomUuid(),
        uri: video.media.uri,
        posterUri: video.frame.uri,
        mimeType: video.media.mimeType,
        width: video.media.width,
        height: video.media.height,
        durationMs: video.media.durationMs,
      });
      router.back();
    },
    [channel, from, router],
  );

  const { video, error, checking, onPick } = usePopVideoPick(accept);
  const forPops = from === 'pops';

  const publish = () => {
    if (!video || !userId) return;

    publishNewPop(queryClient, userId, {
      channelId,
      media: video.media,
      posterUri: video.frame.uri,
      caption: caption.trim() || null,
      alsoPost,
    });
    router.back();
  };

  return (
    // Отступы безопасной зоны — снаружи: свой нижний отступ под клавиатуру
    // `KeyboardAvoidingView` ставит сам и перетёр бы их.
    <View
      style={[
        styles.screen,
        {
          backgroundColor: theme.viewerBackground,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        <View style={styles.header}>
          <Pressable
            testID="pop-editor-back"
            accessibilityRole="button"
            accessibilityLabel="Назад"
            onPress={() => router.back()}
            style={styles.iconButton}
          >
            <SymbolView
              name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
              size={Sizes.callIcon}
              tintColor={theme.textOnMedia}
            />
          </Pressable>
          <Text variant="bodyBold" color="textOnMedia">
            Новый поп
          </Text>
        </View>

        <View testID="pop-editor" style={styles.body}>
          {video && forPops ? (
            <PopVideoPreview uri={video.media.uri} />
          ) : checking ? (
            <ActivityIndicator accessibilityLabel="Проверка видео" color={theme.textOnMedia} />
          ) : (
            <Text color="textOnMediaSecondary" style={styles.hint}>
              Здесь будет редактор видео.{'\n'}Нажмите «M», чтобы выбрать вертикальное видео до 90
              секунд.
            </Text>
          )}
        </View>

        {error ? (
          <Text testID="pop-editor-error" color="danger" style={styles.error}>
            {error}
          </Text>
        ) : null}

        {forPops && video ? (
          <PopPublishForm
            caption={caption}
            onChangeCaption={setCaption}
            alsoPost={alsoPost}
            onToggleAlsoPost={() => setAlsoPost((value) => !value)}
          />
        ) : null}

        <View style={styles.footer}>
          <Button
            label="M"
            accessibilityLabel="Выбрать видео"
            variant="secondary"
            size="sm"
            onPressIn={() => armMediaSheet('pick')}
            onPressOut={releaseMediaSheetArm}
            onPress={() => openMediaSheet('pick')}
          />
          {forPops ? (
            <Button label="Опубликовать" size="sm" disabled={!video || !userId} onPress={publish} />
          ) : null}
        </View>
      </KeyboardAvoidingView>

      <MediaPickSheet accepts={acceptsPopVideo} onPick={onPick} />
    </View>
  );
}
