/* script.js — Emissions Explorer (Interactive)
   Requires: D3 v7+ (no other plotting libs)
   Data: emissions.csv with descriptor columns (e.g., Country, Region, Industry, Gas Type, Unit)
         and quarterly columns named like 2010Q1, 2010Q2, …, 2025Q4.
*/

/* =========================
   Helpers
========================= */
function parseQuarter(q) {
  // "2013Q1" -> Date(2013, 0); we’ll plot at quarter start
  const m = /^(\d{4})Q([1-4])$/.exec(q);
  if (!m) return null;
  const year = +m[1];
  const qIndex = +m[2] - 1;
  const month = qIndex * 3;
  return new Date(Date.UTC(year, month, 1));
}

function fmtNumber(x) {
  return d3.format(",")(Math.round(x));
}

function pct(a, b) {
  if (b === 0 || b == null || !isFinite(b)) return null;
  return (a - b) / b;
}

/* =========================
   Layout config
========================= */
const CFG = {
  topN: 6,                  // how many series to show at once
  margin: {top: 18, right: 20, bottom: 30, left: 68},
  marginOverview: {top: 4, right: 20, bottom: 24, left: 68},
  height: 420,
  heightOverview: 90,
  color: d3.scaleOrdinal(d3.schemeTableau10),
};

const container = d3.select("#viz");
const W = Math.min(1100, document.querySelector(".wrap")?.clientWidth || 1100);

