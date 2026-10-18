// Every setting default lives here: setting defs have no `default`, so an unset
// value reads as undefined in api.settings().
export const DEFAULT_REPO_PATH = '~/vcs/enterprise';
export const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3333', 'http://localhost:1234'];
// The pick wire format. PROTOCOL is what the current bookmarklet speaks;
// SUPPORTED_PROTOCOLS is every protocol the board still accepts, so
// bookmarklets dragged before an update keep working.
export const PROTOCOL = 1;
export const SUPPORTED_PROTOCOLS = [1];
export const MAX_BUILD = 64;
export const MAX_HTML = 4096;
export const MAX_SHOT_BYTES = 10 * 1024 * 1024;
export const MAX_OWNERS = 8;
export const MAX_URL = 2048;
export const MAX_FIELD = 256;
export const MAX_PATH = 512;
export const MAX_CLASSES = 3;
