// Drug shortage check: parse a pasted or uploaded product list and join it to the public-data
// bundle (FDA shortages x RxNorm x NADAC) that pipeline/analysis/shortage_bundle.py builds.
// Pure functions, no DOM, so tests/shortage.test.js can run them under node.
//
// Bundle keys (see shortage_bundle.py):
//   entries    {ndc11: FDA record}      by_product {ndc9: [ndc11]}     ndc_scd {ndc11: scd rxcui}
//   scd        {rxcui: {name, scdf, ndcs: [{ndc, desc, nadac, unit, eff, cls, s, sp?, inactive?}]}}
//   scdf       {rxcui: {name, scds: [{rxcui, name, n_ndc, n_short, n_disc, min_nadac, unit}]}}
//   nadac      {ndc11: [nadac_per_unit, unit]}   every NADAC NDC, for spend on unflagged products

export const SHORT = new Set(["current", "to_be_discontinued"]);
export const AFFECTED = new Set(["current", "to_be_discontinued", "discontinued"]);

// --------------------------------------------------------------------------- NDC

// 11 digits, no dashes, or null. Mirrors loaders/common.py normalize_ndc: dashed 4-4-2 / 5-3-2 /
// 5-4-1 forms get the missing zero in the short segment; dash-free values are left-padded.
export function parseNdc(value) {
  if (value == null) return null;
  let text = String(value).trim();
  if (!text) return null;
  if (/^\d+\.0+$/.test(text)) text = text.split(".")[0];
  if (text.includes("-")) {
    const parts = text.split("-");
    if (parts.length !== 3 || !parts.every((p) => /^\d+$/.test(p))) return null;
    const [l, p, k] = parts;
    if (l.length > 5 || p.length > 4 || k.length > 2) return null;
    return l.padStart(5, "0") + p.padStart(4, "0") + k.padStart(2, "0");
  }
  const digits = text.replace(/\D/g, "");
  if (!digits || digits.length > 11 || digits.length < 8 || digits !== text) return null;
  return digits.padStart(11, "0");
}

export const dashed = (ndc) => `${ndc.slice(0, 5)}-${ndc.slice(5, 9)}-${ndc.slice(9)}`;

// --------------------------------------------------------------------------- table parsing

function splitLine(line, delim) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function detectDelimiter(lines) {
  const score = (d) => lines.slice(0, 10).reduce((n, l) => n + (l.split(d).length - 1), 0);
  const tab = score("\t"), comma = score(","), semi = score(";");
  if (tab >= comma && tab >= semi && tab > 0) return "\t";
  if (semi > comma) return ";";
  return ",";
}

const toNumber = (v) => {
  const t = String(v ?? "").trim().replace(/[$,\s]/g, "");
  if (!t || !/^-?\(?\d*\.?\d+\)?$/.test(t)) return null;
  const n = parseFloat(t.replace(/[()]/g, ""));
  return Number.isFinite(n) ? (t.startsWith("(") ? -n : n) : null;
};

const QTY_RE = /qty|quantity|dispensed|units?\b|count|on hand|sold|volume/i;
const DESC_RE = /drug|description|item|product|name|label/i;
const NDC_RE = /\bndc\b/i;
const AVOID_RE = /price|cost|amount|paid|\$|total|nadac|awp|wac|date|rx\s?#|number/i;

