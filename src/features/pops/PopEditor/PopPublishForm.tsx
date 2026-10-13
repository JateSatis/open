import { SymbolView } from 'expo-symbols';
import { Pressable, TextInput, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { MediaLimits } from '@/features/media';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export const TITLE_REQUIRED = 'Добавьте название — без него поп не опубликовать';

export type PopPublishFormProps = {
  title: string;
  onChangeTitle: (title: string) => void;
  /** Нажали «Опубликовать» без названия — под полем подсказка. */
  titleMissing: boolean;
  /** Нет — только название: поп из «Постов», его текст — у поста. */
  details?: {
    caption: string;
    onChangeCaption: (caption: string) => void;
    alsoPost: boolean;
    onToggleAlsoPost: () => void;
  };
};

/** Название, подпись попа и галочка «в посты» — на тёмном экране редактора. */
export function PopPublishForm({ title, onChangeTitle, titleMissing, details }: PopPublishFormProps) {
  const theme = useTheme();
  const field = { color: theme.textOnMedia, backgroundColor: theme.mediaControl };

  return (
    <View style={styles.form}>
      <TextInput
        testID="pop-title"
        accessibilityLabel="Название"
        value={title}
        onChangeText={onChangeTitle}
        placeholder="Название"
        placeholderTextColor={theme.textOnMediaSecondary}
        maxLength={MediaLimits.pop.maxTitleLength}
        returnKeyType="done"
        style={[styles.title, field]}
      />
      {titleMissing ? (
        <Text testID="pop-title-required" variant="small" color="danger">
          {TITLE_REQUIRED}
        </Text>
      ) : null}

      {details ? (
        <>
          <TextInput
            testID="pop-caption"
            accessibilityLabel="Подпись"
            value={details.caption}
            onChangeText={details.onChangeCaption}
            placeholder="Подпись"
            placeholderTextColor={theme.textOnMediaSecondary}
            maxLength={MediaLimits.pop.maxCaptionLength}
            multiline
            style={[styles.caption, field]}
          />

          <Pressable
            testID="pop-also-post"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: details.alsoPost }}
            onPress={details.onToggleAlsoPost}
            style={styles.checkRow}
          >
            <SymbolView
              name={
                details.alsoPost
                  ? { ios: 'checkmark.square.fill', android: 'check_box', web: 'check_box' }
                  : {
                      ios: 'square',
                      android: 'check_box_outline_blank',
                      web: 'check_box_outline_blank',
                    }
              }
              size={Sizes.callIcon}
              tintColor={details.alsoPost ? theme.primary : theme.textOnMediaSecondary}
            />
            <Text color="textOnMedia">Опубликовать в посты</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}
