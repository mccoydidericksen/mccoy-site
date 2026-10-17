// Drug shortage check page. Logic lives in shortage-lib.js; this file is the DOM.
import { AFFECTED, KIND_LABEL, check, dashed, fmtDate, fmtInt, fmtMoney, fmtUnit, parseNdc, parseQty, parseTable, pasteToRows } from "/scruple/assets/shortage-lib.js";

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (v != null) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) n.append(k instanceof Node ? k : String(k));
  return n;
};

let bundle = null;
let sampleMode = false;

async function loadBundle() {
  if (bundle) return bundle;
  const r = await fetch("/scruple/data/shortage-bundle.json", { cache: "no-cache" });
  if (!r.ok) throw new Error(`data file ${r.status}`);
  bundle = await r.json();
  $("src-fda").textContent = bundle.fda_fetched_at ? `${fmtInt(bundle.fda_records)} records, fetched ${fmtDate(bundle.fda_fetched_at.slice(0, 10))}` : "updated daily";
  $("src-nadac").textContent = bundle.nadac_as_of ? `as of ${fmtDate(bundle.nadac_as_of)}` : "weekly";
  return bundle;
}

function setMsg(text, err = false) {
  const m = $("msg");
  m.textContent = text;
  m.classList.toggle("err", err);
}

async function run({ sample = false } = {}) {
  sampleMode = sample;
  setMsg("Checking…");
  try {
    const b = await loadBundle();
    const { rows, bad } = gridRows();
    if (!rows.length) {
      setMsg(bad ? `No valid NDCs yet. ${bad} row${bad === 1 ? "" : "s"} ha${bad === 1 ? "s" : "ve"} something that isn't an 11-digit NDC (dashes are fine).` : "Enter or paste a few products first.", true);
      $("results").hidden = true;
      return;
    }
    const out = check(b, rows);
    render(out);
    const qtyNote = rows.every((r) => r.qty == null) ? " No quantities, so products are listed in your order." : "";
    const badNote = bad ? ` ${bad} row${bad === 1 ? "" : "s"} skipped (not an NDC).` : "";
    setMsg(`${fmtInt(out.summary.products)} products from ${fmtInt(rows.length)} rows.${qtyNote}${badNote}`);
  } catch (e) {
    setMsg(`Couldn't run the check: ${e.message}`, true);
  }
}

const pct = (x) => (x < 0.01 && x > 0 ? "<1%" : `${Math.round(x * 100)}%`);
const unitWord = (u) => (u === "ML" ? "mL" : u === "GM" ? "g" : "units");

function tile(n, label, hot, small) {
  return el("div", { class: `sc-tile${hot && n ? " hot" : ""}` }, el("b", {}, fmtInt(n)), el("span", {}, label), small ? el("small", {}, small) : "");
}

