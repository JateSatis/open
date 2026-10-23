import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Pressable, Text as RNText, TextInput, View } from 'react-native';

import { ComposerButton } from './ComposerButton';
import { HideSelectionChip } from './HideSelectionChip';
import { styles } from './styles';

import { Text } from '@/components/Text';
import type { KeyboardOwner } from '@/features/chats/composerKeyboard';
import {
  deleteBefore,
  EmojiPanel,
  insertAt,
  rememberEmoji,
  useEmojiPanel,
  type Selection,
} from '@/features/chats/EmojiPanel';
import { HiddenTextSpans } from '@/features/chats/HiddenTextSpans';
import {
  addRange,
  coveredByHidden,
  normalizeRanges,
  removeRange,
  selectionToRange,
  type HiddenRange,
} from '@/features/chats/hiddenText';
import { HoldToRecordRow } from '@/features/media/HoldToRecordRow';
import { perfMark, perfMarkStart } from '@/features/media/perf';
import { useSelectionCount } from '@/features/media/selectionStore';
import type { LocalMedia } from '@/features/media/types';
import { PersonalDataHint } from '@/features/privacy/PersonalDataHint';
import { usePersonalDataGuard } from '@/features/privacy/usePersonalDataGuard';
import { useTheme } from '@/hooks/use-theme';
import { ComposerSizes, Spacing, Typography } from '@/theme';

export type MessageComposerProps = {
  text: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onTyping: () => void;
  /**
   * Members write, everyone else reads. The server decides — hiding the field
   * is only the polite half of that rule.
   */
  canSend: boolean;
  /**
   * Открывает шит выбора медиа. Не передаётся у копии composer'а внутри
   * самого шита — там прикреплять уже нечем открывать.
   */
  onAttachPress?: () => void;
  /**
   * Касание и уход пальца со скрепки. Шит открывает отпускание
   * (`onAttachPress`), а касание только готовит его — пока палец на кнопке,
   * успевает родиться окно шита.
   */
  onAttachPressIn?: () => void;
  onAttachPressOut?: () => void;
  /**
   * Касание и фокус поля ввода: так поле забирает себе клавиатуру. Касание
   * приходит раньше, чем клавиатура начинает выезжать, фокус — страховка на
   * случай, когда поле получило его не пальцем.
   */
  onFieldActivate?: () => void;
  /**
   * Чьё это поле для клавиатуры (`composerKeyboard`): под чатом, в шите медиа
   * или в панели комментариев. По нему панель эмодзи занимает место клавиатуры.
   */
  keyboardOwner?: KeyboardOwner;
  /**
   * Записанное голосовое. Без обработчика кнопки записи нет — так у копии
   * composer'а внутри шита медиа.
   */
  onSendVoice?: (voice: LocalMedia) => void;
  /** Идёт запись голосового — для «записывает голосовое…» у собеседников. */
  onRecordingVoice?: () => void;
  /** Плашка режима над полем: ответ, пересылка. */
  plate?: ReactNode;
  /**
   * Экран поля на виду. Ушёл под другой экран — панель эмодзи закрывается:
   * её «назад» не должно перехватывать «назад» верхнего экрана.
   */
  screenFocused?: boolean;
  /** Поле — чтобы отдать ему фокус, когда человек выбрал «Ответить». */
  inputRef?: RefObject<TextInput | null>;
  /** Отправить можно и с пустым полем: например, пересылку без подписи. */
  canSendEmpty?: boolean;
  /** Подсказка в пустом поле: «Сообщение» в чате, «Комментарий» в панели комментариев. */
  placeholder?: string;
  /**
   * Правка: справа «Сохранить», а активна ли она — решает итог правки
   * целиком (текст, оставленные вложения, запись), а не одно поле.
   */
  edit?: {
    canSave: boolean;
    /** Под плашкой голосовое: подписи у него не бывает. */
    textLocked: boolean;
    attachDisabled: boolean;
    recordDisabled: boolean;
  };
  /**
   * Скрытое от зрителей в тексте — code points. Есть — над выделенным в поле
   * встаёт «Скрыть от зрителей», а в листе о личных данных — «Скрыть
   * найденное». Нет (комментарий, заявка) — скрывать нечем.
   */
  hidden?: { ranges: HiddenRange[]; onChange: (ranges: HiddenRange[]) => void };
  /** Кто увидит отправленное — для подсказки и листа о личных данных. */
  audience?: string;
};

