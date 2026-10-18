// Every setting default lives here: setting defs have no `default`, so an unset
// value reads as undefined in api.settings().
export const DEFAULT_REPO_PATH = '~/vcs/enterprise';
export const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3333', 'http://localhost:1234'];
// The pick wire format. PROTOCOL is what the current bookmarklet speaks;
// SUPPORTED_PROTOCOLS is every protocol the board still accepts, so
// bookmarklets dragged before an update keep working.
export const PROTOCOL = 1;
export const SUPPORTED_PROTOCOLS = [1];
// Fields a protocol's payload may carry or leave out, added without a protocol
// bump. Old boards ignore them; a malformed one is dropped, not fatal (the
// screenshot, there from the start, is the exception: a bad one rejects the
// pick). Each has a golden payload carrying it under test/fixtures.
export const OPTIONAL_FIELDS = { 1: ['screenshot', 'mode', 'contains'] };
export const MAX_BUILD = 64;
export const MAX_HTML = 4096;
export const MAX_SHOT_BYTES = 10 * 1024 * 1024;
export const MAX_OWNERS = 8;
export const MAX_URL = 2048;
export const MAX_FIELD = 256;
export const MAX_PATH = 512;
export const MAX_CLASSES = 3;
export const MAX_CONTAINS = 10;
