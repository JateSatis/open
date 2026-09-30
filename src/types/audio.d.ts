// Звуки из assets: Metro отдаёт на их месте id ресурса, который понимает expo-audio.
declare module '*.wav' {
  const source: number;
  export default source;
}
