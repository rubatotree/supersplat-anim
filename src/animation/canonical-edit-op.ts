import type { Splat } from '../splat';
import type { CanonicalSnapshot } from './animated-geometry';

/** Stores the actual instances and matrices; undo never re-evaluates an old time. */
class CanonicalEditOp {
    readonly name = 'canonicalEdit';
    constructor(readonly splat: Splat, readonly before: CanonicalSnapshot, readonly after: CanonicalSnapshot) {}
    async do(): Promise<void> {
        this.splat.animation.restoreEdit(this.after);
        await this.splat.updatePositions();
    }
    async undo(): Promise<void> {
        this.splat.animation.restoreEdit(this.before);
        await this.splat.updatePositions();
    }
}

export { CanonicalEditOp };
