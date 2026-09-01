const MAX_BLOCKS = 200;
const MAX_REPEAT = 99;
const MAX_TOTAL_SECONDS = 7 * 24 * 60 * 60;

export function parseSequence(source) {
  const input = String(source ?? "").trim();
  if (!input) throw new Error("Enter at least one duration.");
  let pos = 0;

  const fail = (message) => {
    const pointer = input.slice(Math.max(0, pos - 8), pos + 8);
    throw new Error(`${message} Near “${pointer}”.`);
  };

  const skipSpaces = () => {
    while (/\s/.test(input[pos] || "")) pos += 1;
  };

  const skipSeparators = () => {
    let found = false;
    while (true) {
      skipSpaces();
      if (input[pos] === "+" || input[pos] === ",") {
        found = true;
        pos += 1;
        continue;
      }
      break;
    }
    return found;
  };

  const readNumber = () => {
    skipSpaces();
    const match = input.slice(pos).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (!match) fail("Expected a duration");
    pos += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value) || value <= 0) fail("Durations must be positive");
    return value;
  };

  const parseList = (closing = null) => {
    const values = [];
    skipSeparators();
    while (pos < input.length && input[pos] !== closing) {
      const number = readNumber();
      const numberEnd = pos;
      skipSpaces();
      let whitespaceSeparator = pos > numberEnd;

      if (/^[xX×]$/.test(input[pos] || "")) {
        if (!Number.isInteger(number) || number > MAX_REPEAT) {
          fail(`Repeat counts must be whole numbers from 1 to ${MAX_REPEAT}`);
        }
        pos += 1;
        skipSpaces();
        if (input[pos] !== "(") fail("A repeat needs parentheses, for example 4x(25+5)");
        pos += 1;
        const group = parseList(")");
        if (input[pos] !== ")") fail("Missing closing parenthesis");
        pos += 1;
        if (!group.length) fail("A repeated group cannot be empty");
        for (let count = 0; count < number; count += 1) values.push(...group);
        const groupEnd = pos;
        skipSpaces();
        whitespaceSeparator = pos > groupEnd;
      } else {
        values.push(number);
      }

      if (values.length > MAX_BLOCKS) fail(`Keep sessions to ${MAX_BLOCKS} blocks or fewer`);
      const separated = skipSeparators();
      if (!separated && pos < input.length && input[pos] !== closing) {
        if (!whitespaceSeparator) fail("Separate durations with +, a comma, or a space");
      }
    }
    return values;
  };

  const minutes = parseList();
  skipSpaces();
  if (pos !== input.length) fail("Unexpected character");
  if (!minutes.length) throw new Error("Enter at least one duration.");

  const durationsSec = minutes.map((value) => {
    const seconds = Math.round(value * 60);
    if (seconds < 1) throw new Error("Each block must be at least one second.");
    return seconds;
  });
  const totalSec = durationsSec.reduce((sum, value) => sum + value, 0);
  if (totalSec > MAX_TOTAL_SECONDS) throw new Error("Keep the total session under seven days.");
  return { minutes, durationsSec, totalSec, canonical: minutes.map(formatMinutes).join(" + ") };
}

export function formatMinutes(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

export function cumulativeStarts(durationsSec) {
  const starts = [];
  let total = 0;
  for (const seconds of durationsSec) {
    starts.push(total);
    total += seconds;
  }
  return starts;
}

export function resolveElapsed({ status, startEpochMs, elapsedMs }, nowEpochMs = Date.now()) {
  if (status === "running" && Number.isFinite(startEpochMs)) {
    return Math.max(0, nowEpochMs - startEpochMs);
  }
  return Math.max(0, Number(elapsedMs) || 0);
}

export function locateElapsed(durationsSec, elapsedMs) {
  const totalMs = durationsSec.reduce((sum, value) => sum + value * 1000, 0);
  const clampedMs = Math.max(0, Math.min(Number(elapsedMs) || 0, totalMs));
  let cursor = 0;
  for (let index = 0; index < durationsSec.length; index += 1) {
    const durationMs = durationsSec[index] * 1000;
    const end = cursor + durationMs;
    if (clampedMs < end || (index === durationsSec.length - 1 && clampedMs === end)) {
      const inBlockMs = Math.min(durationMs, Math.max(0, clampedMs - cursor));
      return {
        index,
        inBlockMs,
        blockRemainingMs: Math.max(0, durationMs - inBlockMs),
        totalMs,
        elapsedMs: clampedMs,
        complete: clampedMs >= totalMs,
      };
    }
    cursor = end;
  }
  return { index: 0, inBlockMs: 0, blockRemainingMs: 0, totalMs, elapsedMs: 0, complete: true };
}

export function formatClock(ms, { alwaysHours = false } = {}) {
  const totalSeconds = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours || alwaysHours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatDurationLabel(seconds) {
  const minutes = seconds / 60;
  return `${formatMinutes(minutes)}m`;
}
