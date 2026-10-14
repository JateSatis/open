import type { SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';

import type { AvatarPairPerson } from '@/components/AvatarPair';

export type InfoIcon = SymbolViewProps['name'];

/** Лицо страницы: одна аватарка (фото или буква) или двое внахлёст. */
export type InfoAvatar =
  | { kind: 'single'; uri: string | null; name: string }
  | { kind: 'pair'; first: AvatarPairPerson; second: AvatarPairPerson };

/** Строка под именем: «в сети» — акцентом, остальное — приглушённо. */
export type InfoStatus = { text: string; accent?: boolean };

/** Кнопка ряда под именем: «Звонок», позже «Сообщение», «Подписаться»… */
export type InfoAction = {
  id: string;
  label: string;
  icon: InfoIcon;
  onPress: () => void;
  disabled?: boolean;
};

export type InfoTab = {
  key: string;
  title: string;
  /** Сводка вкладки в компактном заголовке, когда полоса вкладок прилипла. */
  summary: string;
  /** Содержимое — `InfoTabList` с этим номером вкладки. */
  render: (tab: number) => ReactNode;
  /** Поиск по вкладке: лупа в панели, пока шапка свёрнута и вкладка открыта. */
  onSearch?: () => void;
};

/** Поиск, открытый на месте панели: поле вместо названия и кнопок. */
export type InfoSearch = {
  value: string;
  onChangeText: (value: string) => void;
  onClose: () => void;
  placeholder: string;
};

/** Управление страницей снаружи — из меню владельца. */
export type InfoPageHandle = {
  /** Перейти на вкладку и свернуть шапку — например, к «Участникам» для поиска по ним. */
  focusTab: (tabKey: string) => void;
};
