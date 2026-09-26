import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { formatDuration } from '@/features/media/lib/formatDuration';
import { seekVoice, toggleVoice, useVoicePlayback } from '@/features/media/voicePlayback';
import { Waveform } from '@/features/media/Waveform';
import type { ThemeColor } from '@/theme';

export type VoicePlayerProps = {
  /**
   * Чьё это голосовое для общего плеера — обычно id вложения. По нему плеер
   * понимает, что этот же ролик уже играет, а не запускает его заново.
   */
  playbackKey: string;
  /** Public URL from `attachments.url`, or a local `file://` URI before send. */
  uri: string;
  /**
   * From `attachments.duration_ms`. Shown before the file is loaded so the
   * bubble does not resize once playback starts.
   */
  durationMs: number | null;
  /** `attachments.waveform`. */
  waveform: readonly number[] | null;
  /** Цвета — от облачка: своё голосовое на синем, чужое на сером. */
  buttonColor: string;
  buttonIconColor: string;
  playedColor: string;
  restColor: string;
  timeColor: ThemeColor;
  style?: StyleProp<ViewStyle>;
};

/**
 * Длительность голосового для показа: секунды вниз, как везде, но не меньше
 * одной — «0:00» у отправленного голосового выглядит поломкой. То же правило
 * у превью в списке чатов (см. миграцию голосовых).
 */
export function voiceDurationLabel(durationMs: number): string {
  return formatDuration(Math.max(1000, durationMs));
}

export function VoicePlayer({
  playbackKey,
  uri,
  durationMs,
  waveform,
  buttonColor,
  buttonIconColor,
  playedColor,
  restColor,
  timeColor,
  style,
}: VoicePlayerProps) {
  const playback = useVoicePlayback(playbackKey);
  const input = { key: playbackKey, uri, durationMs };

  // Длительность из базы — пока плеер не знает свою: так подпись и облачко
  // стоят на месте с первого кадра.
  const totalMs = playback.durationMs > 0 ? playback.durationMs : (durationMs ?? 0);
  const progress =
    playback.isActive && totalMs > 0 ? Math.min(1, playback.positionMs / totalMs) : 0;
  const timeLabel = playback.isActive
    ? formatDuration(playback.positionMs)
    : voiceDurationLabel(totalMs);

  const buttonLabel = playback.loading
    ? 'Загрузка голосового сообщения, нажмите, чтобы отменить'
    : playback.playing
      ? 'Пауза'
      : 'Слушать голосовое сообщение';

  return (
    <View style={[styles.container, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={buttonLabel}
        accessibilityState={{ busy: playback.loading }}
        onPress={() => toggleVoice(input)}
        style={[styles.button, { backgroundColor: buttonColor }]}
      >
        {playback.loading ? (
          <ActivityIndicator color={buttonIconColor} />
        ) : (
          <Text variant="bodyBold" style={{ color: buttonIconColor }}>
            {playback.playing ? '❚❚' : '▶'}
          </Text>
        )}
      </Pressable>

      <View style={styles.body}>
        <Waveform
          bars={waveform}
          progress={progress}
          playedColor={playedColor}
          restColor={restColor}
          onSeek={(fraction) => seekVoice(input, fraction)}
          accessibilityValue={`${formatDuration(progress * totalMs)} из ${voiceDurationLabel(totalMs)}`}
        />
        <Text variant="caption" color={playback.failed ? 'danger' : timeColor}>
          {playback.failed ? 'Не удалось загрузить' : timeLabel}
        </Text>
      </View>
    </View>
  );
}
