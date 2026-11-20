'use strict';
/**
 * ADR-2207 D1: the Node side of the one display definition. Same rules as
 * display-env.sh (tests/browsercontainer/display-config.test.cjs keeps them in
 * step): BROWSER_DISPLAY_SIZE is WxH, decimal integers without a leading zero,
 * exactly 16:9, width 1280..3840. Default 1920x1080.
 */

const DEFAULT_DISPLAY_SIZE = '1920x1080';

/** Parses and validates a display size. Throws on anything display-env.sh would refuse. */
function parseDisplaySize(value = process.env.BROWSER_DISPLAY_SIZE) {
  const size = value === undefined || value === '' ? DEFAULT_DISPLAY_SIZE : String(value);
  const m = /^([1-9][0-9]{0,4})x([1-9][0-9]{0,4})$/.exec(size);
  if (!m) throw new Error(`BROWSER_DISPLAY_SIZE='${size}' is not WxH (decimal integers, no leading zero)`);
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (width * 9 !== height * 16) throw new Error(`BROWSER_DISPLAY_SIZE='${size}' is not 16:9`);
  if (width < 1280 || width > 3840) throw new Error(`BROWSER_DISPLAY_SIZE='${size}' width must be between 1280 and 3840`);
  return { width, height, size };
}

module.exports = { DEFAULT_DISPLAY_SIZE, parseDisplaySize };
