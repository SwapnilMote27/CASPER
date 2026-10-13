import { useEffect, useMemo, useRef, useState } from "react";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Brush,
} from "recharts";

import casperLogo from "../assets/casper-logo.svg";

import BackToDashboard from "../components/BackToDashboard";

import "./Analytics.css";

const API_URL = "http://127.0.0.1:8000/analytics";

// /analytics now carries one time series per satellite, so it is a heavy
// request. Refresh once a minute and never overlap two requests.
const REFRESH_MS = 60000;

// The four original satellites keep their labels. Every other satellite is
// discovered from the backend response, so nothing is hard-coded for them.
const BUILT_IN_LABELS = {
  ISS: "25544 / ISS (ZARYA)",
  TIANHE: "48274 / CSS (TIANHE)",
  WENTIAN: "53239 / CSS (WENTIAN)",
  LEOPARD: "67687 / LEOPARD",
};

const BUILT_IN_GROUP = "Existing feed";
const OTHER_GROUP = "Other satellites";

const TIME_RANGES = [
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "2h", minutes: 120 },
  { label: "3h", minutes: 180 },
  { label: "All", minutes: null },
];

function Analytics() {
  const [data, setData] = useState(null);
  const [selectedSatellite, setSelectedSatellite] = useState("WENTIAN");
  const [selectedRange, setSelectedRange] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const inFlight = useRef(false);

  /* ============================================================
     FETCH BACKEND DATA
  ============================================================ */

  useEffect(() => {
    let cancelled = false;

    const fetchAnalytics = async () => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;

      try {
        const response = await fetch(API_URL);

        if (!response.ok) {
          throw new Error("Backend request failed");
        }

        const result = await response.json();

        if (!cancelled) {
          setData(result);
          setError(false);
        }
      } catch (err) {
        console.error("Analytics error:", err);
        if (!cancelled) {
          setError(true);
        }
      } finally {
        inFlight.current = false;
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchAnalytics();

    const interval = setInterval(fetchAnalytics, REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  /* ============================================================
     SATELLITE LIST (from the backend response)
  ============================================================ */

  const satelliteOptions = useMemo(() => {
    const keys = Object.keys(data?.orbital_elements || {});
    const info = data?.satellite_info || {}; // optional: country, NORAD ID

    const labelFor = (key) => {
      if (BUILT_IN_LABELS[key]) {
        return BUILT_IN_LABELS[key];
      }
      return info[key]?.norad_id ? `${info[key].norad_id} / ${key}` : key;
    };

    const groups = new Map();

    for (const key of keys) {
      const group = BUILT_IN_LABELS[key]
        ? BUILT_IN_GROUP
        : info[key]?.country || OTHER_GROUP;

      if (!groups.has(group)) {
        groups.set(group, []);
      }
      groups.get(group).push({ key, label: labelFor(key) });
    }

    const builtInOrder = Object.keys(BUILT_IN_LABELS);

    for (const [group, items] of groups) {
      items.sort((a, b) =>
        group === BUILT_IN_GROUP
          ? builtInOrder.indexOf(a.key) - builtInOrder.indexOf(b.key)
          : a.label.localeCompare(b.label)
      );
    }

    const groupNames = [...groups.keys()].sort((a, b) => {
      if (a === BUILT_IN_GROUP) return -1;
      if (b === BUILT_IN_GROUP) return 1;
      if (a === OTHER_GROUP) return 1;
      if (b === OTHER_GROUP) return -1;
      return a.localeCompare(b);
    });

    return {
      keys,
      groups: groupNames.map((name) => ({ name, items: groups.get(name) })),
      labelFor,
    };
  }, [data]);

  // If the selected satellite is not in the response, use the first one.
  useEffect(() => {
    if (
      satelliteOptions.keys.length > 0 &&
      !satelliteOptions.keys.includes(selectedSatellite)
    ) {
      setSelectedSatellite(satelliteOptions.keys[0]);
    }
  }, [satelliteOptions, selectedSatellite]);

  const selectedLabel = satelliteOptions.labelFor(selectedSatellite);

  /* ============================================================
     CONVERT ORBITAL ELEMENT DATA
  ============================================================ */

  const allOrbitalData = useMemo(() => {
    const series = data?.orbital_elements?.[selectedSatellite];

    if (!series) {
      return [];
    }

    return series.map((point) => ({
      timestamp: new Date(point.time_utc).getTime(),
      time: new Date(point.time_utc).toISOString(),
      raan: Number(point.raan_deg),
      inclination: Number(point.inclination_deg),
      argumentOfPerigee: Number(point.argument_of_perigee_deg),
      semiMajorAxis: Number(point.semi_major_axis_km),
      eccentricity: Number(point.eccentricity),
    }));
  }, [data, selectedSatellite]);

  /* ============================================================
     TIME RANGE FILTER
  ============================================================ */

  const orbitalData = useMemo(() => {
    if (!allOrbitalData.length) {
      return [];
    }

    // Use the current real UTC time as the end of the window
    const now = Date.now();

    // Default: show the latest 3 hours
    const rangeMinutes = selectedRange === null ? 180 : selectedRange;

    const startTime = now - rangeMinutes * 60 * 1000;

    return allOrbitalData.filter(
      (point) => point.timestamp >= startTime && point.timestamp <= now
    );
  }, [allOrbitalData, selectedRange]);

  /* ============================================================
     GRAPH DOMAINS
  ============================================================ */

  const chartDomains = useMemo(() => {
    if (!orbitalData.length) {
      return {
        raan: [0, 360],
        inclination: [0, 90],
        argumentOfPerigee: [0, 360],
        semiMajorAxis: [0, 10000],
        eccentricity: [0, 0.01],
      };
    }

    const getDomain = (key, paddingRatio = 0.05) => {
      const values = orbitalData
        .map((point) => Number(point[key]))
        .filter(Number.isFinite);

      const min = Math.min(...values);
      const max = Math.max(...values);

      if (min === max) {
        return [min - 1, max + 1];
      }

      const padding = (max - min) * paddingRatio;

      return [min - padding, max + padding];
    };

    return {
      raan: [0, 360],
      inclination: getDomain("inclination"),
      argumentOfPerigee: [0, 360],
      semiMajorAxis: getDomain("semiMajorAxis", 0.1),
      eccentricity: getDomain("eccentricity", 0.15),
    };
  }, [orbitalData]);

  /* ============================================================
     DATE RANGE
  ============================================================ */

  const startTime = orbitalData.length
    ? new Date(orbitalData[0].timestamp).toISOString()
    : "—";

  const endTime = orbitalData.length
    ? new Date(orbitalData[orbitalData.length - 1].timestamp).toISOString()
    : "—";

  /* ============================================================
     LOADING
  ============================================================ */

  if (loading) {
    return (
      <div className="orbit-page">
        <div className="orbit-loading">
          Loading orbital data... the first request can take a few seconds.
        </div>
      </div>
    );
  }

  /* ============================================================
     ERROR (only when there is no data to show)
  ============================================================ */

  if (error && !data) {
    return (
      <div className="orbit-page">
        <div className="orbit-error">
          <BackToDashboard variant="light" />

          <strong>Unable to load orbital data.</strong>

          <span>Make sure the FastAPI backend is running on port 8000.</span>
        </div>
      </div>
    );
  }

  /* ============================================================
     MAIN PAGE
  ============================================================ */

  return (
    <div className="orbit-page">
      {/* HEADER */}

      <header className="orbit-header">
        <div className="orbit-title">
          <img
            src={casperLogo}
            alt="CASPER Logo"
            className="casper-main-logo"
          />

          <div className="orbit-title-text">
            <h1>Orbit Data [GP]</h1>

            <div className="orbit-object-title">
              {selectedLabel}

              <span className="object-expand">[+]</span>
            </div>
          </div>
        </div>

        <div className="orbit-header-right">
          <BackToDashboard variant="light" />

          <div className="casper-brand">
            <img
              src={casperLogo}
              alt="CASPER"
              className="casper-header-logo"
            />

            <div className="casper-brand-text">
              CASPER

              <small>ORBITAL ANALYTICS</small>
            </div>
          </div>

          <button className="menu-button" aria-label="Open menu">
            ☰
          </button>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          style={{
            maxWidth: 1500,
            margin: "0 auto 10px",
            padding: "9px 14px",
            background: "#f0dede",
            border: "1px solid #d2aaaa",
            color: "#7d3333",
            fontSize: 12,
          }}
        >
          Could not refresh orbital data. Showing the last successful result.
        </div>
      )}

      {/* CONTROLS */}

      <section className="orbit-controls">
        <div className="range-buttons">
          {TIME_RANGES.map((range) => (
            <button
              key={range.label}
              className={
                selectedRange === range.minutes
                  ? "range-button active"
                  : "range-button"
              }
              onClick={() => setSelectedRange(range.minutes)}
            >
              {range.label}
            </button>
          ))}
        </div>

        <select
          className="satellite-select"
          aria-label="Select satellite"
          value={selectedSatellite}
          onChange={(event) => {
            setSelectedSatellite(event.target.value);
            setSelectedRange(null);
          }}
        >
          {satelliteOptions.groups.map((group) => (
            <optgroup key={group.name} label={group.name}>
              {group.items.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <div className="date-range">
          <span>
            {startTime !== "—"
              ? startTime.substring(0, 19).replace("T", " ")
              : "—"}
          </span>

          <strong>→</strong>

          <span>
            {endTime !== "—"
              ? endTime.substring(0, 19).replace("T", " ")
              : "—"}
          </span>

          <small>UTC</small>
        </div>
      </section>

      {/* GRAPH */}

      <main className="orbit-chart-panel">
        <div className="chart-heading">
          <div>
            <h2>Orbital Parameter History</h2>

            <p>SGP4-derived orbital elements</p>
          </div>

          <div className="point-counter">{orbitalData.length} points</div>
        </div>

        {orbitalData.length === 0 ? (
          <div
            style={{
              minHeight: 320,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              color: "#4b6269",
              fontSize: 13,
              textAlign: "center",
              padding: 20,
            }}
          >
            <strong>No orbital-element data for this selection.</strong>

            <span>
              The backend returned no valid points for {selectedLabel} in the
              chosen time range. Try the 3h or All range, or pick another
              satellite.
            </span>
          </div>
        ) : (
          <div className="chart-wrapper">
            <ResponsiveContainer width="100%" height={620}>
              <LineChart
                data={orbitalData}
                margin={{
                  top: 20,
                  right: 90,
                  left: 85,
                  bottom: 25,
                }}
              >
                <CartesianGrid stroke="#b9cbd0" strokeDasharray="1 0" />

                <XAxis
                  dataKey="timestamp"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  scale="time"
                  stroke="#4b6269"
                  tickFormatter={(value) =>
                    new Date(value)
                      .toISOString()
                      .substring(5, 16)
                      .replace("T", " ")
                  }
                  tick={{
                    fontSize: 11,
                  }}
                  label={{
                    value: "Date / Time (UTC)",
                    position: "insideBottom",
                    offset: -12,
                    fill: "#4b6269",
                  }}
                />

                {/* LEFT AXES */}

                <YAxis
                  yAxisId="raan"
                  orientation="left"
                  domain={chartDomains.raan}
                  stroke="#174ee8"
                  tick={{
                    fill: "#174ee8",
                    fontSize: 11,
                  }}
                  width={45}
                  label={{
                    value: "RAAN (deg)",
                    angle: -90,
                    position: "insideLeft",
                    fill: "#174ee8",
                    offset: -55,
                  }}
                />

                <YAxis
                  yAxisId="inclination"
                  orientation="left"
                  domain={chartDomains.inclination}
                  stroke="#c0392b"
                  tick={{
                    fill: "#c0392b",
                    fontSize: 11,
                  }}
                  width={45}
                  label={{
                    value: "Inclination (deg)",
                    angle: -90,
                    position: "insideLeft",
                    fill: "#c0392b",
                    offset: -25,
                  }}
                />

                <YAxis
                  yAxisId="argument"
                  orientation="left"
                  domain={chartDomains.argumentOfPerigee}
                  stroke="#07852d"
                  tick={{
                    fill: "#07852d",
                    fontSize: 11,
                  }}
                  width={45}
                  label={{
                    value: "Argument of Perigee (deg)",
                    angle: -90,
                    position: "insideLeft",
                    fill: "#07852d",
                    offset: 5,
                  }}
                />

                {/* RIGHT AXES */}

                <YAxis
                  yAxisId="sma"
                  orientation="right"
                  domain={chartDomains.semiMajorAxis}
                  stroke="#111111"
                  tick={{
                    fill: "#111111",
                    fontSize: 11,
                  }}
                  width={55}
                  label={{
                    value: "Semi-Major Axis (km)",
                    angle: 90,
                    position: "insideRight",
                    fill: "#111111",
                    offset: 55,
                  }}
                />

                <YAxis
                  yAxisId="eccentricity"
                  orientation="right"
                  domain={chartDomains.eccentricity}
                  stroke="#9a147d"
                  tick={{
                    fill: "#9a147d",
                    fontSize: 11,
                  }}
                  width={55}
                  label={{
                    value: "Eccentricity",
                    angle: 90,
                    position: "insideRight",
                    fill: "#9a147d",
                    offset: 25,
                  }}
                />

                {/* TOOLTIP */}

                <Tooltip content={<OrbitalTooltip />} />

                {/* LINES */}

                <Line
                  yAxisId="raan"
                  type="monotone"
                  dataKey="raan"
                  name="RAAN"
                  stroke="#174ee8"
                  strokeWidth={2.2}
                  dot={false}
                  activeDot={{
                    r: 5,
                    strokeWidth: 2,
                  }}
                  isAnimationActive={false}
                />

                <Line
                  yAxisId="inclination"
                  type="monotone"
                  dataKey="inclination"
                  name="Inclination"
                  stroke="#c0392b"
                  strokeWidth={2.2}
                  dot={false}
                  activeDot={{
                    r: 5,
                    strokeWidth: 2,
                  }}
                  isAnimationActive={false}
                />

                <Line
                  yAxisId="argument"
                  type="monotone"
                  dataKey="argumentOfPerigee"
                  name="Arg of Perigee"
                  stroke="#07852d"
                  strokeWidth={2.2}
                  dot={false}
                  activeDot={{
                    r: 5,
                    strokeWidth: 2,
                  }}
                  isAnimationActive={false}
                />

                <Line
                  yAxisId="sma"
                  type="monotone"
                  dataKey="semiMajorAxis"
                  name="SMA"
                  stroke="#111111"
                  strokeWidth={2.2}
                  dot={false}
                  activeDot={{
                    r: 5,
                    strokeWidth: 2,
                  }}
                  isAnimationActive={false}
                />

                <Line
                  yAxisId="eccentricity"
                  type="monotone"
                  dataKey="eccentricity"
                  name="Eccentricity"
                  stroke="#9a147d"
                  strokeWidth={2.2}
                  dot={false}
                  activeDot={{
                    r: 5,
                    strokeWidth: 2,
                  }}
                  isAnimationActive={false}
                />

                {/* TIMELINE */}

                <Brush
                  dataKey="timestamp"
                  height={48}
                  stroke="#6f8991"
                  fill="#d5e3e6"
                  travellerWidth={8}
                  tickFormatter={(value) =>
                    new Date(value).toISOString().substring(0, 10)
                  }
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* LEGEND */}

        <div className="orbit-legend">
          <LegendItem color="#174ee8" label="RAAN" />

          <LegendItem color="#c0392b" label="Inclination" />

          <LegendItem color="#07852d" label="Arg of Perigee" />

          <LegendItem color="#111111" label="SMA" />

          <LegendItem color="#9a147d" label="Eccentricity" />
        </div>
      </main>

      {/* INFORMATION */}

      <section className="orbit-information">
        <InfoItem label="OBJECT" value={selectedLabel} />

        <InfoItem label="PROPAGATOR" value="SGP4" />

        <InfoItem label="POINTS" value={orbitalData.length} />

        <InfoItem label="INTERVAL" value="10 sec" />

        <InfoItem label="REFERENCE" value="UTC" />

        <InfoItem label="SOURCE" value="CASPER" />
      </section>
    </div>
  );
}

/* ============================================================
   CUSTOM TOOLTIP
============================================================ */

function OrbitalTooltip({ active, payload }) {
  if (!active || !payload?.length) {
    return null;
  }

  const point = payload[0].payload;

  return (
    <div className="orbital-tooltip">
      <div className="tooltip-header">ORBITAL STATE</div>

      <div className="tooltip-time">{point.time}</div>

      <TooltipValue
        color="#174ee8"
        label="RAAN"
        value={`${point.raan.toFixed(4)}°`}
      />

      <TooltipValue
        color="#c0392b"
        label="Inclination"
        value={`${point.inclination.toFixed(4)}°`}
      />

      <TooltipValue
        color="#07852d"
        label="Argument of Perigee"
        value={`${point.argumentOfPerigee.toFixed(4)}°`}
      />

      <TooltipValue
        color="#111111"
        label="Semi-Major Axis"
        value={`${point.semiMajorAxis.toFixed(4)} km`}
      />

      <TooltipValue
        color="#9a147d"
        label="Eccentricity"
        value={point.eccentricity.toFixed(8)}
      />
    </div>
  );
}

/* ============================================================
   TOOLTIP VALUE
============================================================ */

function TooltipValue({ color, label, value }) {
  return (
    <div className="tooltip-value">
      <span>
        <i
          style={{
            backgroundColor: color,
          }}
        />

        {label}
      </span>

      <strong>{value}</strong>
    </div>
  );
}

/* ============================================================
   LEGEND
============================================================ */

function LegendItem({ color, label }) {
  return (
    <div className="legend-item">
      <span
        className="legend-line"
        style={{
          backgroundColor: color,
        }}
      />

      <span>{label}</span>
    </div>
  );
}

/* ============================================================
   INFORMATION ITEM
============================================================ */

function InfoItem({ label, value }) {
  return (
    <div className="info-item">
      <span>{label}</span>

      <strong>{value}</strong>
    </div>
  );
}

export default Analytics;