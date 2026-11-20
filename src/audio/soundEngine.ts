import { ANIMALS } from '../data/animals';
import { BIOMES } from '../data/biomes';
import { AnimalId, BiomeId, GameMode, NpcSpeciesId, WeatherId } from '../types/game';

export interface DynamicAudioEnv {
  distanceToWater: number;
  elevation: number;
  isSwimming: boolean;
  isDiving: boolean;
  speed: number;
  weather: WeatherId;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientMasterFilter: BiquadFilterNode | null = null;
  private sfxGain: GainNode | null = null;

  private bandLimitedSaw: PeriodicWave | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private riverClipBuffer: AudioBuffer | null = null;
  private windClipBuffer: AudioBuffer | null = null;
  private juniperClipBuffer: AudioBuffer | null = null;
  private desertSandBuffer: AudioBuffer | null = null;

  private ambientSource: AudioBufferSourceNode | null = null;
  private ambientLayer2: AudioBufferSourceNode | null = null;
  private ambientLayer3: AudioBufferSourceNode | null = null;
  private ambientLfo: OscillatorNode | null = null;

  private windFilterNode: BiquadFilterNode | null = null;
  private windGainNode: GainNode | null = null;
  private waterFilterNode: BiquadFilterNode | null = null;
  private waterGainNode: GainNode | null = null;
  private detailFilterNode: BiquadFilterNode | null = null;
  private detailGainNode: GainNode | null = null;

  private wildlifeAmbienceTimer: number | null = null;
  private musicTimer: number | null = null;
  private stepIndex = 0;

