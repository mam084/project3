# revised_exploratory_emissions.py
# Requirements: pandas, matplotlib (no seaborn)

import re
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from pathlib import Path

CSV_PATH = "emissions.csv"        # change if needed
OUT_DIR = Path("./images")       # output folder
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ---------- Load & tidy ----------
df = pd.read_csv(CSV_PATH)

# Columns like "2010Q1" ... "2025Q1"
quarter_cols = [c for c in df.columns if re.fullmatch(r"\d{4}Q[1-4]", c)]
if not quarter_cols:
    raise ValueError("No columns like '2010Q1' found in the CSV.")

id_vars = [c for c in df.columns if c not in quarter_cols]
long = df.melt(id_vars=id_vars, value_vars=quarter_cols,
               var_name="Period", value_name="Emissions").dropna(subset=["Emissions"])

# Ensure expected descriptor columns
for col, default in [
    ("Country", "Unknown Country"),
    ("Industry", "Unknown Industry"),
    ("Gas Type", "Unknown Gas"),
    ("Unit", "Units"),
]:
    if col not in long.columns:
        long[col] = default

# Parse dates
long["Year"] = long["Period"].str[:4].astype(int)
long["Quarter"] = long["Period"].str[-2:]
q_map = {"Q1": 3, "Q2": 6, "Q3": 9, "Q4": 12}
long["Date"] = pd.to_datetime(dict(
    year=long["Year"],
    month=long["Quarter"].map(q_map).fillna(12).astype(int),
    day=1,
))
unit_label = long["Unit"].iloc[0]

# ---------- Helpers: country vs region selection ----------
AGGREGATE_KEYWORDS = [
    "World","G20","G7","EU","Europe","European Union","Americas","Northern America","Latin America",
    "Asia","Eastern Asia","South-eastern Asia","Southern Asia","Western Asia","Oceania",
    "Africa","Northern Africa","Sub-Saharan Africa","Australia and New Zealand",
    "Advanced Economies","Emerging and Developing Economies","Other Oceania sub-regions",
    "Middle East","Caribbean","Union","Community"
]
def is_aggregate(name: str) -> bool:
    return not isinstance(name, str) or any(k.lower() in name.lower() for k in AGGREGATE_KEYWORDS)

# clean, non-overlapping regions for fallback
CLEAN_REGIONS = ["Africa", "Americas", "Asia", "Europe", "Oceania"]

countries_only = long[~long["Country"].apply(is_aggregate)].copy()
regions_only   = long[long["Country"].isin(CLEAN_REGIONS)].copy()

# choose most recent quarter that has COUNTRY rows; otherwise use REGIONS
periods_desc = sorted(quarter_cols, reverse=True)
latest_country_period = next((p for p in periods_desc if (countries_only["Period"] == p).any()), None)
latest_region_period  = next((p for p in periods_desc if (regions_only["Period"] == p).any()), None)

use_countries = latest_country_period is not None and not countries_only.empty

# ---------- 1) Global emissions over time ----------
global_ts = long.groupby("Date")["Emissions"].sum().sort_index()
plt.figure(figsize=(12, 5))
plt.plot(global_ts.index, global_ts.values)
plt.title("Global GHG Emissions Over Time")
plt.xlabel("Quarter")
plt.ylabel(f"Emissions ({unit_label})")
plt.tight_layout()
plt.savefig(OUT_DIR / "fig1_global_emissions_over_time.png", dpi=150)
plt.close()

# ---------- 2) Top 10 (countries if available, else regions) ----------
if use_countries:
    df2 = countries_only[countries_only["Period"] == latest_country_period]
    series2 = df2.groupby("Country")["Emissions"].sum().sort_values(ascending=False).head(10)
    title2 = f"Top 10 Countries — {latest_country_period}"
else:
    df2 = regions_only[regions_only["Period"] == latest_region_period]
    series2 = df2.groupby("Country")["Emissions"].sum().sort_values(ascending=False)
    title2 = f"Top Regions — {latest_region_period}"

plt.figure(figsize=(12, 6))
series2.plot(kind="bar")
plt.title(title2)
plt.xlabel("Country" if use_countries else "Region")
plt.ylabel(f"Emissions ({unit_label})")
plt.xticks(rotation=45, ha="right")
plt.tight_layout()
# keep original filename for compatibility
plt.savefig(Path("./fig2_top10_countries_latest_period.png"), dpi=150)
plt.close()

# ---------- 3) Industry trends (exclude any 'Total …') ----------
non_total = long[~long["Industry"].str.lower().str.startswith("total")].copy()
industry_totals = non_total.groupby("Industry")["Emissions"].sum().sort_values(ascending=False)
top_industries = industry_totals.head(4).index.tolist()

ind_ts = (non_total[non_total["Industry"].isin(top_industries)]
          .groupby(["Date", "Industry"])["Emissions"].sum().reset_index())

