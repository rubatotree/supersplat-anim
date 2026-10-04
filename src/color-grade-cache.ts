import { ColorGrade, createGradeTerms } from './color-grade';
import type { Splat } from './splat';

// Resolve an instance's baked colour grade on demand and cache it, the colour
// analogue of SplatTransformCache. Keyed by colour palette entry, so a scene
// where every gaussian shares one grade costs one ColorGrade.
class ColorGradeCache {
    get: (index: number) => ColorGrade;

    constructor(splat: Splat) {
        const grades = new Map<number, ColorGrade>();
        const { instances } = splat;
        const entry = createGradeTerms();

        this.get = (index: number) => {
            const colorIndex = instances.colorIndex(index);
            let result = grades.get(colorIndex);
            if (!result) {
                splat.colorPalette.getEntry(colorIndex, entry);
                result = new ColorGrade(entry);
                grades.set(colorIndex, result);
            }
            return result;
        };
    }
}

export { ColorGradeCache };
