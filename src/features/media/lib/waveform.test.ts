import { downsampleWaveform, WAVEFORM_BARS, WAVEFORM_MAX } from './waveform';

describe('downsampleWaveform', () => {
  it('has no waveform without samples', () => {
    expect(downsampleWaveform([])).toBeNull();
  });

  it('always yields the fixed number of bars in 0..31', () => {
    const long = Array.from({ length: 3000 }, (_, index) => (index % 10) / 10);
    const bars = downsampleWaveform(long)!;

    expect(bars).toHaveLength(WAVEFORM_BARS);
    expect(Math.min(...bars)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...bars)).toBeLessThanOrEqual(WAVEFORM_MAX);
    bars.forEach((bar) => expect(Number.isInteger(bar)).toBe(true));
  });

  it('stretches a recording shorter than the bar count', () => {
    const bars = downsampleWaveform([0, 1])!;

    expect(bars).toHaveLength(WAVEFORM_BARS);
    expect(bars[0]).toBe(0);
    expect(bars[WAVEFORM_BARS - 1]).toBe(WAVEFORM_MAX);
  });

  it('keeps the peak of each stretch so words stand out', () => {
    const levels = Array.from({ length: WAVEFORM_BARS * 4 }, (_, index) =>
      index === 5 ? 0.9 : 0.1,
    );
    const bars = downsampleWaveform(levels)!;

    expect(bars[1]).toBe(WAVEFORM_MAX);
    expect(bars[0]).toBeLessThan(bars[1]);
  });

  it('does not blow a quiet room up to full height', () => {
    const bars = downsampleWaveform(Array.from({ length: 100 }, () => 0.05))!;

    expect(Math.max(...bars)).toBeLessThan(WAVEFORM_MAX / 4);
  });

  it('treats out-of-range samples as bounds', () => {
    const bars = downsampleWaveform([-1, 2, Number.NaN])!;

    expect(Math.max(...bars)).toBe(WAVEFORM_MAX);
    expect(Math.min(...bars)).toBe(0);
  });
});
