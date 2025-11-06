// script.js — Emissions Explorer (cleaned)
(function() {
  const container = d3.select("#viz");
  if (container.empty()) return;

  function getWidth() {
    const wrap = document.querySelector(".wrap");
    const w = wrap ? wrap.clientWidth : container.node().clientWidth || window.innerWidth;
    return Math.min(1100, Math.max(640, w || 800));
  }

  const CFG = {
    topN: 6,
    margin: {top: 20, right: 18, bottom: 32, left: 72},
    marginOverview: {top: 4, right: 18, bottom: 24, left: 72},
    height: 420,
    heightOverview: 90,
    color: d3.scaleOrdinal(d3.schemeTableau10)
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

  function fmt(n){ return d3.format(",")(Math.round(n)); }
  function pct(a,b){ return (b===0||b==null)? null : (a-b)/b; }

  const regionSelect = d3.select("#regionSelect");
  const groupBySelect = d3.select("#groupBySelect");
  const metricSelect = d3.select("#metricSelect");

  d3.csv("./emissions.csv").then(raw => {
    if (!raw || !raw.length) throw new Error("No rows in emissions.csv");

    const cols = raw.columns || Object.keys(raw[0]);
    const quarterCols = cols.filter(c => /^\d{4}Q[1-4]$/.test(c)).sort();

    const REGION_COL = "Country";
    const HAVE_INDUSTRY = cols.includes("Industry");
    const HAVE_GAS = cols.includes("Gas Type");

    const regions = Array.from(new Set(raw.map(r => r[REGION_COL])))
      .sort((a,b) => (a==="World"? -1 : b==="World"? 1 : d3.ascending(a,b)));

    regionSelect.selectAll("option").data(regions).join("option")
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
          region: row[REGION_COL],
          industry: row["Industry"] || null,
          gas: row["Gas Type"] || null,
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
        if (arr[i] && arr[i].value && Math.abs(arr[i].value) > 0) return arr[i].value;
      }
      return 1; // safe fallback
    }

    function update() {
      const region = regionSelect.property("value");
      const groupBy = groupBySelect.property("value");
      const metric = metricSelect.property("value");

      const data = long.filter(d => d.region === region);
      if (!data.length) {
        gSeries.selectAll("*").remove();
        xAxisG.selectAll("*").remove();
        yAxisG.selectAll("*").remove();
        gOverview.selectAll("*").remove();
        gLegend.selectAll("*").remove();
        container.append("div").attr("class","warn").style("color","#ffb4b4").style("padding","8px")
          .text("No data for this selection.");
        return;
      }

      const keyAccessor = (d) => (groupBy === "Industry" ? d.industry : d.gas);
      const grouped = d3.rollup(
        data,
        v => d3.sum(v, d => d.value),
        d => keyAccessor(d),
        d => +d.quarter
      );

      let series = [];
      grouped.forEach((byQ, keyRaw) => {
        const key = keyRaw || "Unspecified";
        if (groupBy === "Industry" && /total/i.test(key)) return; // remove totals

        const arr = Array.from(byQ, ([ts, val]) => ({ quarter: new Date(+ts), value: +val }))
                        .sort((a,b)=>a.quarter-b.quarter);
        if (!arr.length) return;

        // Use first non-zero baseline for pct mode; avoid NaN
        const base = firstNonZero(arr);
        arr.forEach(d => d.pct = pct(d.value, base));

        series.push({ key, values: arr, latest: arr[arr.length-1] });
      });

      if (!series.length) {
        gSeries.selectAll("*").remove();
        xAxisG.selectAll("*").remove();
        yAxisG.selectAll("*").remove();
        gOverview.selectAll("*").remove();
        gLegend.selectAll("*").remove();
        container.append("div").attr("class","warn").style("color","#ffb4b4").style("padding","8px")
          .text("No series available (filters removed everything).");
        return;
      }

      // Rank & TopN
      series.sort((a,b) => {
        const va = (metric==="absolute") ? a.latest.value : Math.abs(a.latest.pct || 0);
        const vb = (metric==="absolute") ? b.latest.value : Math.abs(b.latest.pct || 0);
        return d3.descending(va, vb);
      });
      const top = series.slice(0, CFG.topN);
      const keys = top.map(d => d.key);
      CFG.color.domain(keys);

      const quarters = top[0] ? top[0].values.map(d => d.quarter) : [];
      if (!quarters.length) return;

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

      // Compute robust Y-limits
      let yMin = 0, yMax = 0;
      for (let L of layers) {
        for (let d of L) {
          if (isFinite(d[0]) && d[0] < yMin) yMin = d[0];
          if (isFinite(d[1]) && d[1] > yMax) yMax = d[1];
        }
      }
      if (!(isFinite(yMin) && isFinite(yMax))) {
        yMin = 0; yMax = 1;
      }
      if (yMin === yMax) { yMin -= 1; yMax += 1; }
      y.domain([yMin, yMax]).nice();
      yOverview.domain(y.domain());

      const paths = gSeries.selectAll("path.layer").data(layers, d => d.key);
      paths.enter().append("path").attr("class","layer")
          .attr("fill", d => CFG.color(d.key)).attr("opacity", 0.9)
        .merge(paths).attr("d", area);
      paths.exit().remove();

      xAxisG.call(d3.axisBottom(x).ticks(W < 700 ? 6 : 10));
      yAxisG.call(d3.axisLeft(y).ticks(6).tickFormat(d => metric==="absolute" ? d3.format(",")(d) : d + "%"));

      gOverview.selectAll("path.ov").data(layers, d=>d.key)
        .join("path").attr("class","ov").attr("fill", d => CFG.color(d.key)).attr("opacity", .6)
        .attr("d", areaOverview);

      gOverview.selectAll("g.xov").data([0]).join("g").attr("class","xov")
        .attr("transform", `translate(0,${innerHOverview})`)
        .call(d3.axisBottom(xOverview).ticks(W < 700 ? 6 : 10));

      gOverview.selectAll("g.yov").data([0]).join("g").attr("class","yov")
        .call(d3.axisLeft(yOverview).ticks(3).tickFormat(()=>""));

      // Default brush = last five years (avoid .at for compatibility)
      const lastQ = quarters[quarters.length - 1] || new Date(Date.UTC(2024,0,1));
      const idx0 = Math.max(0, quarters.length - 5*4);
      const x0 = xOverview(quarters[idx0] || quarters[0]);
      const x1 = xOverview(lastQ);
      gBrush.call(brush).call(brush.move, [x0, x1]);

      renderLegend(keys);
      addHover(stackInput, keys, metric);
    }

    function brushed({selection}) {
      if (!selection) return;
      const inv0 = xOverview.invert(selection[0]);
      const inv1 = xOverview.invert(selection[1]);
      x.domain([inv0, inv1]);
      gSeries.selectAll("path.layer").attr("d", area);
      xAxisG.call(d3.axisBottom(x).ticks(W < 700 ? 6 : 10));
    }

    function renderLegend(keys) {
      gLegend.selectAll("*").remove();
      const items = gLegend.selectAll("g.leg").data(keys).join("g")
        .attr("class","leg").attr("transform",(d,i)=>`translate(${i*180},0)`)
        .style("cursor","pointer")
        .on("click", (_, key) => {
          const node = gSeries.selectAll("path.layer").filter(d => d.key === key);
          node.transition().duration(160).attr("opacity", function(){
            const cur = +d3.select(this).attr("opacity");
            return cur < 0.4 ? 0.9 : 0.2;
          });
        });
      items.append("rect").attr("width",12).attr("height",12).attr("y",-12).attr("fill", d => CFG.color(d));
      // FIX: stray quote removed in y attribute
      items.append("text").attr("x",16).attr("y",-2).attr("fill","#aab2bd").attr("font-size",".9rem").text(d => d);
    }

    function addHover(rows, keys, metric) {
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
            const txt = (metric==="absolute") ? d3.format(",")(val) : d3.format(".1f")(val) + "%";
            return `<div><span style="display:inline-block;width:.8rem;height:.8rem;background:${CFG.color(k)};margin-right:.4rem;border-radius:2px"></span>${k}: <strong>${txt}</strong></div>`;
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