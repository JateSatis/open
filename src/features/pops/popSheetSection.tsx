import type { Pop } from '@/api/pops';
import type { SheetSection, SheetSectionSlot } from '@/features/chats/MediaPickerSheet';
import { useHasSelection } from '@/features/media';
import { PopGrid } from '@/features/pops/PopGrid';

export type PopSheetSectionOptions = {
  channelId: string;
  /** Плитка «+ Новый поп» — у того, кто может публиковать. */
  canAdd: boolean;
  onAdd: () => void;
  /** Тап по попу: он становится вложением поста. */
  onPick: (pop: Pop) => void;
};

/** Вкладка «Pop» шита медиа в «Постах» канала: попсы канала и «+ Новый поп». */
export function popSheetSection(options: PopSheetSectionOptions): SheetSection {
  return {
    key: 'pop',
    label: 'Pop',
    render: (slot) => <PopSheetGrid slot={slot} {...options} />,
  };
}

function PopSheetGrid({
  slot,
  channelId,
  canAdd,
  onAdd,
  onPick,
}: PopSheetSectionOptions & { slot: SheetSectionSlot }) {
  // Поп и фото из галереи в одном посте не встречаются: пока выбраны файлы,
  // попсы притушены.
  const gallerySelected = useHasSelection();

  return (
    <PopGrid
      testID="pop-sheet-grid"
      ListComponent={slot.List}
      header={slot.header}
      footer={slot.footer}
      minContentHeight={slot.minContentHeight}
      channelId={channelId}
      canAdd={canAdd}
      onAdd={onAdd}
      addLabel="Новый поп"
      onPop={onPick}
      popsDisabled={gallerySelected}
      showDuration
    />
  );
}
