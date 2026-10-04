/** Deterministic seconds clock, independent of rendering and frame numbering. */
class PlaybackClock {
    time = 0;
    duration = 6;
    rate = 1;
    loop = true;
    playing = false;

    seek(time: number): void {
        if (Number.isFinite(time)) this.time = Math.max(0, Math.min(this.duration, time));
    }

    setDuration(duration: number): void {
        if (!Number.isFinite(duration) || duration <= 0) return;
        this.duration = duration;
        this.seek(this.time);
    }

    advance(dt: number): void {
        if (!this.playing || !Number.isFinite(dt) || dt <= 0) return;
        const next = this.time + dt * this.rate;
        if (this.loop) {
            this.time = next % this.duration;
        } else {
            this.time = Math.min(next, this.duration);
            if (next >= this.duration) this.playing = false;
        }
    }
}

export { PlaybackClock };