/* =========================
   Boot
========================= */
(async function main() {
  const raw = await d3.csv("emissions.csv");
  // Identify descriptor columns and quarterly columns
  const columns = raw.columns ?? Object.keys(raw[0] ?? {});
  const quarterCols = columns.filter(c => /^\d{4}Q[1-4]$/.test(c)).sort();

  // If Region is missing in your CSV, fall back to Country (works, just less tidy)
  const REGION_COL = columns.includes("Region") ? "Region" : (columns.includes("Country") ? "Country" : null);
  const GROUP_COLS = ["Industry", "Gas Type"].filter(c => columns.includes(c));

  // Long format by row -> [{Region, GroupKey, quarter, value}, ...]
  const long = [];
  for (const row of raw) {
    for (const q of quarterCols) {
      const v = +row[q];
      if (!isFinite(v)) continue;
      long.push({
        region: REGION_COL ? row[REGION_COL] : "All",
        industry: row["Industry"] ?? null,
        gas: row["Gas Type"] ?? null,
        quarter: parseQuarter(q),
        value: v
      });
    }
  }

  // Distinct lists for controls
  const regions = Array.from(new Set(long.map(d => d.region))).sort((a,b) =>
    (a === "World" ? -1 : b === "World" ? 1 : d3.ascending(a,b)));

  // Inject control options
  const regionSelect = d3.select("#regionSelect");
  regionSelect.selectAll("option")
    .data(regions)
    .join("option")
    .attr("value", d => d)
    .text(d => d);

  // Default region
  regionSelect.property("value", regions.includes("World") ? "World" : regions[0]);

  // Group-by selector (limit to columns we actually have)
  const groupBySelect = d3.select("#groupBySelect");
  const availableGroupChoices = Array.from(groupBySelect.selectAll("option").nodes())
    .map(n => n.value)
    .filter(v => (v === "Industry" && GROUP_COLS.includes("Industry")) ||
                 (v === "Gas Type" && GROUP_COLS.includes("Gas Type")));
  groupBySelect.selectAll("option").each(function() {
    if (!availableGroupChoices.includes(this.value)) this.remove();
  });

  // If only one is available, lock it
  if (availableGroupChoices.length === 1) groupBySelect.property("value", availableGroupChoices[0]);

  const metricSelect = d3.select("#metricSelect");

  // Build SVGs
  container.selectAll("*").remove();
  const svg = container.append("svg")
    .attr("width", W)
    .attr("height", CFG.height + CFG.heightOverview + CFG.margin.top + CFG.margin.bottom + 46);

  const gMain = svg.append("g").attr("transform", `translate(${CFG.margin.left},${CFG.margin.top})`);
  const gOverview = svg.append("g").attr("transform",
    `translate(${CFG.marginOverview.left},${CFG.margin.top + CFG.height + 32})`);

  const innerW = W - CFG.margin.left - CFG.margin.right;
  const innerWOverview = W - CFG.marginOverview.left - CFG.marginOverview.right;
  const innerH = CFG.height - CFG.margin.top - 10; // padding under title line
  const innerHOverview = CFG.heightOverview - CFG.marginOverview.top - CFG.marginOverview.bottom;

  // Scales
  const x = d3.scaleUtc().range([0, innerW]);
  const xOverview = d3.scaleUtc().range([0, innerWOverview]);

  const y = d3.scaleLinear().range([innerH, 0]);
  const yOverview = d3.scaleLinear().range([innerHOverview, 0]);

  const area = d3.area()
    .x(d => x(d.data.quarter))
    .y0(d => y(d[0]))
    .y1(d => y(d[1]));

  const areaOverview = d3.area()
    .x(d => xOverview(d.data.quarter))
    .y0(d => yOverview(d[0]))
    .y1(d => yOverview(d[1]));

  const xAxis = gMain.append("g").attr("transform", `translate(0,${innerH})`);
  const yAxis = gMain.append("g");

  const mainClipId = "clipMain";
  svg.append("clipPath").attr("id", mainClipId)
    .append("rect").attr("x", CFG.margin.left).attr("y", CFG.margin.top)
    .attr("width", innerW).attr("height", innerH);

  const gSeries = gMain.append("g").attr("clip-path", `url(#${mainClipId})`);
  const gLegend = gMain.append("g").attr("transform", "translate(0,-8)");

  const brush = d3.brushX()
    .extent([[0, 0], [innerWOverview, innerHOverview]])
    .on("brush end", brushed);

  const gBrush = gOverview.append("g").attr("class", "brush");

  const tooltip = d3.select("body").append("div")
    .attr("id", "tooltip")
    .style("position","fixed")
    .style("pointer-events","none")
    .style("padding",".35rem .5rem")
    .style("border","1px solid #222735")
    .style("border-radius","6px")
    .style("background","#0f1220")
    .style("color","#e8eaed")
    .style("font-size",".9rem")
    .style("display","none");

  // Render initial state
  update();

  // Wire controls
  regionSelect.on("change", update);
  groupBySelect.on("change", update);
  metricSelect.on("change", update);

  function update() {
    const region = regionSelect.property("value");
    const groupBy = groupBySelect.property("value"); // "Industry" or "Gas Type"
    const metric = metricSelect.property("value");   // "absolute" or "pct_change"

    // Filter: region
    let data = long.filter(d => d.region === region);

    // Roll up by group & quarter
    const seriesByGroup = d3.rollup(
      data,
      v => d3.sum(v, d => d.value),
      d => d[groupBy === "Industry" ? "industry" : "gas"],
      d => +d.quarter
    );

    // Build a tidy array: [{group, values:[{quarter, value, base2010}, ...]}]
    let groups = [];
    for (const [group, mapByQuarter] of seriesByGroup) {
      const arr = Array.from(mapByQuarter, ([ts, val]) => ({ quarter: new Date(+ts), value: val }))
        .sort((a,b) => a.quarter - b.quarter);
      if (!arr.length) continue;
      const base = arr[0].value; // first quarter in the filtered span (2010Q1)
      for (const d of arr) d.pct = pct(d.value, base);
      groups.push({ key: group ?? "Unspecified", values: arr, base });
    }

    // Rank groups by latest absolute value (or by latest magnitude in pct mode)
    groups.forEach(g => g.latest = g.values[g.values.length - 1]);
    groups.sort((a,b) => {
      const va = (metric === "absolute") ? a.latest.value : Math.abs(a.latest.pct ?? 0);
      const vb = (metric === "absolute") ? b.latest.value : Math.abs(b.latest.pct ?? 0);
      return d3.descending(va, vb);
    });

    // Limit to Top N and compute stack input (matrix by quarter × group)
    const top = groups.slice(0, CFG.topN);
    const quarters = top[0]?.values.map(d => d.quarter) ?? [];

    // Transform to stacked shape
    const stackInput = quarters.map(q => {
      const row = { quarter: q };
      for (const g of top) {
        const v = g.values.find(d => +d.quarter === +q);
        row[g.key] = (metric === "absolute") ? (v?.value ?? 0)
                                             : ((v?.pct ?? 0) * 100); // percent points
      }
      return row;
    });

    const keys = top.map(d => d.key);
    CFG.color.domain(keys);

    const stack = d3.stack().keys(keys).order(d3.stackOrderNone).offset(d3.stackOffsetNone);
    const layers = stack(stackInput);

    // Domains
    x.domain(d3.extent(quarters));
    xOverview.domain(x.domain());

    // y domain based on stacked sums
    const maxY = d3.max(layers[layers.length - 1], d => d[1]);
    const minY = Math.min(0, d3.min(layers[0], d => d[0]));
    y.domain([minY, maxY]).nice();
    yOverview.domain(y.domain());

    // MAIN STACK
    const gAreas = gSeries.selectAll(".layer")
      .data(layers, d => d.key);

    gAreas.enter().append("path")
        .attr("class", "layer")
        .attr("fill", d => CFG.color(d.key))
        .attr("opacity", 0.9)
      .merge(gAreas)
        .attr("d", area);

    gAreas.exit().remove();

    // Axes
    xAxis.call(d3.axisBottom(x).ticks(W < 700 ? 6 : 10));
    yAxis.call(d3.axisLeft(y).ticks(6).tickFormat(d => metric === "absolute" ? fmtNumber(d) : d + "%"))
      .call(g => g.selectAll("text").attr("dy","0.35em"));

    // OVERVIEW
    gOverview.selectAll("*:not(.brush)").remove();
    const layerOv = gOverview.selectAll(".ov")
      .data(layers, d => d.key)
      .join("path")
      .attr("class","ov")
      .attr("fill", d => CFG.color(d.key))
      .attr("opacity", 0.6)
      .attr("d", areaOverview);

    gOverview.append("g")
      .attr("transform", `translate(0,${innerHOverview})`)
      .call(d3.axisBottom(xOverview).ticks(W < 700 ? 6 : 10));

    gOverview.append("g").call(d3.axisLeft(yOverview).ticks(3).tickFormat(() => ""));

    // Brush with default window (last 5 years)
    const lastYears = 5;
    const x0 = xOverview(quarters[quarters.length - 1 - Math.min(quarters.length - 1, lastYears * 4)] ?? quarters[0]);
    const x1 = xOverview(quarters[quarters.length - 1] ?? quarters[0]);
    gBrush.call(brush).call(brush.move, [x0, x1]);

    // LEGEND (click to toggle)
    renderLegend(top.map(d => d.key), metric);

    // Hover interaction (details on demand)
    addHoverInteraction(stackInput, keys, metric);
  }

  function brushed({selection}) {
    if (!selection) return;
    const [x0, x1] = selection.map(xOverview.invert);
    x.domain([x0, x1]);
    gSeries.selectAll(".layer").attr("d", d3.area()
      .x(dd => x(dd.data.quarter))
      .y0(dd => y(dd[0]))
      .y1(dd => y(dd[1])));
    d3.select(gMain.node()).select("g").call(d3.axisBottom(x).ticks(W < 700 ? 6 : 10))
      .attr("transform", `translate(0,${CFG.height - CFG.margin.top - 10})`);
  }

  function renderLegend(keys, metric) {
    gLegend.selectAll("*").remove();
    const items = gLegend.selectAll("g.leg")
      .data(keys)
      .join("g")
      .attr("class","leg")
      .attr("transform",(d,i)=>`translate(${i*180},0)`)
      .style("cursor","pointer")
      .on("click", (_, key) => {
        // toggle visibility
        const sel = gSeries.selectAll(".layer");
        sel.filter(d => d.key === key)
          .transition().duration(200)
          .attr("opacity", function() {
            const curr = +d3.select(this).attr("opacity");
            return curr < 0.4 ? 0.9 : 0.2;
          });
      });

    items.append("rect").attr("width",12).attr("height",12).attr("y",-12)
      .attr("fill", d => CFG.color(d));
    items.append("text").attr("x",16).attr("y",-2).text(d => d)
      .attr("fill","#aab2bd").attr("font-size",".9rem");
  }

  function addHoverInteraction(stackInput, keys, metric) {
    // Build a bisector for the x position
    const bisect = d3.bisector(d => d.quarter).left;

    // Transparent hover rect
    const hover = gSeries.selectAll("rect.hover").data([null]).join("rect")
      .attr("class","hover")
      .attr("x",0).attr("y",0)
      .attr("width", innerW).attr("height", innerH)
      .attr("fill","transparent")
      .on("mousemove", (event) => {
        const xm = d3.pointer(event, gSeries.node())[0];
        const t = x.invert(xm);
        const i = Math.min(stackInput.length - 1, Math.max(0, bisect(stackInput, t)));
        const row = stackInput[i];

        // Collect values by key for tooltip
        const lines = keys.map(k => {
          const val = row[k];
          return {
            key: k,
            val: (metric === "absolute") ? fmtNumber(val) : d3.format(".1f")(val) + "%"
          };
        }).sort((a,b) => d3.descending(+row[a.key], +row[b.key]));

        tooltip
          .style("display","block")
          .style("left", (event.clientX + 16) + "px")
          .style("top", (event.clientY + 16) + "px")
          .html([
            `<div style="opacity:.85">${row.quarter.getUTCFullYear()} Q${(row.quarter.getUTCMonth()/3)+1}</div>`,
            `<div style="margin-top:.25rem">${lines.map(l =>
              `<div><span style="display:inline-block;width:.8rem;height:.8rem;background:${CFG.color(l.key)};margin-right:.4rem;border-radius:2px"></span>${l.key}: <strong>${l.val}</strong></div>`
            ).join("")}</div>`
          ].join(""));
      })
      .on("mouseleave", () => tooltip.style("display","none"));
  }

})();
