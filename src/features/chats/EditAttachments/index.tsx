import { Image } from 'expo-image';
import { Pressable, ScrollView, View } from 'react-native';

import { styles } from './styles';

import type { MessageAttachment } from '@/api/chats';
import { Text } from '@/components/Text';
import type { EditVoice } from '@/features/chats/messages/types';
import { VoiceMessage } from '@/features/chats/VoiceMessage';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type EditAttachmentsProps = {
  kept: MessageAttachment[];
  voice: EditVoice | null;
  onRemoveAttachment: (attachmentId: string) => void;
  onRemoveVoice: () => void;
};

function voiceAttachment(voice: EditVoice): { attachment: MessageAttachment; uri?: string } {
  if (voice.type === 'kept') return { attachment: voice.attachment, uri: voice.localUri };

  return {
    attachment: {
      id: voice.voice.uri,
      url: voice.voice.uri,
      posterUrl: null,
      mimeType: voice.voice.mimeType,
      width: null,
      height: null,
      durationMs: voice.voice.durationMs,
      waveform: voice.voice.waveform ?? null,
    },
    uri: voice.voice.uri,
  };
}

function RemoveButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={Spacing.one}
      onPress={onPress}
      style={[styles.remove, { backgroundColor: theme.mediaScrim }]}
    >
      <Text variant="caption" color="textOnMedia">
        ✕
      </Text>
    </Pressable>
  );
}

/**
 * Что останется от вложений после правки: миниатюры фото и видео или запись
 * голосового — у каждого крестик, убирающий его из новой версии. Файлы при
 * этом никуда не деваются: их держит прежняя версия, пересланные копии и
 * ревизия.
 */
export function EditAttachments({
  kept,
  voice,
  onRemoveAttachment,
  onRemoveVoice,
}: EditAttachmentsProps) {
  const theme = useTheme();

  if (voice) {
    const { attachment, uri } = voiceAttachment(voice);

    return (
      <View
        testID="edit-voice-chip"
        style={[styles.voiceChip, { backgroundColor: theme.backgroundElement }]}
      >
        <View style={styles.voicePlayer}>
          <VoiceMessage attachment={attachment} localUri={uri} isOwn={false} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Убрать голосовое"
          hitSlop={Spacing.two}
          onPress={onRemoveVoice}
          style={styles.voiceRemove}
        >
          <Text color="textSecondary">✕</Text>
        </Pressable>
      </View>
    );
  }

  if (kept.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.strip}
    >
      {kept.map((attachment) => {
        const isVideo = Boolean(attachment.mimeType?.startsWith('video/'));
        const thumbnail = isVideo ? attachment.posterUrl : attachment.url;

        return (
          <View
            key={attachment.id}
            testID="edit-attachment"
            style={[styles.thumbnail, { backgroundColor: theme.backgroundSelected }]}
          >
            {thumbnail ? (
              <Image
                source={{ uri: thumbnail }}
                style={styles.image}
                contentFit="cover"
                accessibilityIgnoresInvertColors
              />
            ) : null}
            {isVideo ? (
              <View style={styles.videoMark}>
                <Text variant="caption" color="textOnMedia">
                  ▶
                </Text>
              </View>
            ) : null}
            <RemoveButton
              label={isVideo ? 'Убрать видео' : 'Убрать фото'}
              onPress={() => onRemoveAttachment(attachment.id)}
            />
          </View>
        );
      })}
    </ScrollView>
  );
}
