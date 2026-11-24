/** Экран, его запросы и отложенные обработчики живут до следующего выбора клиента. */
let selection = 0;

export function changeRequestSelection() {
  selection++;
}

export function requestSelection() {
  return selection;
}
