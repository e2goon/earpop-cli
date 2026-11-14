import assert from "node:assert/strict";
import { describe, it } from "node:test";
import stringWidth from "string-width";

import { fitHints, latinKey } from "#/lib/keys.js";

describe("latinKey", () => {
  it("maps Hangul jamo to the shortcut on the same key", () => {
    assert.equal(latinKey("ㅔ"), "p");
    assert.equal(latinKey("ㅡ"), "m");
    assert.equal(latinKey("ㄴ"), "s");
    assert.equal(latinKey("ㅣ"), "l");
    assert.equal(latinKey("ㅊ"), "c");
  });

  it("passes other input through", () => {
    for (const input of ["p", "?", "3", "", "가"]) assert.equal(latinKey(input), input);
  });
});

describe("fitHints", () => {
  const hints = [
    { text: "p pause", priority: 8 },
    { text: "1-9 speaker", priority: 3 },
    { text: "m mic", priority: 6 },
    { text: "? keys", priority: 9 },
    { text: "ESC end", priority: 10 },
  ];

  it("keeps every hint when they fit", () => {
    assert.equal(fitHints({ hints, width: 80 }), "p pause  1-9 speaker  m mic  ? keys  ESC end");
  });

  it("drops the least important hints first and keeps the order", () => {
    assert.equal(fitHints({ hints, width: 30 }), "p pause  ? keys  ESC end");
    assert.equal(fitHints({ hints, width: 10 }), "ESC end");
  });

  it("never exceeds the width while more than one hint is left", () => {
    for (let width = 8; width <= 60; width += 1) {
      assert.ok(stringWidth(fitHints({ hints, width })) <= width, String(width));
    }
  });
});
