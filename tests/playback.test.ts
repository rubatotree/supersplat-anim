import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PlaybackClock } from '../src/animation/playback-clock';
import { Events } from '../src/events';
import { registerTimelineEvents } from '../src/timeline';

test('non-looping clock holds endpoint and stops', () => {
    const clock = new PlaybackClock();
    clock.duration = 0.1;
    clock.loop = false;
    clock.playing = true;
    clock.advance(1);
    assert.equal(clock.time, 0.1);
    assert.equal(clock.playing, false);
});

test('rate is independent of sample count and scrubbing changes live playback', () => {
    const clock = new PlaybackClock();
    clock.rate = 2;
    clock.playing = true;
    clock.advance(0.25);
    assert.equal(clock.time, 0.5);
    clock.seek(3);
    clock.advance(0.25);
    assert.equal(clock.time, 3.5);
    clock.advance(Number.NaN);
    assert.equal(clock.time, 3.5);
});

test('loop wraps by duration and single-frame timeline remains finite', () => {
    const events = new Events();
    events.function('track.keys', () => []);
    registerTimelineEvents(events);
    events.fire('timeline.setFrames', 1);
    events.fire('timeline.setPlaying', true);
    events.fire('update', 0.5);
    assert.equal(events.invoke('timeline.frame'), 0);
    assert.ok(Number.isFinite(events.invoke('timeline.seconds')));
    events.fire('scene.clear');
    assert.equal(events.invoke('timeline.playing'), false);
});

test('timeline clamps invalid frame seeks and restores legacy documents', () => {
    const events = new Events();
    events.function('track.keys', () => []);
    registerTimelineEvents(events);
    events.invoke('docDeserialize.timeline', { frames: 30, frameRate: 30, frame: 10, loop: false });
    assert.equal(events.invoke('timeline.frame'), 10);
    events.fire('timeline.setFrame', 100);
    assert.equal(events.invoke('timeline.frame'), 29);
    events.fire('timeline.nextFrame');
    assert.equal(events.invoke('timeline.frame'), 29);
    events.fire('timeline.setPlaying', true);
    events.fire('update', 1);
    assert.equal(events.invoke('timeline.playing'), false);
    assert.equal(events.invoke('timeline.seconds'), 1);
});
