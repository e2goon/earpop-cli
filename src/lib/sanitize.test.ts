import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { stripTerminalEscapes } from "#/lib/sanitize.js";

describe("stripTerminalEscapes", () => {
  it("strips OSC 52 clipboard and OSC 8 hyperlinks", () => {
    const payload =
      "hello \x1b]52;c;ZXZpbA==\x07world \x1b]8;;https://evil.example\x07click\x1b]8;;\x07!";
    assert.equal(stripTerminalEscapes(payload), "hello world click!");
  });

  it("strips ST-terminated OSC, DCS, and CSI sequences", () => {
    const payload = "\x1b]0;title\x1b\\\x1bP1$q\x1b\\\x1b[31;1mred\x1b[0m \x9b2J\x9d0;c1\x9cplain";
    assert.equal(stripTerminalEscapes(payload), "red plain");
  });

  it("strips C0 and C1 control characters including CR/LF", () => {
    assert.equal(stripTerminalEscapes("line1\r\nline2\u0007\u007f\u0085"), "line1line2");
  });

  it("preserves English, Hangul, Japanese, Thai, and ZWJ emoji", () => {
    const safe = "Hello 안녕하세요 今日は สวัสดี 👨‍👩‍👧!";
    assert.equal(stripTerminalEscapes(safe), safe);
  });
});
