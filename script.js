// script.js — Emissions Explorer (robust region detection + safe total filtering)
(function() {
  const container = d3.select("#viz");
  if (container.empty()) return;

  function getWidth() {
    const wrap = document.querySelector(".wrap");
    const w = wrap ? wrap.clientWidth : container.node().clientWidth || window.innerWidth;
    return Math.min(1100, Math.max(640, w || 800));
  }

  // Stable string -> HSL mapping (namespaced by group-by)
  const colorCache = new Map();
  function hash32(str){
    let h = 2166136261 >>> 0;
    for (let i=0; i<str.length; i++){
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function colorFor(groupBy, key){
    const K = groupBy + "::" + key;
    if (colorCache.has(K)) return colorCache.get(K);
    const h = hash32(K) % 360;
    const s = 62;
    const l = 56;
    const c = `hsl(${h}, ${s}%, ${l}%)`;
    colorCache.set(K, c);
    return c;
  }

  const CFG = {
    topN: 6,
    margin: {top: 20, right: 18, bottom: 32, left: 72},
    marginOverview: {top: 4, right: 18, bottom: 24, left: 72},
    height: 420,
    heightOverview: 90,
    MAX_PCT: 300,
    EXCLUDE_TOTAL_RE: /(total|all|overall|aggregate|summary)/i,
    EXCLUDE_GAS_RE: /^(greenhouse\s*gas|total|all|overall|aggregate|summary)$/i
  };

  const W = getWidth();
  const svg = container.append("svg")
    .attr("width", W)
    .attr("height", CFG.height + CFG.heightOverview + CFG.margin.top + CFG.margin.bottom + 50);

  const gMain = svg.append("g").attr("transform", `translate(${CFG.margin.left},${CFG.margin.top})`);
  const gOverview = svg.append("g").attr("transform", `translate(${CFG.marginOverview.left},${CFG.margin.top + CFG.height + 34})`);

  const innerW = W - CFG.margin.left - CFG.margin.right;
  const innerWOverview = W - CFG.marginOverview.left - CFG.marginOverview.right;
  const innerH = CFG.height - CFG.margin.top + 6;
  const innerHOverview = CFG.heightOverview - CFG.marginOverview.top - CFG.marginOverview.bottom;

  const x = d3.scaleUtc().range([0, innerW]);
  const xOverview = d3.scaleUtc().range([0, innerWOverview]);
  const y = d3.scaleLinear().range([innerH, 0]);
  const yOverview = d3.scaleLinear().range([innerHOverview, 0]);

  const area = d3.area()
      .defined(d => isFinite(d[0]) && isFinite(d[1]))
      .x(d => x(d.data.quarter))
      .y0(d => y(d[0]))
      .y1(d => y(d[1]));

  const areaOverview = d3.area()
      .defined(d => isFinite(d[0]) && isFinite(d[1]))
      .x(d => xOverview(d.data.quarter))
      .y0(d => yOverview(d[0]))
      .y1(d => yOverview(d[1]));

  const xAxisG = gMain.append("g").attr("transform", `translate(0,${innerH})`);
  const yAxisG = gMain.append("g");

  const clipId = "clipMain";
  svg.append("clipPath").attr("id", clipId)
     .append("rect").attr("x", CFG.margin.left).attr("y", CFG.margin.top)
     .attr("width", innerW).attr("height", innerH);

  const gSeries = gMain.append("g").attr("clip-path", `url(#${clipId})`);
  const gLegend = gMain.append("g").attr("transform", "translate(0,-10)");

  const tooltip = d3.select("#tooltip").empty()
    ? d3.select("body").append("div").attr("id","tooltip") : d3.select("#tooltip");

  function parseQuarter(q) {
    const m = /^([0-9]{4})Q([1-4])$/.exec(q);
    if (!m) return null;
    const year = +m[1], qIdx = +m[2]-1, month = qIdx*3;
    return new Date(Date.UTC(year, month, 1));
  }
  function pct(a,b){ return (b===0||b==null)? null : (a-b)/b; }

  const regionSelect = d3.select("#regionSelect");
  const groupBySelect = d3.select("#groupBySelect");
  const metricSelect = d3.select("#metricSelect");

  d3.csv("./emissions.csv").then(raw => {
    if (!raw || !raw.length) throw new Error("No rows in emissions.csv");

    const cols = raw.columns || Object.keys(raw[0]);
    const quarterCols = cols.filter(c => /^\\d{4}Q[1-4]$/.test(c)).sort();

    // Robust region column detection
    const regionCandidates = ["Country","Region","Region Name","Area","Location"];
    let REGION_COL = null;
    for (const c of regionCandidates) if (cols.includes(c)) { REGION_COL = c; break; }
    if (!REGION_COL) throw new Error("Missing region/country column");

    const HAVE_INDUSTRY = cols.includes("Industry");
    const HAVE_GAS = cols.includes("Gas Type");

    const regions = Array.from(new Set(raw.map(r => (r[REGION_COL]||"").trim())))
      .sort((a,b) => (a==="World"? -1 : b==="World"? 1 : d3.ascending(a,b)));

    regionSelect.selectAll("option").data(regions, d=>d).join("option")
      .attr("value", d => d).text(d => d);
    regionSelect.property("value", regions.indexOf("World")>=0 ? "World" : regions[0]);

    groupBySelect.selectAll("option").each(function() {
      const v = this.value;
      if ((v==="Industry" && !HAVE_INDUSTRY) || (v==="Gas Type" && !HAVE_GAS)) this.remove();
    });
    if (groupBySelect.selectAll("option").size()===1) {
      groupBySelect.property("value", groupBySelect.select("option").attr("value"));
    }

    // Long format
    const long = [];
    for (const row of raw) {
      for (const q of quarterCols) {
        const v = +row[q];
        if (!isFinite(v)) continue;
        const dt = parseQuarter(q);
        if (!dt) continue;
        long.push({
          region: (row[REGION_COL]||"").trim(),
          industry: (row["Industry"]||"").trim() || null,
          gas: (row["Gas Type"]||"").trim() || null,
          quarter: dt,
          value: v
        });
      }
    }

    const brush = d3.brushX()
      .extent([[0,0], [innerWOverview, innerHOverview]])
      .on("brush end", brushed);

    const gBrush = gOverview.append("g").attr("class","brush");

    function firstNonZero(arr){
      for (let i=0;i<arr.length;i++){
        if (arr[i] && isFinite(arr[i].value) && Math.abs(arr[i].value) > 0) return +arr[i].value;
      }
      return 1;
    }

    function update() {
      const region = (regionSelect.property("value") || "").trim();
      const groupBy = groupBySelect.property("value");
      const metric = metricSelect.property("value");

      const data = long.filter(d => d.region === region);
      if (!data.length) return clearViz("No data for this selection.");

      const keyAccessor = (d) => (groupBy === "Industry" ? d.industry : d.gas);

      // Build map -> if after excluding totals we get zero series, we keep totals
      const groupedRaw = d3.rollup(
        data,
        v => d3.sum(v, d => d.value),
        d => keyAccessor(d),
        d => +d.quarter
      );

      function buildSeries(excludeTotals){
        const out = [];
        groupedRaw.forEach((byQ, keyRaw) => {
          let key = keyRaw || "Unspecified";
          if (excludeTotals) {
            if (groupBy === "Industry" && CFG.EXCLUDE_TOTAL_RE.test(String(key))) return;
            if (groupBy === "Gas Type" && CFG.EXCLUDE_GAS_RE.test(String(key))) return;
          }
          const arr = Array.from(byQ, ([ts, val]) => ({ quarter: new Date(+ts), value: +val }))
                          .sort((a,b)=>a.quarter-b.quarter);
          if (!arr.length) return;
          const base = firstNonZero(arr);
          arr.forEach(d => {
            const p = pct(d.value, base);
            let pctVal = p==null || !isFinite(p) ? 0 : p*100;
            if (pctVal > CFG.MAX_PCT) pctVal = CFG.MAX_PCT;
            if (pctVal < -CFG.MAX_PCT) pctVal = -CFG.MAX_PCT;
            d.pct = pctVal/100;
          });
          out.push({ key, values: arr, latest: arr[arr.length-1] });
        });
        return out;
      }

      let series = buildSeries(true);
      if (!series.length) series = buildSeries(false); // fallback: allow totals to avoid empty

      if (!series.length) return clearViz("No series available.");

      // Rank & TopN
      series.sort((a,b) => {
        const va = (metric==="absolute") ? a.latest.value : Math.abs(a.latest.pct || 0);
        const vb = (metric==="absolute") ? b.latest.value : Math.abs(b.latest.pct || 0);
        return d3.descending(va, vb);
      });
      const top = series.slice(0, CFG.topN);
      const keys = top.map(d => d.key);

      const quarters = top[0] ? top[0].values.map(d => d.quarter) : [];
      if (!quarters.length) return clearViz("No quarters available.");

      const stackInput = quarters.map(q => {
        const row = { quarter: q };
        for (const s of top) {
          const v = s.values.find(d => +d.quarter === +q);
          let val = 0;
          if (metric==="absolute") {
            val = (v && isFinite(v.value)) ? +v.value : 0;
          } else {
            const pctv = (v && isFinite(v.pct)) ? v.pct : 0;
            val = pctv * 100;
          }
          row[s.key] = val;
        }
        return row;
      });

      const stack = d3.stack().keys(keys)
        .offset(metric === "pct_change" ? d3.stackOffsetDiverging : d3.stackOffsetNone);
      const layers = stack(stackInput);

      x.domain(d3.extent(quarters));
      xOverview.domain(x.domain());

      // Y domain
      let yMin = 0, yMax = 0;
      for (let L of layers) {
        for (let d of L) {
          if (isFinite(d[0]) && d[0] < yMin) yMin = d[0];
          if (isFinite(d[1]) && d[1] > yMax) yMax = d[1];
        }
      }
      if (metric === "pct_change") {
        const m = Math.max(Math.abs(yMin), Math.abs(yMax));
        const pad = m * 0.08 + 5;
        yMin = -m - pad;
        yMax =  m + pad;
      } else {
        if (yMin === yMax) { yMin -= 1; yMax += 1; }
      }
      y.domain([yMin, yMax]).nice();
      yOverview.domain(y.domain());

      const fillFor = (d) => colorFor(groupBy, d.key);

      const paths = gSeries.selectAll("path.layer").data(layers, d => d.key);
      paths.enter().append("path").attr("class","layer")
          .attr("fill", fillFor).attr("opacity", 0.9)
        .merge(paths).attr("fill", fillFor).attr("d", area);
      paths.exit().remove();

      xAxisG.call(d3.axisBottom(x).ticks(W < 700 ? 6 : 10));
      yAxisG.call(d3.axisLeft(y).ticks(6).tickFormat(d => metric==="absolute" ? d3.format(",")(d) : d + "%"));

      gOverview.selectAll("path.ov").data(layers, d=>d.key)
        .join("path").attr("class","ov").attr("fill", fillFor).attr("opacity", .6)
        .attr("d", areaOverview);

      gOverview.selectAll("g.xov").data([0]).join("g").attr("class","xov")
        .attr("transform", `translate(0,${innerHOverview})`)
        .call(d3.axisBottom(xOverview).ticks(W < 700 ? 6 : 10));

      gOverview.selectAll("g.yov").data([0]).join("g").attr("class","yov")
        .call(d3.axisLeft(yOverview).ticks(3).tickFormat(()=>""));

      const lastQ = quarters[quarters.length - 1] || new Date(Date.UTC(2024,0,1));
      const idx0 = Math.max(0, quarters.length - 5*4);
      const x0 = xOverview(quarters[idx0] || quarters[0]);
      const x1 = xOverview(lastQ);
      gBrush.call(brush).call(brush.move, [x0, x1]);

      renderLegend(keys, groupBy, fillFor);
      addHover(stackInput, keys, metric, groupBy, fillFor);
    }

    function clearViz(msg){
      gSeries.selectAll("*").remove();
      xAxisG.selectAll("*").remove();
      yAxisG.selectAll("*").remove();
      gOverview.selectAll("*").remove();
      gLegend.selectAll("*").remove();
      container.selectAll(".warn").remove();
      container.append("div").attr("class","warn").style("color","#ffb4b4").style("padding","8px").text(msg);
      return;
    }

    function brushed({selection}) {
      if (!selection) return;
      const inv0 = xOverview.invert(selection[0]);
      const inv1 = xOverview.invert(selection[1]);
      x.domain([inv0, inv1]);
      gSeries.selectAll("path.layer").attr("d", area);
      xAxisG.call(d3.axisBottom(x).ticks(W < 700 ? 6 : 10));
    }

    function renderLegend(keys, groupBy, fillFor) {
      gLegend.selectAll("*").remove();
      const items = gLegend.selectAll("g.leg").data(keys, d=>d).join(enter => {
        const g = enter.append("g").attr("class","leg").style("cursor","pointer");
        g.append("rect").attr("width",12).attr("height",12).attr("y",-12);
        g.append("text").attr("x",16).attr("y",-2).attr("fill","#aab2bd").attr("font-size",".9rem")
         .attr("dominant-baseline","central").attr("title", d=>d);
        return g;
      });
      items.attr("transform",(d,i)=>`translate(${i*180},0)`)
        .on("click", (_, key) => {
          const node = gSeries.selectAll("path.layer").filter(d => d.key === key);
          node.transition().duration(160).attr("opacity", function(){
            const cur = +d3.select(this).attr("opacity");
            return cur < 0.4 ? 0.9 : 0.2;
          });
        });
      items.select("rect").attr("fill", d => fillFor({key:d}));
      items.select("text").text(d => d.length>24 ? d.slice(0,22)+"…" : d);
    }

    function addHover(rows, keys, metric, groupBy, fillFor) {
      const bisect = d3.bisector(d => d.quarter).left;

      gSeries.selectAll("rect.hover").data([0]).join("rect")
        .attr("class","hover").attr("x",0).attr("y",0)
        .attr("width", innerW).attr("height", innerH)
        .attr("fill","transparent")
        .on("mousemove", (event) => {
          const xm = d3.pointer(event, gSeries.node())[0];
          const t = x.invert(xm);
          let i = bisect(rows, t);
          if (i >= rows.length) i = rows.length - 1;
          if (i < 0) i = 0;
          const row = rows[i];

          const lines = keys.map(k => {
            const val = row[k];
            const color = colorFor(groupBy, k);
            let txt;
            if (metric==="absolute") {
              txt = d3.format(",")(val);
            } else {
              const capped = Math.abs(val) >= CFG.MAX_PCT;
              txt = d3.format(".1f")(val) + "%" + (capped ? " (capped)" : "");
            }
            return `<div><span style="display:inline-block;width:.8rem;height:.8rem;background:${color};margin-right:.4rem;border-radius:2px"></span>${k}: <strong>${txt}</strong></div>`;
          }).join("");

          const q = row.quarter;
          tooltip.style("display","block")
            .style("left", (event.clientX + 16) + "px")
            .style("top", (event.clientY + 16) + "px")
            .html(`<div style="opacity:.85">${q.getUTCFullYear()} Q${(q.getUTCMonth()/3)+1}</div>${lines}`);
        })
        .on("mouseleave", () => tooltip.style("display","none"));
    }

    update();
    regionSelect.on("change", update);
    groupBySelect.on("change", update);
    metricSelect.on("change", update);
  })
  .catch(err => {
    container.append("div").style("padding","16px").style("color","#ffb4b4")
      .text("Failed to load or render the visualization: " + err.message);
    console.error(err);
  });

})();