  private muted = false;
  private activeMode: GameMode = 'wild_life';
  private activeBiome: BiomeId = 'northern_mountains';
  private activeWeather: WeatherId = 'clear';
  private lastDivingState = false;
  private prewarmed = false;
  private playingMusic = false;

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      this.masterGain.gain.linearRampToValueAtTime(mute ? 0.0 : 0.78, now + 0.06);
    }
  }

  public prewarm(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.78;
      this.masterGain.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.22;
      this.musicGain.connect(this.masterGain);

      this.ambientMasterFilter = this.ctx.createBiquadFilter();
      this.ambientMasterFilter.type = 'lowpass';
      this.ambientMasterFilter.frequency.value = 16000;
      this.ambientMasterFilter.Q.value = 0.7;

      this.ambientGain = this.ctx.createGain();
      this.ambientGain.gain.value = 0.28;
      this.ambientMasterFilter.connect(this.ambientGain);
      this.ambientGain.connect(this.masterGain);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.64;
      this.sfxGain.connect(this.masterGain);

      this.bandLimitedSaw = this.createBandLimitedSawWave(this.ctx, 16);
      this.noiseBuffer = this.createNoiseBuffer(this.ctx, 3.0);
      this.riverClipBuffer = this.createRiverRapidsBuffer(this.ctx, 4.0);
      this.windClipBuffer = this.createWindGustBuffer(this.ctx, 4.5);
      this.juniperClipBuffer = this.createJuniperBoughBuffer(this.ctx, 4.5);
      this.desertSandBuffer = this.createDesertSandBuffer(this.ctx, 3.5);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    if (!this.prewarmed && this.ctx && this.masterGain && this.noiseBuffer && this.bandLimitedSaw) {
      this.prewarmed = true;
      const now = this.ctx.currentTime;
      const silentGain = this.ctx.createGain();
      silentGain.gain.value = 0.00001;
      silentGain.connect(this.masterGain);

      const osc = this.ctx.createOscillator();
      osc.setPeriodicWave(this.bandLimitedSaw);
      osc.frequency.value = 220;
      osc.connect(silentGain);
      osc.start(now);
      osc.stop(now + 0.02);

      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      noise.connect(silentGain);
      noise.start(now);
      noise.stop(now + 0.02);
    }
  }

  private createBandLimitedSawWave(ctx: AudioContext, harmonics: number): PeriodicWave {
    const real = new Float32Array(harmonics + 1);
    const imag = new Float32Array(harmonics + 1);
    for (let n = 1; n <= harmonics; n++) {
      const sigma = Math.sin((Math.PI * n) / (harmonics + 1)) / ((Math.PI * n) / (harmonics + 1));
      imag[n] = ((n % 2 === 0 ? -1 : 1) * (2 / (Math.PI * n))) * sigma;
    }
    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  private createNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.950 * b2 + white * 0.048;
      data[i] = (b0 + b1 + b2 + white * 0.18) * 0.45;
    }
    return buf;
  }

  // Synthesize natural flowing river, pebble eddies & surface bubbles
  private createRiverRapidsBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let lp = 0;
    let hpPrev = 0;
    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate;
      const white = Math.random() * 2 - 1;
      const swell = 0.62 + 0.38 * Math.sin(t * Math.PI * 1.4) * Math.cos(t * Math.PI * 0.5);
      lp = lp * 0.91 + white * 0.09;
      const rapid = white - hpPrev * 0.68;
      hpPrev = white;
      const bubble =
        Math.sin(t * 880 + Math.sin(i * 0.0022) * 9) * (Math.random() > 0.994 ? 0.42 : 0);
      data[i] = Math.max(-0.9, Math.min(0.9, (lp * 0.72 + rapid * 0.16 + bubble) * swell));
    }
    return buf;
  }

  // Synthesize alpine/plateau gusting wind texture
  private createWindGustBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let smooth1 = 0;
    let smooth2 = 0;
    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate;
      const gustEnv = 0.42 + 0.42 * Math.sin(t * Math.PI * 0.85) + 0.16 * Math.cos(t * Math.PI * 2.1);
      const w = Math.random() * 2 - 1;
      smooth1 = smooth1 * 0.985 + w * 0.015;
      smooth2 = smooth2 * 0.935 + w * 0.065;
      data[i] = Math.max(-0.9, Math.min(0.9, (smooth1 * 2.5 + smooth2 * 0.55) * gustEnv));
    }
    return buf;
  }

  // Synthesize dry juniper forest needles & resonant bough rustle
  private createJuniperBoughBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let bp = 0;
    let bpPrev = 0;
    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate;
      const gust = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(t * Math.PI * 1.1), 1.6);
      const w = Math.random() * 2 - 1;
      bp = bp * 0.84 + w * 0.16;
      const rustle = bp - bpPrev * 0.72;
      bpPrev = bp;
      const boughCreak = Math.sin(t * 210 + Math.sin(t * 5) * 3) * (Math.sin(t * 1.8) > 0.92 ? 0.08 : 0);
      data[i] = Math.max(-0.9, Math.min(0.9, (rustle * 1.35 + boughCreak) * gust));
    }
    return buf;
  }

  // Synthesize fine shifting sand hiss for Thar Desert dunes
  private createDesertSandBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let prev = 0;
    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate;
      const sweep = 0.3 + 0.7 * Math.abs(Math.sin(t * Math.PI * 0.65));
      const w = Math.random() * 2 - 1;
      const grain = (w - prev * 0.82) * 0.26;
      prev = w;
      data[i] = Math.max(-0.9, Math.min(0.9, grain * sweep));
    }
    return buf;
  }

  public startSessionAudio(mode: GameMode, biomeId: BiomeId): void {
    this.prewarm();
    this.activeMode = mode;
    this.activeBiome = biomeId;
    this.activeWeather = BIOMES[biomeId].defaultWeather;
    this.lastDivingState = false;
    this.startBiomeAmbience(biomeId);
    this.startModeMusic(mode);
  }

  public stopSessionAudio(): void {
    this.playingMusic = false;
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    if (this.wildlifeAmbienceTimer !== null) {
      window.clearInterval(this.wildlifeAmbienceTimer);
      this.wildlifeAmbienceTimer = null;
    }
    for (const node of [this.ambientSource, this.ambientLayer2, this.ambientLayer3, this.ambientLfo]) {
      if (!node) continue;
      try {
        node.stop();
      } catch {
        // ignore
      }
      node.disconnect();
    }
    this.ambientSource = null;
    this.ambientLayer2 = null;
    this.ambientLayer3 = null;
    this.ambientLfo = null;
    this.windFilterNode = null;
    this.windGainNode = null;
    this.waterFilterNode = null;
    this.waterGainNode = null;
    this.detailFilterNode = null;
    this.detailGainNode = null;
  }

  private startBiomeAmbience(biomeId: BiomeId): void {
    if (
      !this.ctx ||
      !this.ambientMasterFilter ||
      !this.windClipBuffer ||
      !this.riverClipBuffer ||
      !this.juniperClipBuffer ||
      !this.desertSandBuffer
    ) {
      return;
    }

    for (const node of [this.ambientSource, this.ambientLayer2, this.ambientLayer3, this.ambientLfo]) {
      if (!node) continue;
      try {
        node.stop();
      } catch {
        // ignore
      }
      node.disconnect();
    }
    if (this.wildlifeAmbienceTimer !== null) {
      window.clearInterval(this.wildlifeAmbienceTimer);
      this.wildlifeAmbienceTimer = null;
    }

    const now = this.ctx.currentTime;
    const profile = BIOMES[biomeId].ambientProfile;

    // Layer 1: Primary Wind Bed tailored per biome
    const windSrc = this.ctx.createBufferSource();
    windSrc.buffer = this.windClipBuffer;
    windSrc.loop = true;

    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value =
      profile === 'mountain'
        ? 580
        : profile === 'juniper'
          ? 490
          : profile === 'plateau'
            ? 430
            : profile === 'desert'
              ? 340
              : 390;
    windFilter.Q.value = profile === 'mountain' ? 1.55 : profile === 'juniper' ? 1.3 : 0.85;

    const windGain = this.ctx.createGain();
    windGain.gain.value = profile === 'river' ? 0.25 : 0.58;

    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = profile === 'plateau' ? 0.22 : profile === 'mountain' ? 0.26 : 0.16;
    const lfoDepth = this.ctx.createGain();
    lfoDepth.gain.value = profile === 'mountain' ? 240 : 165;
    lfo.connect(lfoDepth);
    lfoDepth.connect(windFilter.frequency);
    lfo.start(now);

    windSrc.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(this.ambientMasterFilter);
    windSrc.start(now);

    this.ambientSource = windSrc;
    this.ambientLfo = lfo;
    this.windFilterNode = windFilter;
    this.windGainNode = windGain;

    // Layer 2: Localized Flowing Water (Indus River always strong; dynamically swells near river/oasis in all biomes)
    const riverSrc = this.ctx.createBufferSource();
    riverSrc.buffer = this.riverClipBuffer;
    riverSrc.loop = true;

    const rFilter = this.ctx.createBiquadFilter();
    rFilter.type = 'bandpass';
    rFilter.frequency.value = profile === 'river' ? 840 : 650;
    rFilter.Q.value = 0.65;

    const rGain = this.ctx.createGain();
    rGain.gain.value = profile === 'river' ? 0.85 : profile === 'mountain' || profile === 'juniper' ? 0.24 : 0.04;

    riverSrc.connect(rFilter);
    rFilter.connect(rGain);
    rGain.connect(this.ambientMasterFilter);
    riverSrc.start(now);
    this.ambientLayer2 = riverSrc;
    this.waterFilterNode = rFilter;
    this.waterGainNode = rGain;

    // Layer 3: Biome Signature Texture (Juniper Forest boughs, Thar Dune Sand, or Mountain Ice/Meadow shimmer)
    const detailSrc = this.ctx.createBufferSource();
    detailSrc.buffer =
      profile === 'desert' ? this.desertSandBuffer : this.juniperClipBuffer;
    detailSrc.loop = true;

    const dFilter = this.ctx.createBiquadFilter();
    dFilter.type = 'bandpass';
    dFilter.frequency.value =
      profile === 'juniper'
        ? 1150
        : profile === 'desert'
          ? 2400
          : profile === 'plateau'
            ? 1450
            : 1750;
    dFilter.Q.value = profile === 'juniper' ? 1.6 : 0.9;

    const dGain = this.ctx.createGain();
    dGain.gain.value =
      profile === 'juniper'
        ? 0.42
        : profile === 'desert'
          ? 0.34
          : profile === 'river'
            ? 0.08
            : 0.22;

    detailSrc.connect(dFilter);
    dFilter.connect(dGain);
    dGain.connect(this.ambientMasterFilter);
    detailSrc.start(now);
    this.ambientLayer3 = detailSrc;
    this.detailFilterNode = dFilter;
    this.detailGainNode = dGain;

    this.ambientMasterFilter.frequency.setValueAtTime(16000, now);

    if (this.ambientGain) {
      this.ambientGain.gain.cancelScheduledValues(now);
      this.ambientGain.gain.setValueAtTime(0.001, now);
      this.ambientGain.gain.linearRampToValueAtTime(profile === 'river' ? 0.32 : 0.26, now + 0.65);
    }

    // Periodic biome-specific wildlife ambience chirps / cries / crickets
    this.wildlifeAmbienceTimer = window.setInterval(() => {
      if (!this.ctx || !this.ambientGain || this.ctx.state !== 'running' || this.muted) return;
      this.playAmbientWildlifeChirp(profile);
    }, 3400);
  }

  // Real-time spatial modulation: reacts to river/oasis distance, altitude, weather, speed & underwater diving
  public updateDynamicEnvironment(env: DynamicAudioEnv): void {
    if (!this.ctx || !this.ambientMasterFilter || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const profile = BIOMES[this.activeBiome].ambientProfile;
    this.activeWeather = env.weather;

    // 1. Sub-surface hydrophone muffling when diving underwater (Indus Dolphin)
    const targetCutoff = env.isDiving ? 290 : env.isSwimming ? 5400 : 16000;
    this.ambientMasterFilter.frequency.setTargetAtTime(targetCutoff, now, 0.14);
    if (env.isDiving !== this.lastDivingState) {
      this.lastDivingState = env.isDiving;
      if (env.isDiving) this.playUnderwaterBubbleBurst();
    }

    // 2. Water loudness swells as player approaches river or desert oasis
    if (this.waterGainNode && this.waterFilterNode) {
      const proximity = Math.max(0, 1 - env.distanceToWater / 48);
      const baseWater = profile === 'river' ? 0.58 : profile === 'mountain' ? 0.18 : 0.04;
      const swimBoost = env.isSwimming ? 0.45 : 0;
      const targetWaterGain = Math.min(1.15, baseWater + proximity * 0.52 + swimBoost);
      this.waterGainNode.gain.setTargetAtTime(targetWaterGain, now, 0.25);
      this.waterFilterNode.frequency.setTargetAtTime(
        env.isDiving ? 240 : env.isSwimming ? 940 : 620 + proximity * 320,
        now,
        0.2,
      );
    }

    // 3. Elevation & weather wind swell (Karakoram ridges howl higher; desert dust storms surge)
    if (this.windGainNode && this.windFilterNode) {
      const elevFactor = Math.max(0, Math.min(1, env.elevation / 16));
      const weatherBoost =
        env.weather === 'dust' || env.weather === 'snow' || env.weather === 'rain' ? 0.24 : 0;
      const baseWind = profile === 'river' ? 0.22 : 0.46;
      this.windGainNode.gain.setTargetAtTime(
        Math.min(0.95, baseWind + elevFactor * 0.34 + weatherBoost),
        now,
        0.3,
      );
      const baseHz =
        profile === 'mountain' ? 540 : profile === 'juniper' ? 480 : profile === 'desert' ? 350 : 420;
      this.windFilterNode.frequency.setTargetAtTime(baseHz + elevFactor * 260, now, 0.35);
    }

    // 4. Forest bough rustle / sand sizzle intensity reacts to movement speed
    if (this.detailGainNode) {
      const moveFactor = Math.min(1, env.speed / 12);
      const baseDetail =
        profile === 'juniper' ? 0.34 : profile === 'desert' ? 0.28 : profile === 'plateau' ? 0.22 : 0.12;
      this.detailGainNode.gain.setTargetAtTime(
        env.isDiving ? 0.04 : Math.min(0.75, baseDetail + moveFactor * 0.22),
        now,
        0.22,
      );
    }
  }

  private playUnderwaterBubbleBurst(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const t = now + i * 0.065;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(240 + i * 75, t);
      osc.frequency.exponentialRampToValueAtTime(520 + i * 95, t + 0.055);
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(0.14, t + 0.01);
      env.gain.linearRampToValueAtTime(0.0001, t + 0.06);
      osc.connect(env);
      env.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.07);
    }
  }

  private playAmbientWildlifeChirp(profile: string): void {
    if (!this.ctx || !this.ambientMasterFilter || this.lastDivingState) return;
    const now = this.ctx.currentTime;
    const count = profile === 'juniper' || profile === 'plateau' ? 3 : 2;
    const base =
      profile === 'desert'
        ? 3250
        : profile === 'mountain'
          ? 2450
          : profile === 'river'
            ? 1920
            : profile === 'juniper'
              ? 2720
              : 2560;

    for (let i = 0; i < count; i++) {
      const t = now + i * 0.14;
      const osc = this.ctx.createOscillator();
      osc.type = profile === 'desert' ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(base + i * 190, t);
      osc.frequency.exponentialRampToValueAtTime(base * 1.18, t + 0.055);
      osc.frequency.exponentialRampToValueAtTime(base * 0.92, t + 0.11);

      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(0.055, t + 0.015);
      env.gain.linearRampToValueAtTime(0.0001, t + 0.12);

      osc.connect(env);
      env.connect(this.ambientMasterFilter);
      osc.start(t);
      osc.stop(t + 0.13);
    }
  }

  private startModeMusic(mode: GameMode): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.playingMusic = true;
    this.stepIndex = 0;

    const intervalMs = mode === 'ranger_patrol' ? 320 : mode === 'photo_safari' ? 520 : 440;
    this.playMusicStep();
    this.musicTimer = window.setInterval(() => {
      if (!this.playingMusic) return;
      this.playMusicStep();
    }, intervalMs);
  }

  private playMusicStep(): void {
    if (!this.ctx || !this.musicGain || this.ctx.state !== 'running') return;
    const step = this.stepIndex++;

    if (this.activeMode === 'wild_life') {
      const notes = [196, 220, 261.6, 293.7, 329.6, 392, 329.6, 293.7];
      const freq = notes[step % notes.length];
      this.playSoftTone(freq, 'sine', 0.42, 0.09, this.musicGain, 0.05, 0.28);
      if (step % 4 === 0) {
        this.playBandLimitedNote(notes[0] * 0.5, 0.85, 0.055, this.musicGain);
      }
    } else if (this.activeMode === 'ranger_patrol') {
      const bass = [146.8, 146.8, 174.6, 196, 146.8, 164.8, 174.6, 130.8];
      const lead = [293.7, 0, 349.2, 392, 0, 440, 392, 349.2];
      this.playBandLimitedNote(bass[step % bass.length], 0.24, 0.085, this.musicGain);
      const leadFreq = lead[step % lead.length];
      if (leadFreq > 0) {
        this.playSoftTone(leadFreq, 'triangle', 0.22, 0.075, this.musicGain, 0.015, 0.16);
      }
    } else {
      const melody = [261.6, 329.6, 392, 493.9, 523.3, 392, 329.6, 293.7];
      const f = melody[step % melody.length];
      this.playSoftTone(f, 'sine', 0.36, 0.08, this.musicGain, 0.02, 0.25);
      if (step % 4 === 0) {
        this.playSoftTone(130.8, 'triangle', 0.95, 0.06, this.musicGain, 0.08, 0.45);
      }
    }
  }

  private playSoftTone(
    freq: number,
    type: OscillatorType,
    duration: number,
    peakGain: number,
    dest: AudioNode,
    fadeIn = 0.015,
    fadeOut = 0.08,
  ): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(peakGain, now + fadeIn);
    env.gain.setValueAtTime(peakGain, Math.max(now + fadeIn, now + duration - fadeOut));
    env.gain.linearRampToValueAtTime(0.0001, now + duration);

    osc.connect(env);
    env.connect(dest);
    osc.start(now);
    osc.stop(now + duration + 0.015);
  }

  private playBandLimitedNote(
    freq: number,
    duration: number,
    peakGain: number,
    dest: AudioNode,
  ): void {
    if (!this.ctx || !this.bandLimitedSaw) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.setPeriodicWave(this.bandLimitedSaw);
    osc.frequency.setValueAtTime(freq, now);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 4.5, now);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(peakGain, now + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(filter);
    filter.connect(env);
    env.connect(dest);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  // Realistic vocal-tract formant animal sound synthesis
  public playAnimalCall(animalId: AnimalId, mode: GameMode): void {
    this.prewarm();
    if (!this.ctx || !this.sfxGain) return;
    const cfg = ANIMALS[animalId];
    const pitchMult = mode === 'ranger_patrol' ? 1.1 : mode === 'photo_safari' ? 0.94 : 1.0;
    const volMult = mode === 'photo_safari' ? 0.72 : mode === 'ranger_patrol' ? 0.92 : 1.0;
    this.playCallByType(cfg.callType, cfg.callPitchHz * pitchMult, volMult);
  }

  // Species-specific ability & action trigger sounds (Markhor hoof-spring, Leopard snarl-pounce, Bear slam, Dolphin sonar)
  public playSpeciesActionTrigger(
    animalId: AnimalId,
    trigger: 'jump' | 'pounce' | 'dive' | 'horn_counter' | 'threat_stunned',
  ): void {
    this.prewarm();
    if (!this.ctx || !this.sfxGain || this.muted) return;

    if (animalId === 'markhor' && trigger === 'jump') {
      // Sharp mountain hoof-clatter on rock + upward spring
      this.playSoftTone(190, 'triangle', 0.09, 0.24, this.sfxGain, 0.005, 0.04);
      window.setTimeout(() => {
        if (this.sfxGain) this.playSoftTone(330, 'triangle', 0.14, 0.2, this.sfxGain, 0.01, 0.08);
      }, 45);
      return;
    }

    if (animalId === 'snow_leopard' && trigger === 'pounce') {
      // Explosive feline snarl-rush
      this.playCallByType('chuff', 210, 0.65);
      this.playBandLimitedNote(165, 0.16, 0.24, this.sfxGain);
      return;
    }

    if (animalId === 'brown_bear' && (trigger === 'pounce' || trigger === 'threat_stunned')) {
      // Heavy Bear ground slam shockwave + deep roar
      this.playBandLimitedNote(72, 0.34, 0.38, this.sfxGain);
      this.playCallByType('rumble', 98, 0.72);
      return;
    }

    if (animalId === 'indus_dolphin' && trigger === 'jump') {
      // River breach splash + dolphin whistle
      this.playSfx('splash');
      this.playCallByType('whistle_click', 840, 0.68);
      return;
    }

    if (animalId === 'indus_dolphin' && trigger === 'dive') {
      this.playUnderwaterBubbleBurst();
      this.playSoftTone(220, 'sine', 0.24, 0.22, this.sfxGain, 0.02, 0.14);
      return;
    }

    this.playSfx(trigger);
  }

  // Distinct procedural voice for every wild species in Pakistan (playable & NPC)
  public playSpeciesSound(speciesId: AnimalId | NpcSpeciesId, distance = 14): void {
    this.prewarm();
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const distAtten = Math.max(0.24, Math.min(0.88, 1 - distance / 54));

    switch (speciesId) {
      case 'snow_leopard':
      case 'snow_leopard_npc':
        this.playCallByType('chuff', 185, distAtten);
        break;
      case 'markhor':
      case 'markhor_npc':
        this.playCallByType('bleat', 310, distAtten);
        break;
      case 'brown_bear':
      case 'brown_bear_npc':
        this.playCallByType('rumble', 110, distAtten);
        break;
      case 'indus_dolphin':
      case 'indus_dolphin_npc':
        this.playCallByType('whistle_click', 780, distAtten);
        break;
      case 'ranger':
        this.playCallByType('radio_whistle', 520, distAtten);
        break;
      case 'ibex':
        this.playIbexSnortBleat(distAtten);
        break;
      case 'marmot':
        this.playMarmotAlarmWhistle(distAtten);
        break;
      case 'gazelle':
        this.playGazelleBark(distAtten);
        break;
      case 'river_fish':
        this.playMahseerPlop(distAtten);
        break;
    }
  }

  private playCallByType(
    callType: 'chuff' | 'bleat' | 'rumble' | 'whistle_click' | 'radio_whistle',
    baseHz: number,
    volMult: number,
  ): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    if (callType === 'chuff') {
      const carrier = this.ctx.createOscillator();
      if (this.bandLimitedSaw) carrier.setPeriodicWave(this.bandLimitedSaw);
      carrier.frequency.setValueAtTime(baseHz * 1.15, now);
      carrier.frequency.exponentialRampToValueAtTime(baseHz * 0.62, now + 0.56);

      const f1 = this.ctx.createBiquadFilter();
      f1.type = 'bandpass';
      f1.frequency.setValueAtTime(420, now);
      f1.Q.value = 2.6;

      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(0.34 * volMult, now + 0.05);
      env.gain.linearRampToValueAtTime(0.0001, now + 0.58);

      carrier.connect(f1);
      f1.connect(env);
      env.connect(this.sfxGain);
      carrier.start(now);
      carrier.stop(now + 0.6);

      if (this.noiseBuffer) {
        const breath = this.ctx.createBufferSource();
        breath.buffer = this.noiseBuffer;
        const bFilter = this.ctx.createBiquadFilter();
        bFilter.type = 'bandpass';
        bFilter.frequency.setValueAtTime(1150, now);
        bFilter.Q.value = 1.6;
        const bEnv = this.ctx.createGain();
        bEnv.gain.setValueAtTime(0.0001, now);
        bEnv.gain.linearRampToValueAtTime(0.25 * volMult, now + 0.03);
        bEnv.gain.linearRampToValueAtTime(0.0001, now + 0.28);
        breath.connect(bFilter);
        bFilter.connect(bEnv);
        bEnv.connect(this.sfxGain);
        breath.start(now);
        breath.stop(now + 0.3);
      }
    } else if (callType === 'bleat') {
      const osc = this.ctx.createOscillator();
      if (this.bandLimitedSaw) osc.setPeriodicWave(this.bandLimitedSaw);
      osc.frequency.setValueAtTime(baseHz * 1.06, now);
      osc.frequency.linearRampToValueAtTime(baseHz * 0.85, now + 0.44);

      const vib = this.ctx.createOscillator();
      vib.frequency.value = 22;
      const vibGain = this.ctx.createGain();
      vibGain.gain.value = 18;
      vib.connect(vibGain);
      vibGain.connect(osc.frequency);
      vib.start(now);
      vib.stop(now + 0.48);

      const f1 = this.ctx.createBiquadFilter();
      f1.type = 'bandpass';
      f1.frequency.value = 640;
      f1.Q.value = 3.2;

      const f2 = this.ctx.createBiquadFilter();
      f2.type = 'bandpass';
      f2.frequency.value = 1520;
      f2.Q.value = 4.0;

      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(0.33 * volMult, now + 0.03);
      env.gain.setValueAtTime(0.29 * volMult, now + 0.25);
      env.gain.linearRampToValueAtTime(0.0001, now + 0.46);

      osc.connect(f1);
      osc.connect(f2);
      f1.connect(env);
      f2.connect(env);
      env.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.48);
    } else if (callType === 'rumble') {
      const osc = this.ctx.createOscillator();
      if (this.bandLimitedSaw) osc.setPeriodicWave(this.bandLimitedSaw);
      osc.frequency.setValueAtTime(baseHz, now);
      osc.frequency.exponentialRampToValueAtTime(baseHz * 0.72, now + 0.75);

      const sub = this.ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(baseHz * 0.5, now);
      sub.frequency.exponentialRampToValueAtTime(baseHz * 0.4, now + 0.75);

      const formant = this.ctx.createBiquadFilter();
      formant.type = 'bandpass';
      formant.frequency.setValueAtTime(240, now);
      formant.frequency.linearRampToValueAtTime(175, now + 0.72);
      formant.Q.value = 1.8;

      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(0.42 * volMult, now + 0.07);
      env.gain.linearRampToValueAtTime(0.0001, now + 0.78);

      osc.connect(formant);
      sub.connect(env);
      formant.connect(env);
      env.connect(this.sfxGain);
      osc.start(now);
      sub.start(now);
      osc.stop(now + 0.8);
      sub.stop(now + 0.8);
    } else if (callType === 'whistle_click') {
      for (let i = 0; i < 6; i++) {
        const t = now + i * 0.042;
        const clickOsc = this.ctx.createOscillator();
        clickOsc.type = 'sine';
        clickOsc.frequency.setValueAtTime(2100 + i * 240, t);
        clickOsc.frequency.exponentialRampToValueAtTime(1250, t + 0.022);
        const cEnv = this.ctx.createGain();
        cEnv.gain.setValueAtTime(0.0001, t);
        cEnv.gain.linearRampToValueAtTime(0.22 * volMult, t + 0.004);
        cEnv.gain.linearRampToValueAtTime(0.0001, t + 0.024);
        clickOsc.connect(cEnv);
        cEnv.connect(this.sfxGain);
        clickOsc.start(t);
        clickOsc.stop(t + 0.028);
      }

      const wStart = now + 0.26;
      const wOsc = this.ctx.createOscillator();
      wOsc.type = 'sine';
      wOsc.frequency.setValueAtTime(baseHz * 0.9, wStart);
      wOsc.frequency.exponentialRampToValueAtTime(baseHz * 1.45, wStart + 0.16);
      wOsc.frequency.exponentialRampToValueAtTime(baseHz * 1.05, wStart + 0.34);
      const wEnv = this.ctx.createGain();
      wEnv.gain.setValueAtTime(0.0001, wStart);
      wEnv.gain.linearRampToValueAtTime(0.2 * volMult, wStart + 0.03);
      wEnv.gain.linearRampToValueAtTime(0.0001, wStart + 0.36);
      wOsc.connect(wEnv);
      wEnv.connect(this.sfxGain);
      wOsc.start(wStart);
      wOsc.stop(wStart + 0.38);
    } else {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseHz, now);
      const trill = this.ctx.createOscillator();
      trill.frequency.value = 34;
      const tGain = this.ctx.createGain();
      tGain.gain.value = 55;
      trill.connect(tGain);
      tGain.connect(osc.frequency);

      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(0.24 * volMult, now + 0.015);
      env.gain.linearRampToValueAtTime(0.0001, now + 0.24);
      osc.connect(env);
      env.connect(this.sfxGain);
      osc.start(now);
      trill.start(now);
      osc.stop(now + 0.26);
      trill.stop(now + 0.26);
    }
  }

  private playIbexSnortBleat(volMult: number): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const t = now + i * 0.16;
      const osc = this.ctx.createOscillator();
      if (this.bandLimitedSaw) osc.setPeriodicWave(this.bandLimitedSaw);
      osc.frequency.setValueAtTime(420 - i * 45, t);
      osc.frequency.exponentialRampToValueAtTime(310, t + 0.12);
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1120;
      f.Q.value = 2.8;
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(0.26 * volMult, t + 0.015);
      env.gain.linearRampToValueAtTime(0.0001, t + 0.13);
      osc.connect(f);
      f.connect(env);
      env.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.14);
    }
  }

  private playMarmotAlarmWhistle(volMult: number): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const t = now + i * 0.18;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(3400, t);
      osc.frequency.exponentialRampToValueAtTime(2550, t + 0.13);
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(0.2 * volMult, t + 0.012);
      env.gain.linearRampToValueAtTime(0.0001, t + 0.14);
      osc.connect(env);
      env.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.15);
    }
  }

  private playGazelleBark(volMult: number): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    if (this.noiseBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1650, now);
      filter.Q.value = 2.1;
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(0.28 * volMult, now + 0.012);
      env.gain.linearRampToValueAtTime(0.0001, now + 0.11);
      src.connect(filter);
      filter.connect(env);
      env.connect(this.sfxGain);
      src.start(now);
      src.stop(now + 0.12);
    }
    this.playSoftTone(890, 'triangle', 0.1, 0.18 * volMult, this.sfxGain, 0.008, 0.05);
  }

  private playMahseerPlop(volMult: number): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(760, now + 0.09);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(0.22 * volMult, now + 0.012);
    env.gain.linearRampToValueAtTime(0.0001, now + 0.11);
    osc.connect(env);
    env.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  public playSfx(
    kind:
      | 'orb'
      | 'hunt'
      | 'forage'
      | 'dart'
      | 'arrest'
      | 'rescue'
      | 'snare'
      | 'shutter'
      | 'tool_switch'
      | 'scout_ping'
      | 'splash'
      | 'jump'
      | 'pounce'
      | 'dive'
      | 'jaal_clear'
      | 'danger'
      | 'hurt'
      | 'horn_counter'
      | 'threat_stunned'
      | 'growth'
      | 'victory',
  ): void {
    this.prewarm();
    if (!this.ctx || !this.sfxGain) return;

    if (kind === 'tool_switch') {
      this.playSoftTone(540, 'triangle', 0.06, 0.14, this.sfxGain, 0.005, 0.03);
    } else if (kind === 'scout_ping') {
      this.playSoftTone(740, 'sine', 0.09, 0.18, this.sfxGain, 0.008, 0.04);
      window.setTimeout(() => {
        if (this.sfxGain) this.playSoftTone(987.77, 'sine', 0.14, 0.18, this.sfxGain, 0.008, 0.07);
      }, 65);
    } else if (kind === 'orb' || kind === 'jaal_clear') {
      this.playSoftTone(523.25, 'sine', 0.16, 0.25, this.sfxGain, 0.015, 0.08);
      window.setTimeout(() => {
        if (this.sfxGain) this.playSoftTone(659.25, 'sine', 0.22, 0.25, this.sfxGain, 0.015, 0.1);
      }, 90);
    } else if (kind === 'growth') {
      [392, 493.9, 587.3].forEach((f, idx) => {
        window.setTimeout(() => {
          if (this.sfxGain) this.playSoftTone(f, 'triangle', 0.28, 0.22, this.sfxGain, 0.015, 0.14);
        }, idx * 80);
      });
    } else if (kind === 'hurt') {
      this.playBandLimitedNote(110, 0.2, 0.34, this.sfxGain);
      this.playSoftTone(82, 'sine', 0.22, 0.3, this.sfxGain, 0.008, 0.12);
    } else if (kind === 'horn_counter') {
      this.playBandLimitedNote(220, 0.2, 0.32, this.sfxGain);
      this.playSoftTone(440, 'triangle', 0.18, 0.24, this.sfxGain, 0.01, 0.1);
    } else if (kind === 'jump') {
      this.playSoftTone(240, 'triangle', 0.18, 0.2, this.sfxGain, 0.015, 0.1);
    } else if (kind === 'pounce' || kind === 'threat_stunned') {
      this.playBandLimitedNote(190, 0.16, 0.25, this.sfxGain);
    } else if (kind === 'dive') {
      this.playSoftTone(180, 'sine', 0.22, 0.2, this.sfxGain, 0.02, 0.12);
    } else if (kind === 'danger') {
      this.playBandLimitedNote(135, 0.22, 0.28, this.sfxGain);
    } else if (kind === 'hunt') {
      this.playBandLimitedNote(160, 0.18, 0.28, this.sfxGain);
      this.playSoftTone(320, 'triangle', 0.14, 0.22, this.sfxGain, 0.01, 0.06);
    } else if (kind === 'forage') {
      this.playSoftTone(440, 'triangle', 0.12, 0.18, this.sfxGain, 0.01, 0.06);
    } else if (kind === 'dart') {
      this.playSoftTone(780, 'sine', 0.09, 0.22, this.sfxGain, 0.008, 0.04);
    } else if (kind === 'arrest' || kind === 'rescue') {
      this.playSoftTone(392, 'triangle', 0.15, 0.24, this.sfxGain, 0.015, 0.07);
      window.setTimeout(() => {
        if (this.sfxGain) this.playSoftTone(587.3, 'triangle', 0.24, 0.24, this.sfxGain, 0.015, 0.1);
      }, 110);
    } else if (kind === 'snare') {
      this.playSoftTone(620, 'sine', 0.1, 0.2, this.sfxGain, 0.01, 0.05);
    } else if (kind === 'shutter') {
      if (this.noiseBuffer && this.ctx) {
        const now = this.ctx.currentTime;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 1800;
        const env = this.ctx.createGain();
        env.gain.setValueAtTime(0.001, now);
        env.gain.linearRampToValueAtTime(0.32, now + 0.008);
        env.gain.linearRampToValueAtTime(0.0001, now + 0.07);
        src.connect(filter);
        filter.connect(env);
        env.connect(this.sfxGain);
        src.start(now);
        src.stop(now + 0.08);
      }
      this.playSoftTone(880, 'sine', 0.12, 0.16, this.sfxGain, 0.01, 0.06);
    } else if (kind === 'splash') {
      if (this.noiseBuffer && this.ctx) {
        const now = this.ctx.currentTime;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 950;
        const env = this.ctx.createGain();
        env.gain.setValueAtTime(0.001, now);
        env.gain.linearRampToValueAtTime(0.24, now + 0.02);
        env.gain.linearRampToValueAtTime(0.0001, now + 0.25);
        src.connect(filter);
        filter.connect(env);
        env.connect(this.sfxGain);
        src.start(now);
        src.stop(now + 0.27);
      }
    } else if (kind === 'victory') {
      const fanfare = [392, 493.9, 587.3, 784];
      fanfare.forEach((f, idx) => {
        window.setTimeout(() => {
          if (this.sfxGain) this.playSoftTone(f, 'triangle', 0.38, 0.25, this.sfxGain, 0.02, 0.18);
        }, idx * 120);
      });
    }
  }
}

export const soundEngine = new SoundEngine();
