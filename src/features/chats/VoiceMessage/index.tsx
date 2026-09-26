import type { MessageAttachment } from '@/api/chats';
import { VoicePlayer } from '@/features/media';
import { useTheme } from '@/hooks/use-theme';

export type VoiceMessageProps = {
  attachment: MessageAttachment;
  /**
   * Локальный файл своего только что записанного голосового. Играет он, а не
   * загруженная копия: байты уже на телефоне.
   */
  localUri?: string;
  isOwn: boolean;
};

/** Голосовое внутри облачка: плеер в цветах своего или чужого сообщения. */
export function VoiceMessage({ attachment, localUri, isOwn }: VoiceMessageProps) {
  const theme = useTheme();
  const uri = localUri ?? attachment.url;

  return (
    <VoicePlayer
      // Ключ — сам файл: у своего голосового он не меняется, когда сервер
      // подтверждает отправку и id вложения становится настоящим, так что
      // запущенное до подтверждения продолжает считаться «этим».
      playbackKey={uri}
      uri={uri}
      durationMs={attachment.durationMs}
      waveform={attachment.waveform}
      buttonColor={isOwn ? theme.primaryText : theme.primary}
      buttonIconColor={isOwn ? theme.primary : theme.primaryText}
      playedColor={isOwn ? theme.primaryText : theme.primary}
      restColor={isOwn ? theme.waveformRestOnPrimary : theme.waveformRest}
      timeColor={isOwn ? 'primaryText' : 'textSecondary'}
    />
  );
}