// text -> {rows: [{ndc, desc, qty, raw}], columns: {ndc, qty, desc}, header: [...] | null, skipped}
export function parseTable(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
  if (!lines.length) return { rows: [], columns: {}, header: null, skipped: 0 };
  const delim = detectDelimiter(lines);
  // A plain-text paste separates columns with runs of spaces; treat those like tabs.
  const cleaned = delim === "\t" ? lines.map((l) => l.replace(/ {2,}/g, "\t")) : lines;
  let table = cleaned.map((l) => splitLine(l, delim));
  const width = Math.max(...table.map((r) => r.length));
  table = table.map((r) => [...r, ...Array(width - r.length).fill("")]);

  // Header: the first row has no NDC in it.
  const hasNdc = (row) => row.some((c) => parseNdc(c) && String(c).replace(/\D/g, "").length >= 10);
  const header = hasNdc(table[0]) ? null : table[0];
  const body = header ? table.slice(1) : table;
  if (!body.length) return { rows: [], columns: {}, header, skipped: 0 };

  // Pick columns by header name first, then by content.
  const cols = Array.from({ length: width }, (_, i) => i);
  const ndcHits = cols.map((i) => body.filter((r) => parseNdc(r[i]) && String(r[i]).replace(/\D/g, "").length >= 10).length);
  let ndcCol = header ? cols.find((i) => NDC_RE.test(header[i])) : undefined;
  if (ndcCol === undefined || !ndcHits[ndcCol]) ndcCol = cols.reduce((best, i) => (ndcHits[i] > ndcHits[best] ? i : best), 0);
  if (!ndcHits[ndcCol]) return { rows: [], columns: {}, header, skipped: body.length };

  const numHits = cols.map((i) => (i === ndcCol ? -1 : body.filter((r) => toNumber(r[i]) !== null).length));
  let qtyCol = header ? cols.find((i) => i !== ndcCol && QTY_RE.test(header[i]) && !AVOID_RE.test(header[i])) : undefined;
  if (qtyCol === undefined) {
    const candidates = cols.filter((i) => i !== ndcCol && numHits[i] >= body.length / 2 && !(header && AVOID_RE.test(header[i])));
    qtyCol = candidates[0];
  }
  const textHits = cols.map((i) => (i === ndcCol || i === qtyCol ? -1 : body.filter((r) => /[A-Za-z]{3,}/.test(r[i])).length));
  let descCol = header ? cols.find((i) => i !== ndcCol && i !== qtyCol && DESC_RE.test(header[i])) : undefined;
  if (descCol === undefined) {
    const best = cols.reduce((b, i) => (textHits[i] > textHits[b] ? i : b), 0);
    descCol = textHits[best] > 0 ? best : undefined;
  }

  const rows = [];
  let skipped = 0;
  for (const r of body) {
    const ndc = parseNdc(r[ndcCol]);
    if (!ndc) { skipped++; continue; }
    const qty = qtyCol === undefined ? null : toNumber(r[qtyCol]);
    rows.push({ ndc, desc: descCol === undefined ? "" : r[descCol], qty, raw: r });
  }
  return { rows, columns: { ndc: ndcCol, qty: qtyCol, desc: descCol }, header, skipped };
}

// Same NDC on several lines (several stores, several months) -> one line, quantities summed.
// A pasted block, for the input grid: full table detection when the paste carries NDCs
// (any column order, header or not), else positional cells so a plain paste still lands.
// Returns rows of {ndc, desc, qty} as the user would type them (NDC dashed, qty as text).
export function pasteToRows(text, startCol = 0) {
  const p = parseTable(text);
  if (p.rows.length) return p.rows.map((r) => ({ ndc: dashed(r.ndc), desc: r.desc, qty: r.qty == null ? "" : String(r.qty) }));
  const cols = ["ndc", "desc", "qty"];
  return String(text).split(/\r?\n/).filter((l) => l.trim()).map((line) => {
    const cells = line.includes("\t") ? line.split("\t") : splitLine(line, line.includes(",") ? "," : "\t");
    const row = { ndc: "", desc: "", qty: "" };
    cells.forEach((c, i) => { const k = cols[startCol + i]; if (k) row[k] = c.trim(); });
    return row;
  });
}

