'use strict';

/**
 * forge-cli/lib/picker.js
 *
 * Paginated AskUserQuestion picker helper.
 *
 * Background
 * ----------
 * The `AskUserQuestion` tool enforces `2 <= options.length <= 4` per call
 * (a Claude Code platform constraint, not a Forge one). When a workflow needs
 * to offer more than 4 options in a single multiSelect picker (e.g. a phase
 * with 6+ gray areas in /forge-discuss-phase), the call would be rejected.
 *
 * `paginate(options, opts)` splits an arbitrary-length option list into a
 * sequence of pages that each satisfy AskUserQuestion's contract:
 *
 *   - Every page has 2..4 options.
 *   - Every non-last page reserves one slot for a navigation sentinel
 *     ("Show more options →") so the model can advance after collecting
 *     selections for that page.
 *   - The last page has no nav slot (caller is expected to finalize).
 *   - Total user-pickable options across pages equals `options.length`.
 *   - Option order is preserved.
 *   - The nav slot is marked with `__nav: true` so callers can distinguish
 *     it from real options when the user's selection comes back.
 *
 * The split is greedy with a single look-ahead: take 3 options for an
 * intermediate page, unless taking 3 would leave exactly 1 for the next
 * page (which would violate `minItems: 2`); in that case take 2.
 *
 *   N=2..4  → 1 page, no nav         (single-page fast path)
 *   N=5     → [3 + nav][2]            total = 5
 *   N=6     → [3 + nav][3]            total = 6
 *   N=7     → [3 + nav][2 + nav][2]   total = 7
 *   N=8     → [3 + nav][3 + nav][2]   total = 8
 *   N=10    → [3 + nav][3 + nav][2 + nav][2]
 *   N=12    → [3 + nav][3 + nav][3 + nav][3]
 *
 * Every page is independently a valid AskUserQuestion call.
 */

const DEFAULT_NAV_LABEL = 'Show more options →';
const DEFAULT_NAV_DESCRIPTION = 'Show more options to choose from';

function _isOptionLike(o) {
  return o && typeof o === 'object' && typeof o.label === 'string';
}

function _navOption(label, description) {
  return {
    label: String(label || DEFAULT_NAV_LABEL),
    description: String(description || DEFAULT_NAV_DESCRIPTION),
    __nav: true,
  };
}

/**
 * Split `options` into AskUserQuestion-shaped pages.
 *
 * @param {Array<{label: string, description?: string, preview?: string}>} options
 * @param {Object} [opts]
 * @param {string} [opts.navLabel]        - Label for the "show more" nav slot.
 * @param {string} [opts.navDescription]  - Description for the nav slot.
 * @param {number} [opts.pageSize=3]      - User-option slots per intermediate page.
 *                                          With +1 nav slot this fits in maxItems=4.
 * @returns {{pages: Array<{options: Array, isLast: boolean}>, total: number, pageSize: number}}
 */
function paginate(options, opts) {
  if (!Array.isArray(options)) {
    throw new TypeError('paginate: options must be an array');
  }
  for (let i = 0; i < options.length; i++) {
    if (!_isOptionLike(options[i])) {
      throw new TypeError(`paginate: options[${i}] must be {label, description?}`);
    }
  }
  const o = opts || {};
  const pageSize = Number.isFinite(o.pageSize) ? Math.max(1, Math.min(3, o.pageSize | 0)) : 3;
  const navLabel = o.navLabel;
  const navDescription = o.navDescription;
  const total = options.length;

  // Fast path: AskUserQuestion can handle 2..4 in one shot.
  if (total <= 4) {
    if (total < 2) {
      // 0 or 1 option — still emit a single page so callers can decide what
      // to do (typically: skip the picker entirely, no decision needed).
      return {
        pages: [{ options: options.slice(), isLast: true }],
        total,
        pageSize,
      };
    }
    return {
      pages: [{ options: options.slice(), isLast: true }],
      total,
      pageSize,
    };
  }

  const pages = [];
  let i = 0;
  while (i < total) {
    const remaining = total - i;
    if (remaining <= 3) {
      // Last page: 2..3 options, no nav slot.
      pages.push({ options: options.slice(i), isLast: true });
      i = total;
    } else {
      // Intermediate page: 3 + nav, unless that would leave 1 → use 2 + nav.
      const take = remaining === 4 ? 2 : pageSize;
      const slice = options.slice(i, i + take);
      slice.push(_navOption(navLabel, navDescription));
      pages.push({ options: slice, isLast: false });
      i += take;
    }
  }
  return { pages, total, pageSize };
}

/**
 * Convenience: given a `selections` array (the user's picks on a page),
 * separate the nav sentinel from real selections.
 *
 * @param {Array<{label: string}>} selections
 * @returns {{picked: Array, advance: boolean}}
 */
function partitionSelections(selections) {
  if (!Array.isArray(selections)) return { picked: [], advance: false };
  const picked = [];
  let advance = false;
  for (const s of selections) {
    if (s && s.__nav === true) { advance = true; continue; }
    if (s && typeof s.label === 'string' && /^show more options\s*→?$/i.test(s.label.trim())) {
      advance = true; continue;
    }
    picked.push(s);
  }
  return { picked, advance };
}

module.exports = {
  paginate,
  partitionSelections,
  DEFAULT_NAV_LABEL,
  DEFAULT_NAV_DESCRIPTION,
};
