// Pure helpers for the spectrogram lab (unit-tested).

export const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
export const melToHz = (mel: number) => 700 * (10 ** (mel / 2595) - 1);

/** Edges of `bands` mel bands between fMin and fMax, mapped to FFT bin indices. */
export function melBinEdges(bands: number, fftBins: number, sampleRate: number, fMin = 30, fMax = 8000): number[] {
  const nyquist = sampleRate / 2;
  const top = Math.min(fMax, nyquist);
  const mMin = hzToMel(fMin), mMax = hzToMel(top);
  const edges: number[] = [];
  for (let i = 0; i <= bands; i++) {
    const hz = melToHz(mMin + ((mMax - mMin) * i) / bands);
    edges.push(Math.min(fftBins - 1, Math.max(0, Math.round((hz / nyquist) * fftBins))));
  }
  for (let i = 1; i < edges.length; i++) if (edges[i]! <= edges[i - 1]!) edges[i] = Math.min(fftBins - 1, edges[i - 1]! + 1);
  return edges;
}

/** Average byte magnitudes (0-255) of an AnalyserNode frame into mel bands, returned as 0-1. */
export function toMelBands(freq: ArrayLike<number>, edges: number[]): Float32Array {
  const out = new Float32Array(edges.length - 1);
  for (let b = 0; b < out.length; b++) {
    const lo = edges[b]!, hi = Math.max(lo + 1, edges[b + 1]!);
    let sum = 0;
    for (let k = lo; k < hi; k++) sum += freq[k] ?? 0;
    out[b] = sum / (hi - lo) / 255;
  }
  return out;
}

export const RAMP = ' .:-=+*#%@';
export function glyphFor(v: number): string {
  const i = Math.min(RAMP.length - 1, Math.max(0, Math.floor(v * RAMP.length)));
  return RAMP[i]!;
}
