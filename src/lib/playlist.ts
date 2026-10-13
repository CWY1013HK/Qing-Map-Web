import { AUDIO } from '../config'

type Phase = 'idle' | 'intro' | 'entry' | 'transition' | 'ambient'
/** Cue currently playing (or last requested) in the ambient Mist ↔ Jing loop. */
type AmbientCue = 'mist' | 'jing'

type PlayOpts = {
  loop: boolean
  fadeIn: boolean
  volume?: number
  startAt?: number
}

/**
 * Map soundtrack controller.
 *
 * 1. Intro: Mist Sheng (loops while the seal screen is up)
 * 2. Seal click: Chao Tian Zi (entry, once) — overlaps Mist fade; starts at 1s (drum)
 * 3. Then Jing Diao once (transition)
 * 4. Then alternate Mist Sheng ↔ Jing Diao
 */
class MapPlaylist {
  private audio = new Audio()
  private phase: Phase = 'idle'
  private ambientCue: AmbientCue = 'mist'
  private fadeGen = 0
  private unlockBound = false
  private started = false
  private muted = false
  /** Soften soundtrack under tour voiceovers without stopping the timeline. */
  private ducked = false
  private readonly duckFactor = 0.28
  private readonly unlockHandler = (e: PointerEvent) => this.onUnlockPointer(e)
  private readonly onAudioEnded = () => this.onEnded()

  constructor() {
    this.bindAudio(this.audio)
  }

  isMuted(): boolean {
    return this.muted
  }

