import assert from "node:assert/strict";
import {describe, test} from "node:test";
import {nearestBar, nearestDot} from "../../src/_tooltip.js";

describe("nearestDot", () => {
  const big = {id: "big", x: 100, y: 100, radius: 14};
  const small = {id: "small", x: 104, y: 100, radius: 2};

  test("finds nothing when the pointer is far from every dot", () => {
    assert.equal(nearestDot([big, small], 300, 300, 8), null);
  });

  test("prefers the smallest of the dots the pointer is inside", () => {
    assert.equal(nearestDot([big, small], 104, 100, 8).id, "small");
    assert.equal(nearestDot([small, big], 104, 100, 8).id, "small");
  });

  test("takes the dot the pointer is inside before a nearer one it is outside of", () => {
    assert.equal(nearestDot([big, small], 112, 100, 8).id, "big");
  });

  test("falls back to the nearest dot within reach, and not to one beyond it", () => {
    const left = {id: "left", x: 50, y: 50, radius: 1};
    const right = {id: "right", x: 60, y: 50, radius: 1};
    assert.equal(nearestDot([left, right], 57, 50, 8).id, "right");
    assert.equal(nearestDot([left, right], 57, 70, 8), null);
  });

  test("finds nothing among no dots", () => {
    assert.equal(nearestDot([], 0, 0, 8), null);
  });
});

describe("nearestBar", () => {
  const options = {barWidth: 5, hitRadius: 8};
  const tall = {id: "tall", x: 100, y: 40, baseline: 200};
  const short = {id: "short", x: 103, y: 150, baseline: 200};

  test("finds a bar from its baseline up to a little above its top", () => {
    assert.equal(nearestBar([tall], 100, 200, options).id, "tall");
    assert.equal(nearestBar([tall], 100, 208, options).id, "tall");
    assert.equal(nearestBar([tall], 100, 33, options).id, "tall");
    assert.equal(nearestBar([tall], 100, 209, options), null);
    assert.equal(nearestBar([tall], 100, 31, options), null);
  });

  test("finds a bar only within its width sideways", () => {
    assert.equal(nearestBar([tall], 105, 100, options).id, "tall");
    assert.equal(nearestBar([tall], 106, 100, options), null);
  });

  test("takes the nearest bar sideways when several reach the pointer", () => {
    assert.equal(nearestBar([tall, short], 101, 180, options).id, "tall");
    assert.equal(nearestBar([tall, short], 102.6, 180, options).id, "short");
  });

  test("only counts the bars that reach as high as the pointer", () => {
    assert.equal(nearestBar([tall, short], 103, 100, options).id, "tall");
  });
});
