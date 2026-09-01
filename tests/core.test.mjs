import test from "node:test";
import assert from "node:assert/strict";
import { parseSequence, locateElapsed, formatClock, cumulativeStarts, resolveElapsed } from "../timer-core.js";

test("parses plus signs, commas, and spaces", () => {
  assert.deepEqual(parseSequence("25 + 5, 25 15").durationsSec, [1500, 300, 1500, 900]);
});

test("expands repeated groups", () => {
  const parsed = parseSequence("4x(25+5)");
  assert.equal(parsed.durationsSec.length, 8);
  assert.deepEqual(parsed.durationsSec, [1500, 300, 1500, 300, 1500, 300, 1500, 300]);
});

test("accepts decimals down to one second", () => {
  assert.deepEqual(parseSequence(".5 + .25 + 0.0167").durationsSec, [30, 15, 1]);
});

test("rejects malformed and unsafe sequences", () => {
  assert.throws(() => parseSequence("0 + 5"), /positive/);
  assert.throws(() => parseSequence("2x25+5"), /parentheses/);
  assert.throws(() => parseSequence("100x(1+2+3)"), /Repeat counts/);
});

test("locates exact boundaries in the next block", () => {
  const durations = [60, 30, 60];
  assert.equal(locateElapsed(durations, 59_999).index, 0);
  assert.equal(locateElapsed(durations, 60_000).index, 1);
  assert.equal(locateElapsed(durations, 90_000).index, 2);
});

test("locates session completion", () => {
  const result = locateElapsed([1, 1], 5_000);
  assert.equal(result.complete, true);
  assert.equal(result.elapsedMs, 2_000);
  assert.equal(result.blockRemainingMs, 0);
});

test("formats clocks and cumulative starts", () => {
  assert.equal(formatClock(70 * 60 * 1000), "1:10:00");
  assert.equal(formatClock(65_001), "1:06");
  assert.deepEqual(cumulativeStarts([60, 30, 60]), [0, 60, 90]);
});

test("a running timer reopens at the wall-clock-correct block", () => {
  const startedAt = 1_000_000;
  const persisted = { status: "running", startEpochMs: startedAt, elapsedMs: 0 };
  // The process is gone for 31 minutes; only persisted state survives.
  const reopenedElapsed = resolveElapsed(JSON.parse(JSON.stringify(persisted)), startedAt + 31 * 60_000);
  const reopened = locateElapsed([25 * 60, 5 * 60, 25 * 60, 15 * 60], reopenedElapsed);
  assert.equal(reopened.index, 2);
  assert.equal(reopened.blockRemainingMs, 24 * 60_000);
});

test("a paused timer reopens at the same stored instant", () => {
  const persisted = { status: "paused", startEpochMs: null, elapsedMs: 12 * 60_000 + 345 };
  const reopenedElapsed = resolveElapsed(JSON.parse(JSON.stringify(persisted)), Date.now() + 3 * 24 * 60 * 60_000);
  assert.equal(reopenedElapsed, 12 * 60_000 + 345);
});
