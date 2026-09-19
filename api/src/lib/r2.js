/**
 * DEPRECATED — kept only so any straggling `import ... from '../lib/r2.js'`
 * keeps resolving. All real logic moved to lib/storage.js when the project
 * dropped the hard R2 dependency (R2 requires a card to issue API tokens).
 *
 * Import from './lib/storage.js' directly in new code. This file can be
 * deleted once you've confirmed nothing references it.
 */
export {
    uploadPhoto,
    getSignedPhotoUrl,
    deletePhoto,
    getObjectStream,
    isStorageHealthy,
    getStorageConfig,
} from './storage.js';