const SEND_ICON = { ios: 'arrow.up', android: 'send', web: 'send' } as const;
const SAVE_ICON = { ios: 'checkmark', android: 'check', web: 'check' } as const;

/**
 * Панель ввода: скрепка в круге слева, поле со всем остальным местом и
 * кнопкой эмодзи внутри, справа — микрофон, а когда есть что отправить —
 * «Отправить» (в правке — «Сохранить»). Эмодзи открывают панель на месте
 * клавиатуры (`EmojiPanel`).
 */
export function MessageComposer({
  text,
  onChangeText,
  onSend,
  onTyping,
  canSend,
  onAttachPress,
  onAttachPressIn,
  onAttachPressOut,
  onFieldActivate,
  keyboardOwner = 'chat',
  onSendVoice,
  onRecordingVoice,
  plate,
  inputRef,
  screenFocused = true,
  canSendEmpty = false,
  placeholder = 'Сообщение',
  edit,
  hidden,
  audience = 'Это сообщение увидят все, кто откроет чат.',
}: MessageComposerProps) {
  const theme = useTheme();
  // Счётчик берётся из стора выбора, а не приходит пропом: иначе выбор файла
  // перерисовывал бы весь экран чата ради цифры в кружке.
  const mediaCount = useSelectionCount();
  const ownRef = useRef<TextInput | null>(null);
  const fieldRef = inputRef ?? ownRef;
  const panel = useEmojiPanel(keyboardOwner, fieldRef, screenFocused);
  const selection = useRef<Selection>({ start: text.length, end: text.length });
  const pendingSelection = useRef<Selection | null>(null);
  /** Текст, который поле уже видело: сменили сверху — курсор в конец. */
  const seenText = useRef(text);
  /** Выделенный кусок поля, если он не пустой: над ним — «Скрыть от зрителей». */
  const [selected, setSelected] = useState<HiddenRange | null>(null);
  const guard = usePersonalDataGuard({ audience, canHide: Boolean(hidden) });

  // Текст из панели эмодзи пришёл сверху — курсор туда, где вставили, а не в конец.
  // Сменили текст снаружи (правка, черновик) — курсор в конце нового текста,
  // пока поле само не скажет другое.
  useEffect(() => {
    const next = pendingSelection.current;
    const external = text !== seenText.current && !next;

    seenText.current = text;
    if (external) selection.current = { start: text.length, end: text.length };
    if (!next) return;

    pendingSelection.current = null;
    fieldRef.current?.setSelection(next.start, next.end);
  }, [fieldRef, text]);

  if (!canSend) {
    return (
      <View style={[styles.notice, { borderTopColor: theme.border }]}>
        <Text variant="small" color="textSecondary">
          Читать этот чат может кто угодно, писать — только участники.
        </Text>
      </View>
    );
  }

  const isEmpty = edit ? !edit.canSave : !text.trim() && mediaCount === 0 && !canSendEmpty;
  const textLocked = edit?.textLocked ?? false;
  // Микрофон — когда отправлять нечего; в правке — только пока сохранять
  // нечего, а записать новое голосовое можно.
  const showMic = Boolean(onSendVoice) && (edit ? !edit.canSave && !edit.recordDisabled : isEmpty);

  const submit = () => {
    if (isEmpty) return;

    // Похоже на адрес, школу, геолокацию — сначала лист: поправить, скрыть
    // найденное или отправить как есть.
    guard.check(textLocked ? '' : text, ({ hide }) => {
      if (hide && hidden) {
        hidden.onChange(
          normalizeRanges([...hidden.ranges, ...hide.map(({ start, end }) => ({ start, end }))]),
        );
      }

      onSend();
    });
  };

  const hiddenRanges = hidden?.ranges ?? [];
  const selectionCovered = selected
    ? coveredByHidden(hiddenRanges, selected.start, selected.end)
    : false;

  const toggleSelectedHidden = () => {
    if (!hidden || !selected) return;

    hidden.onChange(
      selectionCovered ? removeRange(hidden.ranges, selected) : addRange(hidden.ranges, selected),
    );
  };

  const applyEdit = (next: { text: string; selection: Selection } | null) => {
    if (!next) return;

    selection.current = next.selection;
    pendingSelection.current = next.selection;
    seenText.current = next.text;
    onChangeText(next.text);
    onTyping();
  };

  const pickEmoji = (emoji: string) => {
    rememberEmoji(emoji);
    applyEdit(insertAt(text, selection.current, emoji));
  };

  const sendButton = (
    <ComposerButton
      testID="composer-send"
      icon={edit ? SAVE_ICON : SEND_ICON}
      accessibilityLabel={edit ? 'Сохранить' : 'Отправить'}
      variant="primary"
      disabled={isEmpty}
      count={edit ? 0 : mediaCount}
      onPress={submit}
    />
  );

  const inputs = (
    <>
      {onAttachPress ? (
        <ComposerButton
          testID="composer-attach"
          icon={{ ios: 'paperclip', android: 'attach_file', web: 'attach_file' }}
          accessibilityLabel="Фото и видео"
          variant="plain"
          disabled={edit?.attachDisabled}
          onPressIn={() => {
            perfMarkStart('M: касание');
            onAttachPressIn?.();
          }}
          onPressOut={onAttachPressOut}
          onPress={() => {
            perfMark('M: отпускание');
            onAttachPress();
          }}
        />
      ) : null}

      <View style={[styles.fieldBox, { borderColor: theme.border }]}>
        <Pressable
          testID="composer-emoji"
          accessibilityRole="button"
          accessibilityLabel={panel.mode === 'emoji' ? 'Клавиатура' : 'Эмодзи'}
          disabled={textLocked}
          onPress={panel.toggle}
          hitSlop={Spacing.one}
          style={[styles.fieldButton, textLocked && styles.locked]}
        >
          <SymbolView
            name={
              panel.mode === 'emoji'
                ? { ios: 'keyboard', android: 'keyboard', web: 'keyboard' }
                : { ios: 'face.smiling', android: 'mood', web: 'mood' }
            }
            size={ComposerSizes.fieldIcon}
            tintColor={theme.textSecondary}
          />
        </Pressable>

        <TextInput
          ref={fieldRef}
          accessibilityLabel={placeholder}
          placeholder={textLocked ? 'Без подписи' : placeholder}
          placeholderTextColor={theme.textSecondary}
          // Со скрытым — текст кусками: скрытое с пометкой, как его увидят участники.
          value={hiddenRanges.length > 0 ? undefined : text}
          editable={!textLocked}
          multiline
          // Пока открыта панель эмодзи, поле в фокусе, но без клавиатуры.
          showSoftInputOnFocus={panel.mode !== 'emoji'}
          onPressIn={() => {
            panel.onFieldPressIn();
            onFieldActivate?.();
          }}
          onFocus={onFieldActivate}
          onSelectionChange={(event) => {
            const next = event.nativeEvent.selection;

            selection.current = next;
            setSelected(
              hidden && next.start !== next.end
                ? selectionToRange(text, next.start, next.end)
                : null,
            );
          }}
          onChangeText={(value) => {
            seenText.current = value;
            onChangeText(value);
            onTyping();
          }}
          style={[styles.field, { color: theme.text }]}
        >
          {/* Внутри поля — один текст, куски в нём: голые строки поле не принимает. */}
          {hiddenRanges.length > 0 ? (
            <RNText style={[Typography.body, { color: theme.text }]}>
              <HiddenTextSpans text={text} ranges={hiddenRanges} />
            </RNText>
          ) : null}
        </TextInput>
      </View>
    </>
  );

  return (
    <View style={[styles.container, { borderTopColor: theme.border }]}>
      {plate}
      {textLocked ? null : <PersonalDataHint text={text} />}
      {hidden && selected && !textLocked ? (
        <HideSelectionChip covered={selectionCovered} onPress={toggleSelectedHidden} />
      ) : null}
      {onSendVoice ? (
        <HoldToRecordRow
          style={styles.row}
          onSend={onSendVoice}
          onActivity={onRecordingVoice}
          recordDisabled={edit?.recordDisabled}
          trailing={showMic ? undefined : sendButton}
        >
          {inputs}
        </HoldToRecordRow>
      ) : (
        <View style={styles.row}>
          {inputs}
          {sendButton}
        </View>
      )}

      {panel.mounted ? (
        <EmojiPanel
          size={panel.size}
          open={panel.mode !== 'off'}
          onPick={pickEmoji}
          onDelete={() => applyEdit(deleteBefore(text, selection.current))}
          onReady={panel.onPanelReady}
          owner={keyboardOwner}
        />
      ) : null}
      {guard.sheet}
    </View>
  );
}