// What a quantity cell holds: "1,240" -> 1240, "" -> null, "abc" -> null.
export function parseQty(value) {
  const t = String(value == null ? "" : value).replace(/[,$\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function aggregate(rows) {
  const by = new Map();
  for (const r of rows) {
    const cur = by.get(r.ndc);
    if (cur) {
      cur.qty = cur.qty === null && r.qty === null ? null : (cur.qty || 0) + (r.qty || 0);
      cur.lines += 1;
      if (!cur.desc && r.desc) cur.desc = r.desc;
    } else by.set(r.ndc, { ndc: r.ndc, desc: r.desc || "", qty: r.qty, lines: 1 });
  }
  return [...by.values()];
}

// --------------------------------------------------------------------------- the join

function entryFor(bundle, ndc) {
  const direct = bundle.entries[ndc];
  if (direct) return { entry: direct, match: "ndc" };
  const sibs = bundle.by_product[ndc.slice(0, 9)] || [];
  if (sibs.length) {
    // Prefer the most serious sibling status, then the most recently updated.
    const rank = { current: 0, to_be_discontinued: 1, discontinued: 2, resolved: 3, other: 4 };
    const best = sibs.map((n) => bundle.entries[n]).sort((a, b) => (rank[a.status_key] - rank[b.status_key]) || (b.updated > a.updated ? 1 : -1))[0];
    return { entry: best, match: "product" };
  }
  return { entry: null, match: null };
}

// Other makers of the same clinical drug that FDA does not list, cheapest NADAC first.
export function sameDrugAlternatives(bundle, scdId, ndc) {
  const scd = bundle.scd[scdId];
  if (!scd) return [];
  return scd.ndcs.filter((x) => x.ndc !== ndc && !AFFECTED.has(x.s) && !x.inactive);
}

// Other strengths of the same drug form (ingredient + dose form), with how short each one is.
export function otherStrengths(bundle, scdId) {
  const scd = bundle.scd[scdId];
  const form = scd && bundle.scdf[scd.scdf];
  if (!form) return [];
  return form.scds.filter((s) => s.rxcui !== scdId);
}

export function classify(bundle, row) {
  const { entry, match } = entryFor(bundle, row.ndc);
  const scdId = (entry && entry.scds && entry.scds[0]) || bundle.ndc_scd[row.ndc] || null;
  const scd = scdId ? bundle.scd[scdId] : null;
  const nadacRow = scd ? scd.ndcs.find((x) => x.ndc === row.ndc) : null;
  let kind = "ok";
  if (entry && AFFECTED.has(entry.status_key)) kind = entry.status_key;        // current | to_be_discontinued | discontinued
  else if (entry && entry.status_key === "resolved") kind = "resolved";
  else if (scd && scd.ndcs.some((x) => x.ndc !== row.ndc && SHORT.has(x.s))) kind = "watch";   // same drug short elsewhere
  const shortElsewhere = scd ? scd.ndcs.filter((x) => x.ndc !== row.ndc && SHORT.has(x.s)).length : 0;
  const priced = nadacRow && nadacRow.nadac != null ? nadacRow : (bundle.nadac && bundle.nadac[row.ndc] ? { nadac: bundle.nadac[row.ndc][0], unit: bundle.nadac[row.ndc][1], desc: "" } : null);
  const nadac = priced ? priced.nadac : null;
  return {
    ...row,
    kind, match, entry, scdId, scdName: scd ? scd.name : "",
    nadac, unit: priced ? priced.unit : "", nadacDesc: priced ? priced.desc : "",
    spend: nadac != null && row.qty != null ? row.qty * nadac : null,
    shortElsewhere,
    alternatives: kind !== "ok" && kind !== "resolved" && scdId ? sameDrugAlternatives(bundle, scdId, row.ndc) : [],
    strengths: kind !== "ok" && kind !== "resolved" && scdId ? otherStrengths(bundle, scdId) : [],
  };
}

// Flagged products first (current and ending together), then same-drug warnings, resolved, the
// rest. Inside a tier, biggest money first: NADAC spend when we can price it, quantity otherwise
// (priced rows ahead of unpriced ones), so the top of the list is what to act on first.
export const KIND_ORDER = { current: 0, to_be_discontinued: 0, discontinued: 0, watch: 1, resolved: 2, ok: 3 };
export const bySize = (a, b) => (a.spend != null) !== (b.spend != null) ? (a.spend != null ? -1 : 1)
  : ((b.spend || 0) - (a.spend || 0)) || ((b.qty || 0) - (a.qty || 0)) || a.ndc.localeCompare(b.ndc);

export function check(bundle, rows) {
  const results = aggregate(rows).map((r) => classify(bundle, r));
  results.sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || bySize(a, b));
  const flagged = results.filter((r) => AFFECTED.has(r.kind));
  const totalQty = results.reduce((n, r) => n + (r.qty || 0), 0);
  const flaggedQty = flagged.reduce((n, r) => n + (r.qty || 0), 0);
  const totalSpend = results.reduce((n, r) => n + (r.spend || 0), 0);
  const flaggedSpend = flagged.reduce((n, r) => n + (r.spend || 0), 0);
  return {
    results,
    summary: {
      products: results.length,
      lines: rows.length,
      current: results.filter((r) => r.kind === "current").length,
      ending: results.filter((r) => r.kind === "to_be_discontinued" || r.kind === "discontinued").length,
      watch: results.filter((r) => r.kind === "watch").length,
      resolved: results.filter((r) => r.kind === "resolved").length,
      withAlternative: flagged.filter((r) => r.alternatives.length).length,
      flaggedQty, totalQty,
      flaggedShare: totalQty ? flaggedQty / totalQty : null,
      flaggedSpend, totalSpend,
      spendShare: totalSpend ? flaggedSpend / totalSpend : null,
      spendKnown: flagged.filter((r) => r.spend != null).length,
      priced: results.filter((r) => r.nadac != null).length,
      flaggedUnpriced: flagged.filter((r) => r.nadac == null).length,
    },
  };
}

// --------------------------------------------------------------------------- formatting

export const fmtInt = (n) => (n == null ? "" : Math.round(n).toLocaleString("en-US"));
export const fmtMoney = (n) => (n == null ? "" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
export const fmtUnit = (n) => (n == null ? "" : n < 1 ? n.toFixed(4) : n.toFixed(2));
export const fmtDate = (s) => {
  if (!s) return "";
  const d = new Date(s + "T00:00:00");
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
export const KIND_LABEL = {
  current: "On FDA's shortage list",
  to_be_discontinued: "Being discontinued",
  discontinued: "Discontinued",
  watch: "Same drug short at other makers",
  resolved: "Shortage resolved",
  ok: "Not on the list",
};
