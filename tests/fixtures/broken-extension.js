/**
 * Broken extension fixture for the shipped-path test: exports a number, not
 * a factory function. Pi's loader must reject it (and OpenPi must surface
 * that rejection as an extension_error event) while the valid extensions in
 * the same session keep loading.
 */
export const BROKEN_EXTENSION_MARKER = 42
export default BROKEN_EXTENSION_MARKER
