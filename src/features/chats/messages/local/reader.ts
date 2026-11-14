import { createContext, useContext } from 'react';

export const HistoryReader = createContext<string | null>(null);
export function useHistoryReader() {
  return useContext(HistoryReader);
}
export function stillReader(reader: string) {
  return currentReader() === reader;
}
let currentReader: () => string | null = () => null;
export function bindHistoryReader(read: () => string | null) {
  currentReader = read;
}