plt.figure(figsize=(12, 6))
for ind in top_industries:
    sub = ind_ts[ind_ts["Industry"] == ind].sort_values("Date")
    plt.plot(sub["Date"], sub["Emissions"], label=ind)
plt.legend()
plt.title("Emission Trends by Industry (Top 4, excluding Totals)")
plt.xlabel("Quarter")
plt.ylabel(f"Emissions ({unit_label})")
plt.tight_layout()
plt.savefig(OUT_DIR / "fig3_industry_trends_excl_total.png", dpi=150)
plt.close()

# ---------- 4) Gas type stacked area (Top 4) ----------
gas_totals = long.groupby("Gas Type")["Emissions"].sum().sort_values(ascending=False)
top_gases = gas_totals.head(4).index.tolist()
gas_ts = (long[long["Gas Type"].isin(top_gases)]
          .groupby(["Date", "Gas Type"])["Emissions"].sum().reset_index())
pivot_gas = gas_ts.pivot(index="Date", columns="Gas Type", values="Emissions").fillna(0).sort_index()

plt.figure(figsize=(12, 6))
plt.stackplot(pivot_gas.index, pivot_gas.values.T, labels=pivot_gas.columns)
plt.legend(loc="upper left")
plt.title("Emission Breakdown by Gas Type (Top 4)")
plt.xlabel("Quarter")
plt.ylabel(f"Emissions ({unit_label})")
plt.tight_layout()
plt.savefig(OUT_DIR / "fig4_gas_type_stacked_area.png", dpi=150)
plt.close()

# ---------- 5) Percent change (countries if available, else regions) ----------
if use_countries:
    yearly = countries_only.groupby(["Country", "Year"])["Emissions"].sum().reset_index()
else:
    yearly = regions_only.groupby(["Country", "Year"])["Emissions"].sum().reset_index()

base_year = 2010
compare_year = min(yearly["Year"].max(), 2024) if not yearly.empty else 2010
base = yearly[yearly["Year"] == base_year][["Country", "Emissions"]].rename(columns={"Emissions": "Base"})
comp = yearly[yearly["Year"] == compare_year][["Country", "Emissions"]].rename(columns={"Emissions": "Comp"})
chg = pd.merge(base, comp, on="Country", how="inner")
chg = chg[chg["Base"] > 0].copy()
chg["PctChange"] = (chg["Comp"] - chg["Base"]) / chg["Base"] * 100.0 if not chg.empty else pd.Series(dtype=float)
chg = chg.sort_values("PctChange", ascending=True)

plt.figure(figsize=(11, 8))
if not chg.empty:
    y_pos = np.arange(len(chg))
    plt.barh(y_pos, chg["PctChange"])
    plt.yticks(y_pos, chg["Country"])
else:
    plt.text(0.5, 0.5, "No data for comparison window", ha="center", va="center", transform=plt.gca().transAxes)
plt.axvline(0, linestyle="--")
who = "Country" if use_countries else "Region"
plt.title(f"Percent Change in Emissions by {who} ({base_year} → {compare_year})")
plt.xlabel("Percent Change (%)")
plt.tight_layout()
# keep original filename for compatibility
plt.savefig(Path("./fig5_country_percent_change_countries_only.png"), dpi=150)
plt.close()

# ---------- 6) Trends for Top 5 (countries if available, else regions) ----------
if use_countries:
    latest_period = latest_country_period
    latest_slice = countries_only[countries_only["Period"] == latest_period]
    top5 = latest_slice.groupby("Country")["Emissions"].sum().sort_values(ascending=False).head(5).index.tolist()
    trend = (countries_only[countries_only["Country"].isin(top5)]
             .groupby(["Date", "Country"])["Emissions"].sum().reset_index())
    title6 = f"Top 5 Countries — Emissions Trends (through {latest_period})"
else:
    latest_period = latest_region_period
    top5 = CLEAN_REGIONS  # always plot all five regions
    trend = regions_only.groupby(["Date", "Country"])["Emissions"].sum().reset_index()
    title6 = f"Regional Emissions Trends (through {latest_period})"

plt.figure(figsize=(12, 6))
for key in top5:
    sub = trend[trend["Country"] == key].sort_values("Date")
    if not sub.empty:
        plt.plot(sub["Date"], sub["Emissions"], label=key)
plt.legend()
plt.title(title6)
plt.xlabel("Quarter")
plt.ylabel(f"Emissions ({unit_label})")
plt.tight_layout()
# keep original filename for compatibility
plt.savefig(Path("./fig6_top5_country_trends.png"), dpi=150)
plt.close()

print("Saved revised figures to:", OUT_DIR.resolve())
print("Also wrote compatibility files at project root for figs 2, 5, 6.")
