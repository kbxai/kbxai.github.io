// Spectrogram lab: audio -> AnalyserNode -> mel bands -> glowing glyph waterfall (2D canvas).
// Sources: a synthesized "noisy mashup" (chords + drums + adjustable noise), a local file, or the microphone.
// Nothing is recorded or uploaded.
import { melBinEdges, toMelBands, glyphFor } from './mel';

const BANDS = 48;

export function initLab(): void {
  const canvas = document.getElementById('spec') as HTMLCanvasElement | null;
  const status = document.getElementById('lab-status');
  const btnSynth = document.getElementById('src-synth') as HTMLButtonElement | null;
  const btnMic = document.getElementById('src-mic') as HTMLButtonElement | null;
  const btnStop = document.getElementById('src-stop') as HTMLButtonElement | null;
  const file = document.getElementById('src-file') as HTMLInputElement | null;
  const noise = document.getElementById('noise') as HTMLInputElement | null;
  const noiseOut = document.getElementById('noise-out');
  if (!canvas || !status || !btnSynth || !btnMic || !btnStop || !file || !noise) return;
  document.getElementById('lab-controls')?.removeAttribute('hidden');

  const g = canvas.getContext('2d')!;
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let noiseGain: GainNode | null = null;
  let stopSource: (() => void) | null = null;
  let raf = 0;
  let cellW = 8, cellH = 12, cols = 0;
  let edges: number[] = [];
  let freq: Uint8Array<ArrayBuffer> = new Uint8Array(0);

  const setStatus = (s: string) => (status.textContent = s);

  const sizeCanvas = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w;
    canvas.height = h;
    cellH = h / BANDS;
    cellW = cellH * 0.62;
    cols = Math.floor(w / cellW);
    g.font = `700 ${Math.floor(cellH * 0.95)}px "JetBrains Mono", monospace`;
    g.textBaseline = 'top';
    g.fillStyle = '#13111b';
    g.fillRect(0, 0, w, h);
  };
  sizeCanvas();
  new ResizeObserver(sizeCanvas).observe(canvas);

  const ensureCtx = async () => {
    if (!ctx) {
      ctx = new AudioContext();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.6;
      analyser.minDecibels = -95;
      analyser.maxDecibels = -20;
      edges = melBinEdges(BANDS, analyser.frequencyBinCount, ctx.sampleRate);
      freq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    }
    if (ctx.state === 'suspended') await ctx.resume();
    return { ctx: ctx!, analyser: analyser! };
  };

  const draw = () => {
    raf = requestAnimationFrame(draw);
    if (!analyser) return;
    analyser.getByteFrequencyData(freq);
    const bands = toMelBands(freq, edges);
    // shift waterfall left by one column, draw the newest column at the right edge
    g.drawImage(canvas, -Math.ceil(cellW), 0);
    const x = (cols - 1) * cellW;
    g.fillStyle = '#13111b';
    g.fillRect(x - 1, 0, cellW + 2, canvas.height);
    for (let b = 0; b < BANDS; b++) {
      const v = Math.min(1, bands[b]! * 1.15);
      if (v < 0.06) continue;
      const y = canvas.height - (b + 1) * cellH; // low frequencies at the bottom
      g.fillStyle = v > 0.82 ? '#f6a347' : '#efe9df';
      g.shadowColor = g.fillStyle;
      g.shadowBlur = v > 0.5 ? 6 : 0;
      g.globalAlpha = 0.35 + 0.65 * v;
      g.fillText(glyphFor(v), x, y);
    }
    g.globalAlpha = 1;
    g.shadowBlur = 0;
  };

  const stop = () => {
    stopSource?.();
    stopSource = null;
    cancelAnimationFrame(raf);
    raf = 0;
    btnStop.disabled = true;
    setStatus('stopped');
  };

  const begin = (label: string) => {
    btnStop.disabled = false;
    if (!raf) raf = requestAnimationFrame(draw);
    setStatus(`playing: ${label}`);
  };

  btnSynth.addEventListener('click', async () => {
    stop();
    const { ctx, analyser } = await ensureCtx();
    const out = ctx.createGain();
    out.gain.value = 0.18;
    out.connect(analyser);
    analyser.connect(ctx.destination);
    // chord progression (Am - F - C - G), kick and hi-hat, plus white noise like the ESC-50 injection idea
    const chords = [[220, 261.6, 329.6], [174.6, 220, 261.6], [261.6, 329.6, 392], [196, 246.9, 293.7]];
    const oscs = [0, 1, 2].map(() => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1800;
      o.connect(f).connect(out);
      o.start();
      return o;
    });
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    noiseSrc.loop = true;
    noiseGain = ctx.createGain();
    noiseGain.gain.value = Number(noise.value) / 100;
    noiseSrc.connect(noiseGain).connect(out);
    noiseSrc.start();
    let step = 0;
    const beat = 0.42;
    const tick = () => {
      const t = ctx.currentTime;
      const c = chords[Math.floor(step / 8) % chords.length]!;
      oscs.forEach((o, i) => o.frequency.setValueAtTime(c[i]!, t));
      if (step % 2 === 0) {
        const k = ctx.createOscillator();
        const kg = ctx.createGain();
        k.frequency.setValueAtTime(120, t);
        k.frequency.exponentialRampToValueAtTime(40, t + 0.15);
        kg.gain.setValueAtTime(1.2, t);
        kg.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        k.connect(kg).connect(out);
        k.start(t);
        k.stop(t + 0.22);
      }
      const hat = ctx.createBufferSource();
      hat.buffer = noiseBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7000;
      const hg = ctx.createGain();
      hg.gain.setValueAtTime(0.35, t);
      hg.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      hat.connect(hp).connect(hg).connect(out);
      hat.start(t, Math.random());
      hat.stop(t + 0.06);
      step++;
    };
    tick();
    const id = window.setInterval(tick, (beat / 2) * 1000);
    stopSource = () => {
      clearInterval(id);
      oscs.forEach((o) => o.stop());
      noiseSrc.stop();
      out.disconnect();
      analyser.disconnect();
      noiseGain = null;
    };
    begin('synthesized noisy mashup (Web Audio, no file)');
  });

  noise.addEventListener('input', () => {
    if (noiseOut) noiseOut.textContent = `${noise.value}%`;
    if (noiseGain) noiseGain.gain.value = Number(noise.value) / 100;
  });

  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    stop();
    const { ctx, analyser } = await ensureCtx();
    try {
      const buf = await ctx.decodeAudioData(await f.arrayBuffer());
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      src.start();
      src.onended = () => stop();
      stopSource = () => {
        try { src.stop(); } catch { /* already stopped */ }
        src.disconnect();
        analyser.disconnect();
      };
      begin(`your file "${f.name}" (decoded locally, never uploaded)`);
    } catch {
      setStatus('could not decode that file; try an mp3, wav or ogg');
    }
  });

  btnMic.addEventListener('click', async () => {
    stop();
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('microphone is not available in this browser');
      return;
    }
    try {
      const { ctx, analyser } = await ensureCtx();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const src = ctx.createMediaStreamSource(stream);
      src.connect(analyser); // not connected to speakers: no feedback
      stopSource = () => {
        stream.getTracks().forEach((t) => t.stop());
        src.disconnect();
      };
      begin('microphone (processed in your browser only, nothing recorded)');
    } catch {
      setStatus('microphone permission was denied');
    }
  });

  btnStop.addEventListener('click', stop);
  window.addEventListener('pagehide', () => {
    stop();
    void ctx?.close();
  });
}
