import { clamp } from './math';

export class BattleAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private ambient?: GainNode;
  private volume = 0.65;

  async start(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.context.destination);
      this.ambient = this.context.createGain();
      this.ambient.gain.value = 0.1;
      this.ambient.connect(this.master);
      this.startWind();
    }
    await this.context.resume();
  }

  setVolume(value: number): void {
    this.volume = clamp(value, 0, 1);
    if (this.context && this.master) this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.04);
  }

  sword(): void {
    this.noise(0.12, 0.28, 0.3, 1100);
    this.tone(150, 72, 0.11, 'sawtooth', 0.12);
  }

  hit(heavy = false): void {
    this.noise(heavy ? 0.28 : 0.16, heavy ? 0.7 : 0.42, 0.18, heavy ? 230 : 520);
    this.tone(heavy ? 60 : 95, 38, heavy ? 0.26 : 0.14, 'square', heavy ? 0.22 : 0.12);
  }

  block(): void {
    this.tone(630, 140, 0.13, 'triangle', 0.16);
    this.noise(0.08, 0.18, 0.06, 2100);
  }

  bow(): void {
    this.tone(240, 70, 0.18, 'sawtooth', 0.05);
  }

  explosion(): void {
    this.noise(0.8, 1.6, 0.38, 180);
    this.tone(58, 25, 0.75, 'sine', 0.24);
  }

  ram(): void {
    this.tone(72, 35, 0.55, 'triangle', 0.32);
    this.noise(0.3, 0.8, 0.22, 250);
  }

  horn(): void {
    this.tone(196, 146, 1.5, 'sawtooth', 0.08, 0.08);
    window.setTimeout(() => this.tone(220, 164, 1.25, 'sawtooth', 0.07, 0.05), 280);
  }

  victory(): void {
    [130.81, 164.81, 196, 261.63].forEach((frequency, index) => {
      window.setTimeout(() => this.tone(frequency, frequency, 1.7, 'triangle', 0.08, 0.04), index * 180);
    });
  }

  private startWind(): void {
    const play = () => {
      if (!this.context || !this.ambient) return;
      const buffer = this.createNoiseBuffer(2.8);
      const source = this.context.createBufferSource();
      const filter = this.context.createBiquadFilter();
      source.buffer = buffer;
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      source.connect(filter).connect(this.ambient);
      source.start();
      window.setTimeout(play, 2450);
    };
    play();
  }

  private tone(startFrequency: number, endFrequency: number, duration: number, type: OscillatorType, gainValue: number, attack = 0.005): void {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  private noise(duration: number, gainValue: number, attack: number, frequency: number): void {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.createNoiseBuffer(duration);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(frequency, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, frequency * 0.25), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + Math.min(attack, duration * 0.4));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
  }

  private createNoiseBuffer(duration: number): AudioBuffer {
    if (!this.context) throw new Error('Audio context is not initialized');
    const length = Math.ceil(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const channel = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.82 + white * 0.18;
      channel[index] = previous;
    }
    return buffer;
  }
}
