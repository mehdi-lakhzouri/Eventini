/**
 * Canonical JSON — IDEMPOTENCY_AND_CONCURRENCY.md §3.
 *
 * The fingerprint is what separates a legitimate replay from a key collision,
 * so two spellings of the same body have to hash identically. `JSON.stringify`
 * does not give that: it preserves insertion order, so `{"a":1,"b":2}` and
 * `{"b":2,"a":1}` — the same intention, serialised by two client builds —
 * would produce two hashes and turn a retry into a `409`.
 *
 * Three rules, each because the round trip through JSON is lossy in a
 * different way:
 *
 * - **Keys sorted**, recursively. Arrays are left alone: their order is data.
 * - **No whitespace between tokens**, which is `JSON.stringify`'s default and
 *   is restated here because the manual formatting of a hand-built request
 *   must not matter.
 * - **No scientific notation.** `String(1e21)` is `"1e+21"` and
 *   `String(0.0000001)` is `"1e-7"`; whether a number crosses that threshold
 *   depends on its magnitude, so a serialiser that emits `100000000000000000000`
 *   and one that emits `1e+20` would disagree on the same value.
 *
 * `null` is preserved rather than dropped: `{"a":null}` and `{}` are two
 * different intentions, and a client that stops sending a field is asking for
 * something else than one that sends it empty.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'number':
      return canonicalNumber(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      // Escaping is the one part of JSON with a single correct answer.
      return JSON.stringify(value);
    case 'object':
      return Array.isArray(value)
        ? canonicalArray(value)
        : canonicalObject(value as Record<string, unknown>);
    default:
      // `undefined`, functions and symbols have no JSON representation. Only
      // reachable from a hand-built object, never from a parsed body.
      return 'null';
  }
}

function canonicalArray(values: readonly unknown[]): string {
  return `[${values.map((entry) => canonicalJson(entry)).join(',')}]`;
}

function canonicalObject(value: Record<string, unknown>): string {
  const entries = Object.keys(value)
    .sort()
    // An absent key and a key set to `undefined` are the same request on the
    // wire, so they must be the same string here.
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);

  return `{${entries.join(',')}}`;
}

function canonicalNumber(value: number): string {
  // JSON has no NaN or Infinity; `JSON.stringify` writes `null` for both, and
  // disagreeing with it here would make the two serialisations diverge on the
  // one input where neither is meaningful.
  if (!Number.isFinite(value)) {
    return 'null';
  }

  const text = String(value);

  return text.includes('e') || text.includes('E') ? expandExponent(text) : text;
}

/** `1e+21` → `1000000000000000000000`, `1.5e-7` → `0.00000015`. */
function expandExponent(text: string): string {
  const parsed = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(text);

  if (parsed === null) {
    return text;
  }

  const [, sign = '', whole = '0', fraction = '', exponent = '0'] = parsed;
  const digits = whole + fraction;
  const pointAt = whole.length + Number(exponent);

  if (pointAt <= 0) {
    return `${sign}0.${'0'.repeat(-pointAt)}${digits}`;
  }

  if (pointAt >= digits.length) {
    return `${sign}${digits}${'0'.repeat(pointAt - digits.length)}`;
  }

  return `${sign}${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`;
}
