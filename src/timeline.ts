import { PlaybackClock } from './animation/playback-clock';
import { Events } from './events';

const registerTimelineEvents = (events: Events) => {
    const clock = new PlaybackClock();
    let frames = 180;
    let frameRate = 30;
    let smoothness = 1;
    let frame = 0;
    let explicitDuration = false;

    const publishTime = (force = false, playbackTick = false) => {
        const nextFrame = Math.min(frames - 1, Math.floor(clock.time * frameRate + 1e-9));
        if (force || nextFrame !== frame) {
            frame = nextFrame;
            events.fire('timeline.frame', frame);
        }
        // Camera tracks consume fractional frames; providers consume seconds.
        events.fire('timeline.time', Math.min(clock.time * frameRate, frames - 1));
        events.fire('timeline.seconds', clock.time, playbackTick);
    };
    const setPlaying = (value: boolean) => {
        if (value === clock.playing) return;
        if (value && clock.time >= clock.duration) {
            clock.seek(0);
            publishTime();
        }
        clock.playing = value;
        events.fire('timeline.playing', value);
    };
    const setFrame = (value: number) => {
        if (!Number.isFinite(value)) return;
        clock.seek(Math.max(0, Math.min(frames - 1, Math.floor(value))) / frameRate);
        publishTime();
    };
    const setFrames = (value: number) => {
        if (!Number.isFinite(value) || value < 1) return;
        frames = Math.floor(value);
        explicitDuration = false;
        clock.setDuration(frames / frameRate);
        publishTime();
        events.fire('timeline.frames', frames);
    };

    events.function('timeline.frame', () => frame);
    events.function('timeline.frames', () => frames);
    events.function('timeline.frameRate', () => frameRate);
    events.function('timeline.seconds', () => clock.time);
    events.function('timeline.duration', () => clock.duration);
    events.function('timeline.playbackRate', () => clock.rate);
    events.function('timeline.smoothness', () => smoothness);
    events.function('timeline.loop', () => clock.loop);
    events.function('timeline.playing', () => clock.playing);

    events.on('timeline.setFrame', setFrame);
    events.on('timeline.setFrames', setFrames);
    events.on('timeline.setSeconds', (value: number) => {
        clock.seek(value);
        publishTime();
    });
    events.on('timeline.setDuration', (value: number) => {
        if (!Number.isFinite(value) || value <= 0) return;
        clock.setDuration(value);
        explicitDuration = true;
        frames = Math.max(1, Math.ceil(value * frameRate));
        publishTime();
        events.fire('timeline.frames', frames);
    });
    events.on('timeline.setFrameRate', (value: number) => {
        if (!Number.isFinite(value) || value <= 0) return;
        frameRate = value;
        if (explicitDuration) {
            const keys = events.functions.has('track.keys') ? events.invoke('track.keys') as number[] : [];
            const duration = Math.max(clock.duration, (Math.max(-1, ...keys) + 1) / frameRate);
            clock.setDuration(duration);
            frames = Math.max(1, Math.ceil(duration * frameRate));
            events.fire('timeline.frames', frames);
        } else clock.setDuration(frames / frameRate);
        publishTime();
        events.fire('timeline.frameRate', frameRate);
    });
    events.on('timeline.setPlaybackRate', (value: number) => {
        if (!Number.isFinite(value) || value <= 0) return;
        clock.rate = value;
        events.fire('timeline.playbackRate', value);
    });
    events.on('timeline.setSmoothness', (value: number) => {
        if (!Number.isFinite(value)) return;
        smoothness = Math.max(0, Math.min(1, value));
        events.fire('timeline.smoothness', smoothness);
    });
    events.on('timeline.setLoop', (value: boolean) => {
        clock.loop = !!value;
        events.fire('timeline.loop', clock.loop);
    });
    events.on('timeline.setPlaying', setPlaying);
    events.on('timeline.togglePlay', () => setPlaying(!clock.playing));
    events.on('update', (dt: number) => {
        if (!clock.playing) return;
        clock.advance(dt);
        publishTime(false, true);
        if (!clock.playing) events.fire('timeline.playing', false);
    });

    const step = (direction: number) => {
        setPlaying(false);
        const next = frame + direction;
        setFrame(clock.loop ? (next + frames) % frames : next);
    };
    events.on('timeline.prevFrame', () => step(-1));
    events.on('timeline.nextFrame', () => step(1));
    const skipToKey = (forward: boolean) => {
        setPlaying(false);
        const keys = (events.invoke('track.keys') as number[] ?? [])
        .filter(k => k >= 0 && k < frames).sort((a, b) => a - b);
        const next = forward ? keys.find(k => k > frame) : keys.slice().reverse().find(k => k < frame);
        setFrame(next ?? (forward ? frames - 1 : 0));
    };
    events.on('timeline.prevKey', () => skipToKey(false));
    events.on('timeline.nextKey', () => skipToKey(true));
    events.on('scene.clear', () => {
        setPlaying(false);
        clock.seek(0);
        publishTime(true);
        events.fire('timeline.frames', frames);
    });

    events.function('docSerialize.timeline', () => ({
        frames,
        frameRate,
        frame,
        smoothness,
        loop: clock.loop,
        seconds: clock.time,
        duration: clock.duration,
        playbackRate: clock.rate,
        durationExplicit: explicitDuration
    }));
    events.function('docDeserialize.timeline', (data: any = {}) => {
        setPlaying(false);
        frameRate = Number.isFinite(data.frameRate) && data.frameRate > 0 ? data.frameRate : 30;
        frames = Number.isFinite(data.frames) && data.frames >= 1 ? Math.floor(data.frames) : 180;
        smoothness = Number.isFinite(data.smoothness) ? Math.max(0, Math.min(1, data.smoothness)) : 1;
        clock.loop = data.loop ?? true;
        clock.rate = Number.isFinite(data.playbackRate) && data.playbackRate > 0 ? data.playbackRate : 1;
        clock.setDuration(data.duration ?? frames / frameRate);
        explicitDuration = data.durationExplicit ?? Number.isFinite(data.duration);
        clock.seek(data.seconds ?? (data.frame ?? 0) / frameRate);
        events.fire('timeline.frames', frames);
        events.fire('timeline.frameRate', frameRate);
        events.fire('timeline.smoothness', smoothness);
        events.fire('timeline.loop', clock.loop);
        events.fire('timeline.playbackRate', clock.rate);
        publishTime(true);
    });
};

export { registerTimelineEvents };
