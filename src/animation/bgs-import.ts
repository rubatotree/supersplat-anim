/** Path helpers so a folder's scene.json resolves sibling assets the same way a ZIP does. */

const normalizeBgsPath = (filename: string): string => filename.replaceAll('\\', '/');

const bgsBasename = (filename: string): string => {
    const name = normalizeBgsPath(filename);
    return name.slice(name.lastIndexOf('/') + 1);
};

const isBgsSceneFilename = (filename: string): boolean => {
    const name = normalizeBgsPath(filename).toLowerCase();
    return name === 'scene.json' || name.endsWith('/scene.json');
};


/** Keys loadBgs may use for a file sitting next to scene.json. */
const bgsFileAliases = (scenePath: string, filename: string): string[] => {
    const scene = normalizeBgsPath(scenePath);
    const name = normalizeBgsPath(filename);
    const sceneDir = scene.slice(0, scene.lastIndexOf('/') + 1);
    const sceneDirLower = scene.toLowerCase().slice(0, scene.toLowerCase().lastIndexOf('/') + 1);
    const nameLower = name.toLowerCase();
    const base = bgsBasename(name);
    const aliases = new Set<string>([name, base]);
    if (sceneDirLower) {
        if (nameLower.startsWith(sceneDirLower)) aliases.add(name.slice(sceneDirLower.length));
        aliases.add(sceneDir + base);
    }
    return [...aliases];
};

const bgsSidecarMissing = (sceneJson: string, files: { filename: string }[]): boolean => {
    let value: { gaussians?: { uri?: string }; animation?: { uri?: string } };
    try {
        value = JSON.parse(sceneJson);
    } catch {
        return true;
    }
    const have = new Set(files.map(file => bgsBasename(file.filename).toLowerCase()));
    return [value.gaussians?.uri, value.animation?.uri].some(uri => typeof uri === 'string' && uri !== '' && !have.has(bgsBasename(uri).toLowerCase()));
};

export { bgsBasename, bgsFileAliases, bgsSidecarMissing, isBgsSceneFilename, normalizeBgsPath };
