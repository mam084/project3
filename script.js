// ----- Simple config you can edit quickly -----
const TEAM = {
  name: "Team Matthew",
  members: [
    { name: "Matthew Mitchell", email: "mam084@ucsd.edu", pid: "A12345678" }
  ],
};

// Use the six images we generated (placed in /images/)
const FIGS = [
  {
    file: "fig1_global_emissions_over_time.png",
    caption: "1. Global GHG emissions over time (2010–2025).",
    alt: "Global greenhouse gas emissions over time, 2010–2025",
  },
  {
    file: "fig2_top10_regions_latest_period.png",
    caption:
      "2. Top emitters in latest available quarter.",
    alt: "Top regions by latest available quarter",
  },
  {
    file: "fig3_industry_trends_excl_total.png",
    caption: "3. Top industry trends.",
    alt: "Emission trends for top industries",
  },
  {
    file: "fig4_gas_type_stacked_area.png",
    caption: "4. Emission breakdown by gas type (top four).",
    alt: "Stacked area of emissions by top gas types",
  },
  {
    file: "fig5_region_percent_change_countries_only.png",
    caption:
      "5. Percent change from 2010 → 2024.",
    alt: "Percent change in emissions 2010 to latest year by region",
  },
  {
    file: "fig6_top5_region_trends.png",
    caption:
      "6. Top emitters’ trends.",
    alt: "Trends for top 5 regions",
  },
];

// ----- Populate Team -----
document.getElementById("team-name").textContent = TEAM.name;
document.getElementById("team-members").innerHTML = TEAM.members
  .map(m => `${m.name} — ${m.email} — ${m.pid}`)
  .join(", ");

// ----- Build figure grid -----
const grid = document.getElementById("fig-grid");
FIGS.forEach(({ file, caption, alt }) => {
  const fig = document.createElement("figure");
  fig.className = "card";

  const img = document.createElement("img");
  img.src = `images/${file}`;
  img.alt = alt;
  img.loading = "lazy";
  img.addEventListener("click", () => openLightbox(img.src, alt));

  const cap = document.createElement("figcaption");
  cap.textContent = caption;

  fig.appendChild(img);
  fig.appendChild(cap);
  grid.appendChild(fig);
});

// ----- Lightweight lightbox -----
const lb = document.createElement("div");
lb.id = "lightbox";
lb.innerHTML = `
  <button class="close" aria-label="Close">Close</button>
  <img alt="">
`;
document.body.appendChild(lb);

const lbImg = lb.querySelector("img");
lb.querySelector(".close").addEventListener("click", () => lb.classList.remove("show"));

function openLightbox(src, alt) {
  lbImg.src = src;
  lbImg.alt = alt;
  lb.classList.add("show");
}