function render(out) {
  const { results, summary: s } = out;
  $("results").hidden = false;
  $("stamp").hidden = !sampleMode;

  const tiles = $("tiles");
  tiles.replaceChildren(
    tile(s.products, "products checked", false, s.lines !== s.products ? `${fmtInt(s.lines)} lines, same NDCs added up` : ""),
    tile(s.current, "on FDA's shortage list", true),
    tile(s.ending, "discontinued or ending", true, s.spendShare != null && (s.current || s.ending) ? `together ${fmtMoney(s.flaggedSpend)} at NADAC, ${pct(s.spendShare)} of what you listed` : s.flaggedShare != null && (s.current || s.ending) ? `${pct(s.flaggedShare)} of your quantity` : ""),
    tile(s.watch, "same drug short at other makers", false, s.watch ? "yours isn't listed, others are" : ""),
  );

  // Where to start: the flagged products you dispense most, with an alternative when there is one.
  const first = results.filter((r) => AFFECTED.has(r.kind)).slice(0, 3);
  $("first").hidden = !first.length;
  $("first-list").replaceChildren(...first.map((r, i) => {
    const alt = r.alternatives[0];
    const what = r.kind === "current" ? "is on FDA's shortage list" : r.kind === "discontinued" ? "is discontinued" : "is being discontinued";
    const why = [];
    if (r.entry.reason) why.push(r.entry.reason.replace(/\.$/, ""));
    if (r.entry.availability && r.entry.availability.length > 14) why.push(r.entry.availability.replace(/\.$/, ""));   // skip a bare "Available"
    let next;
    if (alt) {
      const diff = alt.nadac != null && r.nadac != null ? alt.nadac / r.nadac - 1 : null;
      const price = diff == null ? "" : Math.abs(diff) < 0.02 ? ", same price" : diff < 0 ? `, about ${Math.round(-diff * 100)}% less` : `, about ${Math.round(diff * 100)}% more`;
      const more = r.alternatives.length > 1 ? ` ${r.alternatives.length - 1} more maker${r.alternatives.length > 2 ? "s" : ""} below.` : "";
      next = `Same drug, another maker, not on FDA's list: ${dashed(alt.ndc)}${alt.nadac != null ? ` at $${fmtUnit(alt.nadac)} per ${alt.unit || "unit"} (NADAC)${price}` : ""}.${more}`;
    } else if (r.strengths.some((x) => x.n_short === 0 && x.n_ndc)) {
      const st = r.strengths.filter((x) => x.n_short === 0 && x.n_ndc).map((x) => x.name.replace(/^.*?(\d[\d.]* ?(MG|MCG|ML|G|UNT|%)[^ ]*).*$/i, "$1")).slice(0, 3).join(", ");
      next = `No other maker of this exact strength is clear, but these strengths are: ${st}. A prescriber would have to change the sig.`;
    } else {
      next = "No other NDC of this drug is clear of the list. Worth a call to the wholesaler and the prescribers who write it most.";
    }
    return el("li", {},
      el("span", { class: "ledger-n" }, String(i + 1)),
      el("div", {},
        el("p", {}, el("b", {}, r.desc || r.nadacDesc || r.entry.generic), ` ${what}`, r.qty != null ? ` and you dispensed ${fmtInt(r.qty)} ${unitWord(r.unit)} in the period${r.spend != null ? `, about ${fmtMoney(r.spend)} at NADAC` : ""}.` : "."),
        why.length ? el("p", { class: "why" }, `FDA: ${why.join("; ")}.`) : "",
        el("p", { class: "why" }, next),
      ));
  }));

  // The table.
  const tbody = $("tbody");
  tbody.replaceChildren(...results.map(rowEl));
  applyFilter();
  const unpriced = results.length - s.priced;
  $("unpriced").textContent = unpriced ? `${fmtInt(unpriced)} of your ${fmtInt(results.length)} products have no NADAC price (NDCs CMS doesn't survey: some brands, OTC, supplies), so "At NADAC" is blank for them${s.flaggedUnpriced ? `, including ${fmtInt(s.flaggedUnpriced)} flagged above` : ""}.` : "";
  $("results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function rowEl(r) {
  const tr = el("tr", { class: r.kind });
  const name = r.desc || r.nadacDesc || (r.entry && r.entry.generic) || "";
  tr.append(el("td", { class: "drug" }, el("b", {}, name), el("span", { class: "ndc" }, dashed(r.ndc))));
  tr.append(el("td", { class: "num" }, r.qty == null ? "" : fmtInt(r.qty)));

  const pill = el("span", { class: `pill ${r.kind}` }, KIND_LABEL[r.kind]);
  const subs = [];
  if (r.match === "product") subs.push("listed for another package size of this product");
  if (r.kind === "watch") subs.push(`${r.shortElsewhere} other NDC${r.shortElsewhere === 1 ? "" : "s"} of ${r.scdName}`);
  if (r.entry && AFFECTED.has(r.kind) && r.entry.company) subs.push(r.entry.company);
  if (r.kind === "resolved" && r.entry.resolved_note) subs.push(r.entry.resolved_note);
  tr.append(el("td", {}, pill, subs.length ? el("span", { class: "pill-sub" }, subs.join(" · ")) : ""));

  const since = r.entry && AFFECTED.has(r.kind) ? (r.entry.posted || r.entry.updated) : r.kind === "resolved" ? r.entry.updated : "";
  tr.append(el("td", { class: "since" }, since ? fmtDate(since) : ""));
  tr.append(el("td", { class: "num" }, r.spend == null ? "" : fmtMoney(r.spend)));
  tr.append(el("td", {}, altCell(r)));
  return tr;
}

function altCell(r) {
  if (!AFFECTED.has(r.kind) && r.kind !== "watch") return "";
  const d = el("details", { class: "sc-alt" });
  const n = r.alternatives.length;
  const strengthsClear = r.strengths.filter((x) => x.n_ndc && x.n_short === 0).length;
  const label = r.kind === "watch" ? "FDA note and other makers" : n ? `${n} other maker${n === 1 ? "" : "s"} not listed` : strengthsClear ? `other strengths only` : "none clear";
  d.append(el("summary", { class: n || strengthsClear ? "" : "none" }, label));
  const body = el("div", { class: "sc-alt-body" });
  if (r.entry) {
    const bits = [];
    if (r.entry.presentation) bits.push(r.entry.presentation);
    if (r.entry.reason) bits.push(`Reason: ${r.entry.reason}`);
    if (r.entry.availability) bits.push(`Availability: ${r.entry.availability}`);
    if (r.entry.related) bits.push(r.entry.related);
    if (r.entry.discontinued) bits.push(`Discontinued ${fmtDate(r.entry.discontinued)}`);
    if (bits.length) body.append(el("p", {}, `FDA (${r.entry.company || "manufacturer"}, updated ${fmtDate(r.entry.updated)}): ${bits.join(". ")}`));
  }
  if (r.scdName) body.append(el("p", {}, `Clinical drug: ${r.scdName}`));
  if (r.alternatives.length) {
    const t = el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Same drug, other makers"), el("th", {}, "NDC"), el("th", {}, "NADAC / unit"))));
    const tb = el("tbody");
    for (const a of r.alternatives.slice(0, 8)) {
      tb.append(el("tr", {}, el("td", {}, a.desc || "(no NADAC description)"), el("td", { class: "mono" }, dashed(a.ndc)),
        el("td", { class: "mono" }, a.nadac != null ? `${fmtUnit(a.nadac)} ${a.unit || ""}` : "")));
    }
    if (r.alternatives.length > 8) tb.append(el("tr", {}, el("td", { colspan: 3 }, `and ${r.alternatives.length - 8} more`)));
    t.append(tb);
    body.append(t);
  } else if (r.scdId && r.kind !== "watch") {
    body.append(el("p", {}, "Every other maker of this exact strength is on the list too, or NADAC has no active NDC for it."));
  }
  if (r.strengths.length) {
    const t = el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Other strengths of this form"), el("th", {}, "NDCs"), el("th", {}, "Short"), el("th", {}, "Lowest NADAC"))));
    const tb = el("tbody");
    for (const x of r.strengths.slice(0, 10)) {
      tb.append(el("tr", {}, el("td", {}, x.name), el("td", { class: "mono" }, String(x.n_ndc)),
        el("td", { class: `mono${x.n_short ? " short" : ""}` }, x.n_short ? `${x.n_short} of ${x.n_ndc}` : "none"),
        el("td", { class: "mono" }, x.min_nadac != null ? `${fmtUnit(x.min_nadac)} ${x.unit || ""}` : "")));
    }
    t.append(tb);
    body.append(t);
  }
  d.append(body);
  return d;
}

function applyFilter() {
  const only = $("only-flagged").checked;
  for (const tr of $("tbody").children) tr.classList.toggle("hidden-ok", only && tr.classList.contains("ok"));
}

// ----------------------------------------------------------------------------- the input grid
// A small spreadsheet: NDC | Drug | Quantity. Typing keeps one blank row below; Enter moves down;
// a multi-line paste is parsed like a file (any column order) and fills the rows from the cursor.
const COLS = ["ndc", "desc", "qty"];
const PLACEHOLDER = { ndc: "00093-0150-01", desc: "Lisinopril 10 mg tab", qty: "1,240" };
const MAX_GRID_ROWS = 2000;
const gridBody = $("gridbody");

function makeRow(values = {}) {
  const tr = el("tr", {});
  tr.append(el("td", { class: "n" }, ""));
  for (const col of COLS) {
    const input = el("input", { type: "text", "data-col": col, spellcheck: "false", autocomplete: "off",
      inputmode: col === "qty" ? "numeric" : col === "ndc" ? "numeric" : null });
    input.value = values[col] == null ? "" : String(values[col]);
    tr.append(el("td", {}, input));
  }
  return tr;
}

function rowValues(tr) {
  const v = {};
  for (const input of tr.querySelectorAll("input")) v[input.dataset.col] = input.value;
  return v;
}

const rowIsBlank = (tr) => Object.values(rowValues(tr)).every((x) => !x.trim());

function renumber() {
  const rows = [...gridBody.children];
  rows.forEach((tr, i) => {
    tr.firstChild.textContent = String(i + 1);
    validateRow(tr);
    // Only the first row shows what goes where; placeholders on every row read as data.
    for (const input of tr.querySelectorAll("input")) input.placeholder = i === 0 ? PLACEHOLDER[input.dataset.col] : "";
  });
  const filled = rows.filter((tr) => !rowIsBlank(tr)).length;
  $("rowcount").textContent = filled ? `${fmtInt(filled)} product${filled === 1 ? "" : "s"}` : "";
  $("clear").hidden = !filled;
}

function validateRow(tr) {
  const ndc = tr.querySelector('input[data-col="ndc"]');
  ndc.parentElement.classList.toggle("bad", !!ndc.value.trim() && !parseNdc(ndc.value));
  const qty = tr.querySelector('input[data-col="qty"]');
  qty.parentElement.classList.toggle("bad", !!qty.value.trim() && parseQty(qty.value) == null);
}

function ensureTrailingBlank() {
  const last = gridBody.lastElementChild;
  if (!last || !rowIsBlank(last)) gridBody.append(makeRow());
  renumber();
}

function setGrid(rows, { blanks = 8 } = {}) {
  gridBody.replaceChildren();
  const shown = rows.slice(0, MAX_GRID_ROWS);
  for (const r of shown) gridBody.append(makeRow(r));
  for (let i = shown.length; i < blanks; i++) gridBody.append(makeRow());
  ensureTrailingBlank();
  gridBody.dataset.overflow = rows.length > MAX_GRID_ROWS ? String(rows.length - MAX_GRID_ROWS) : "";
}

// Rows for check(): 11-digit NDC, quantity as a number or null; counts rows that have an NDC we can't read.
function gridRows() {
  const rows = [];
  let bad = 0;
  for (const tr of gridBody.children) {
    const v = rowValues(tr);
    if (!v.ndc.trim()) { if (v.desc.trim() || v.qty.trim()) bad++; continue; }
    const ndc = parseNdc(v.ndc);
    if (!ndc) { bad++; continue; }
    rows.push({ ndc, desc: v.desc.trim(), qty: parseQty(v.qty), raw: [v.ndc, v.desc, v.qty] });
  }
  return { rows, bad };
}

function focusCell(tr, col, select = false) {
  const input = tr && tr.querySelector(`input[data-col="${col}"]`);
  if (!input) return;
  input.focus();
  if (select) input.select();
}

gridBody.addEventListener("input", () => ensureTrailingBlank());
gridBody.addEventListener("keydown", (e) => {
  const input = e.target;
  if (!(input instanceof HTMLInputElement)) return;
  const tr = input.closest("tr");
  const col = input.dataset.col;
  if (e.key === "Enter" || e.key === "ArrowDown") {
    e.preventDefault();
    if (!tr.nextElementSibling) gridBody.append(makeRow());
    focusCell(tr.nextElementSibling, col, true);
    renumber();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    focusCell(tr.previousElementSibling, col, true);
  } else if (e.key === "Backspace" && !input.value && rowIsBlank(tr) && tr.previousElementSibling && gridBody.children.length > 1) {
    e.preventDefault();
    const prev = tr.previousElementSibling;
    tr.remove();
    focusCell(prev, col);
    renumber();
  }
});
gridBody.addEventListener("paste", (e) => {
  const input = e.target;
  if (!(input instanceof HTMLInputElement)) return;
  const text = (e.clipboardData || window.clipboardData).getData("text");
  if (!/[\t\r\n]/.test(text.trim())) return;                 // a single value: let the browser paste it
  e.preventDefault();
  const startCol = COLS.indexOf(input.dataset.col);
  const rows = pasteToRows(text, startCol);
  let tr = input.closest("tr");
  for (const r of rows) {
    if (!tr) { tr = makeRow(); gridBody.append(tr); }
    for (const input2 of tr.querySelectorAll("input")) input2.value = r[input2.dataset.col] || "";
    tr = tr.nextElementSibling;
  }
  ensureTrailingBlank();
  setMsg(`${fmtInt(rows.length)} row${rows.length === 1 ? "" : "s"} pasted. Check the list when it looks right.`);
});

// ----------------------------------------------------------------------------- wiring
$("check").addEventListener("click", () => run());
$("clear").addEventListener("click", () => { setGrid([]); $("results").hidden = true; setMsg(""); focusCell(gridBody.firstElementChild, "ndc"); });
$("only-flagged").addEventListener("change", applyFilter);
$("file").addEventListener("change", async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const text = await f.text();
  const parsed = parseTable(text);
  if (!parsed.rows.length) { setMsg(`No NDCs found in ${f.name}. We look for an 11-digit NDC column (dashes are fine).`, true); return; }
  setGrid(parsed.rows.map((r) => ({ ndc: dashed(r.ndc), desc: r.desc, qty: r.qty == null ? "" : String(r.qty) })), { blanks: 0 });
  run();
  e.target.value = "";
});
$("sample").addEventListener("click", async () => {
  setMsg("Loading the sample…");
  try {
    const r = await fetch("/scruple/data/shortage-sample.csv", { cache: "no-cache" });
    const parsed = parseTable(await r.text());
    setGrid(parsed.rows.map((x) => ({ ndc: dashed(x.ndc), desc: x.desc, qty: x.qty == null ? "" : String(x.qty) })), { blanks: 0 });
    run({ sample: true });
  } catch (e) { setMsg(`Couldn't load the sample: ${e.message}`, true); }
});
for (const b of document.querySelectorAll(".sc-tip")) {
  b.addEventListener("click", () => {
    const box = $("tipbox");
    const open = b.getAttribute("aria-expanded") === "true";
    for (const x of document.querySelectorAll(".sc-tip")) x.setAttribute("aria-expanded", "false");
    for (const d of box.children) d.hidden = true;
    if (open) { box.hidden = true; return; }
    b.setAttribute("aria-expanded", "true");
    box.querySelector(`[data-for="${b.dataset.tip}"]`).hidden = false;
    box.hidden = false;
  });
}
setGrid([]);
loadBundle().catch(() => {});
if (location.hash === "#sample") $("sample").click();
