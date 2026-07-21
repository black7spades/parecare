/**
 * The running app's version, tied back to the git repository. The version and
 * the commit it was built from are injected at build time (see
 * vite.config.ts); this module turns them into the links the UI shows so the
 * record of updates stays accurate and traceable to source.
 */

export const REPO_URL = 'https://github.com/black7spades/parecare';

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
export const APP_COMMIT: string = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'dev';
export const APP_BUILD_TIME: string = typeof __APP_BUILD_TIME__ === 'string' ? __APP_BUILD_TIME__ : '';

/** A short, human label: "v0.1.0 · a1b2c3d" (commit omitted when unknown). */
export function versionLabel(): string {
  return APP_COMMIT && APP_COMMIT !== 'dev' ? `v${APP_VERSION} · ${APP_COMMIT}` : `v${APP_VERSION}`;
}

/** Link to the exact commit this build came from, or the repo when unknown. */
export function commitUrl(): string {
  return APP_COMMIT && APP_COMMIT !== 'dev' ? `${REPO_URL}/commit/${APP_COMMIT}` : REPO_URL;
}

/** The maintained record of updates. */
export const CHANGELOG_URL = `${REPO_URL}/blob/main/CHANGELOG.md`;
