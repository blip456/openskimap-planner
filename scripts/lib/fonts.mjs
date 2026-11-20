// Which glyph ranges (256 characters per .pbf file) the offline map needs. All 256 ranges of 3 font stacks are
// about 70 MB, but a ski map of the Alps only needs a few.

/** Always included: Latin, Latin Extended A/B, IPA/combining, Greek/Cyrillic start, general punctuation (– ’ € …). */
export const BASE_RANGE_STARTS = [0, 256, 512, 768, 8192];
/** Extra symbols the map styles draw themselves ("›", "‹ ›") are in range 8192 (U+2039/203A). */

/**
 * Keys whose text can show up as a label. The map style shows `name:<language>`, falling back to `name:en` and `name`;
 * other translations (name:zh, name:ja, ...) are never drawn, so they must not add glyph ranges.
 */
export function labelKeyTest(language = 'en') {
  const names = new Set(['name', 'name2', 'name3', `name:${language}`, 'name:en', 'alt_name', 'short_name', 'loc_name', 'official_name', 'ref', 'operator', 'brand', 'label', 'title', 'abbr']);
  return (key) => names.has(key);
}

export const rangeFile = (start) => `${start}-${start + 255}.pbf`;

/** Glyph range starts (0, 256, ...) for every character in the strings. Characters above U+FFFF have no glyph files. */
export function rangesForText(texts, into = new Set()) {
  for (const text of texts) {
    for (const ch of String(text)) {
      const cp = ch.codePointAt(0);
      if (cp > 0xffff) continue;
      into.add(Math.floor(cp / 256) * 256);
    }
  }
  return into;
}

/** Visits every label-like string value (keys like name, name:de, ref) anywhere in a parsed JSON value. */
export function* labelStrings(value, accept = labelKeyTest(), key = '') {
  if (typeof value === 'string') {
    if (accept(key)) yield value;
  } else if (Array.isArray(value)) {
    for (const v of value) yield* labelStrings(v, accept, key);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) yield* labelStrings(v, accept, k);
  }
}

/** Sorted list of range starts: the base ranges plus every range that has characters from `texts`. */
export function selectFontRanges(texts) {
  const set = new Set(BASE_RANGE_STARTS);
  rangesForText(texts, set);
  return [...set].sort((a, b) => a - b);
}