  /** Silence or restore soundtrack without stopping the playlist timeline. */
  setMuted(muted: boolean): void {
    this.muted = muted
    this.audio.muted = muted
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted)
    return this.muted
  }

  /** Lower (or restore) soundtrack volume while a tour narrates. */
  setDucked(ducked: boolean): void {
    this.ducked = ducked
    this.applyDuckToCurrent()
  }

  private applyDuckToCurrent(): void {
    if (this.muted || this.audio.paused) return
    const base = AUDIO.volume
    const target = this.ducked ? base * this.duckFactor : base
    // Don't fight Chao Tian Zi entry spike — only duck ambient levels.
    if (this.phase === 'entry') return
    this.audio.volume = target
  }

  private bindAudio(el: HTMLAudioElement): void {
    el.preload = 'auto'
    el.muted = this.muted
    el.addEventListener('ended', this.onAudioEnded)
  }

  /** Begin Mist Sheng on the intro curtain (autoplay when the browser allows). */
  startIntro(): void {
    if (this.phase !== 'idle' && this.phase !== 'intro') return
    this.phase = 'intro'
    this.warm(AUDIO.chaoTianZi)
    this.warm(AUDIO.jingDiao)
    void this.play(AUDIO.mistSheng, { loop: true, fadeIn: this.started })
    this.armUnlock()
  }

  /**
   * Seal click → Chao Tian Zi under Mist’s fade-out (drum at 1s), then Jing Diao,
   * then Mist ↔ Jing.
   */
  enterFromSeal(): void {
    this.disarmUnlock()
    this.phase = 'entry'
    this.ambientCue = 'mist'
    void this.crossfadeTo(AUDIO.chaoTianZi, {
      loop: false,
      volume: AUDIO.chaoTianZiVolume,
      startAt: AUDIO.chaoTianZiStartAt,
    })
  }

  /** Skip intro curtain — go straight to the ambient Mist ↔ Jing loop. */
  startAmbientLoop(): void {
    this.disarmUnlock()
    this.phase = 'ambient'
    this.ambientCue = 'mist'
    this.warm(AUDIO.jingDiao)
    void this.play(AUDIO.mistSheng, { loop: false, fadeIn: this.started })
    this.armUnlock()
  }

  private onEnded(): void {
    if (this.phase === 'entry') {
      this.phase = 'transition'
      void this.play(AUDIO.jingDiao, {
        loop: false,
        fadeIn: true,
        volume: AUDIO.volume,
      })
      return
    }
    if (this.phase === 'transition') {
      this.phase = 'ambient'
      this.ambientCue = 'mist'
      void this.play(AUDIO.mistSheng, { loop: false, fadeIn: true })
      return
    }
    if (this.phase === 'ambient') {
      if (this.ambientCue === 'mist') {
        this.ambientCue = 'jing'
        void this.play(AUDIO.jingDiao, { loop: false, fadeIn: true })
      } else {
        this.ambientCue = 'mist'
        void this.play(AUDIO.mistSheng, { loop: false, fadeIn: true })
      }
    }
  }

  /**
   * Overlap the outgoing track’s fade-out with the next cue’s fade-in
   * (used for Chao Tian Zi so the drum hits during Mist Sheng’s exit).
   */
  private async crossfadeTo(
    src: string,
    opts: { loop: boolean; volume: number; startAt: number },
  ): Promise<void> {
    const gen = ++this.fadeGen
    const next = new Audio()
    next.preload = 'auto'
    next.muted = this.muted
    next.loop = opts.loop
    next.src = src
    next.volume = 0

    const seek = () => {
      try {
        next.currentTime = opts.startAt
      } catch {
        /* seek may fail before metadata; retry on loadeddata */
      }
    }
    seek()
    next.addEventListener('loadeddata', seek, { once: true })

    try {
      await next.play()
      this.started = true
      this.disarmUnlock()
    } catch {
      next.volume = opts.volume
      this.adoptAudio(next)
      return
    }

    const outgoing = this.audio
    await Promise.all([
      this.started && !outgoing.paused
        ? this.fadeEl(outgoing, 0, AUDIO.fadeMs, gen)
        : Promise.resolve(),
      this.fadeEl(next, opts.volume, AUDIO.fadeMs, gen),
    ])
    if (gen !== this.fadeGen) {
      next.pause()
      return
    }

    outgoing.pause()
    outgoing.removeEventListener('ended', this.onAudioEnded)
    this.adoptAudio(next)
  }

  private adoptAudio(el: HTMLAudioElement): void {
    this.audio = el
    this.bindAudio(el)
  }

  private async play(src: string, opts: PlayOpts): Promise<void> {
    const gen = ++this.fadeGen
    const targetVol = opts.volume ?? AUDIO.volume

    if (this.started && !this.audio.paused) {
      await this.fadeEl(this.audio, 0, AUDIO.fadeMs, gen)
      if (gen !== this.fadeGen) return
    }

    this.audio.pause()
    this.audio.loop = opts.loop
    this.audio.src = src
    const startAt = opts.startAt ?? 0
    this.audio.currentTime = startAt
    this.audio.volume = opts.fadeIn ? 0 : targetVol

    try {
      await this.audio.play()
      if (startAt > 0) this.audio.currentTime = startAt
      this.started = true
      this.disarmUnlock()
      if (opts.fadeIn) {
        await this.fadeEl(this.audio, targetVol, AUDIO.fadeMs, gen)
      } else {
        this.audio.volume = targetVol
      }
    } catch {
      // Autoplay blocked — wait for a gesture (see armUnlock).
      this.audio.volume = targetVol
    }
  }

  private fadeEl(
    el: HTMLAudioElement,
    target: number,
    ms: number,
    gen: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      const from = el.volume
      if (ms <= 0 || Math.abs(from - target) < 0.01) {
        el.volume = target
        resolve()
        return
      }
      const t0 = performance.now()
      const step = (now: number) => {
        if (gen !== this.fadeGen) {
          resolve()
          return
        }
        const u = Math.min(1, (now - t0) / ms)
        el.volume = from + (target - from) * u
        if (u < 1) requestAnimationFrame(step)
        else resolve()
      }
      requestAnimationFrame(step)
    })
  }

  private warm(src: string): void {
    const a = new Audio()
    a.preload = 'auto'
    a.src = src
  }

  private armUnlock(): void {
    if (this.unlockBound || this.started) return
    this.unlockBound = true
    document.addEventListener('pointerdown', this.unlockHandler, { capture: true })
  }

  private disarmUnlock(): void {
    if (!this.unlockBound) return
    this.unlockBound = false
    document.removeEventListener('pointerdown', this.unlockHandler, {
      capture: true,
    })
  }

  private onUnlockPointer(e: PointerEvent): void {
    if (this.started) {
      this.disarmUnlock()
      return
    }
    // Let the seal click own audio — go straight to Chao Tian Zi.
    if ((e.target as Element | null)?.closest?.('#intro-seal')) return

    if (this.phase === 'intro') {
      void this.play(AUDIO.mistSheng, { loop: true, fadeIn: false })
    } else if (this.phase === 'ambient') {
      const src =
        this.ambientCue === 'jing' ? AUDIO.jingDiao : AUDIO.mistSheng
      void this.play(src, { loop: false, fadeIn: false })
    }
  }
}

let singleton: MapPlaylist | null = null

export function getPlaylist(): MapPlaylist {
  if (!singleton) singleton = new MapPlaylist()
  return singleton
}
