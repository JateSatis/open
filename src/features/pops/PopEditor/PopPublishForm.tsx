import { SymbolView } from 'expo-symbols';
import { Pressable, TextInput, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { MediaLimits } from '@/features/media';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export type PopPublishFormProps = {
  caption: string;
  onChangeCaption: (caption: string) => void;
  alsoPost: boolean;
  onToggleAlsoPost: () => void;
};

/** Подпись попа и галочка «в посты» — на тёмном экране редактора. */
export function PopPublishForm({
  caption,
  onChangeCaption,
  alsoPost,
  onToggleAlsoPost,
}: PopPublishFormProps) {
  const theme = useTheme();

  return (
    <View style={styles.form}>
      <TextInput
        testID="pop-caption"
        accessibilityLabel="Подпись"
        value={caption}
        onChangeText={onChangeCaption}
        placeholder="Подпись"
        placeholderTextColor={theme.textOnMediaSecondary}
        maxLength={MediaLimits.pop.maxCaptionLength}
        multiline
        style={[styles.caption, { color: theme.textOnMedia, backgroundColor: theme.mediaControl }]}
      />

      <Pressable
        testID="pop-also-post"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: alsoPost }}
        onPress={onToggleAlsoPost}
        style={styles.checkRow}
      >
        <SymbolView
          name={
            alsoPost
              ? { ios: 'checkmark.square.fill', android: 'check_box', web: 'check_box' }
              : {
                  ios: 'square',
                  android: 'check_box_outline_blank',
                  web: 'check_box_outline_blank',
                }
          }
          size={Sizes.callIcon}
          tintColor={alsoPost ? theme.primary : theme.textOnMediaSecondary}
        />
        <Text color="textOnMedia">Опубликовать в посты</Text>
      </Pressable>
    </View>
  );
}
