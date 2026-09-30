import { SymbolView } from 'expo-symbols';
import { View } from 'react-native';

import { styles } from './styles';

import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import type { CallSpeaker } from '@/features/streams/callStore';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export type SpeakerTileProps = {
  speaker: CallSpeaker;
  avatarUrl: string | null;
};

/** Говорящий: аватар, имя, кольцо, пока он говорит, и значок выключенного микрофона. */
export function SpeakerTile({ speaker, avatarUrl }: SpeakerTileProps) {
  const theme = useTheme();
  const name = speaker.isLocal ? 'Вы' : speaker.name;

  return (
    <View
      testID={`speaker-${speaker.id}`}
      accessibilityLabel={`${name}${speaker.speaking ? ', говорит' : ''}${speaker.micOn ? '' : ', микрофон выключен'}`}
      style={styles.tile}
    >
      <View
        style={[styles.ring, { borderColor: speaker.speaking ? theme.callBar : 'transparent' }]}
      >
        <Avatar uri={avatarUrl} name={speaker.name} size={Sizes.callAvatar} />
      </View>

      {!speaker.micOn ? (
        <View
          testID={`speaker-muted-${speaker.id}`}
          style={[
            styles.mutedBadge,
            { backgroundColor: theme.danger, borderColor: theme.callBackground },
          ]}
        >
          <SymbolView
            name={{ ios: 'mic.slash.fill', android: 'mic_off', web: 'mic_off' }}
            size={Sizes.callMutedBadge / 2}
            tintColor={theme.textOnMedia}
          />
        </View>
      ) : null}

      <Text variant="small" color="textOnMedia" numberOfLines={1} style={styles.tileName}>
        {name}
      </Text>
    </View>
  );
}
