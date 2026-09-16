import type { ReactNode } from 'react';
import { View } from 'react-native';

import { styles } from './styles';

import type { Profile } from '@/api/profile';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { displayNameOf, formatUsername } from '@/features/profile/username';
import { Spacing } from '@/theme';

const AVATAR_SIZE = Spacing.six * 1.5;

export type ProfileViewProps = {
  profile: Profile;
  /** Buttons shown under the profile — differ for one's own and someone else's. */
  actions?: ReactNode;
};

export function ProfileView({ profile, actions }: ProfileViewProps) {
  const name = displayNameOf(profile);
  const username = formatUsername(profile.username);

  return (
    <View style={styles.container}>
      <Avatar uri={profile.avatarUrl} name={name} size={AVATAR_SIZE} />

      <View style={styles.identity}>
        <Text variant="title">{name}</Text>
        {username ? (
          <Text variant="body" color="textSecondary">
            {username}
          </Text>
        ) : null}
      </View>

      {profile.bio ? (
        <Text variant="body" color="textSecondary" style={styles.bio}>
          {profile.bio}
        </Text>
      ) : null}

      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}
