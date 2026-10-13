import { useEffect, useMemo, useRef, useState } from "react";

import BackToDashboard from "../components/BackToDashboard";

const API_URL = "http://127.0.0.1:8000/satellite";

// /satellite now screens every configured satellite, so it is a heavy
// request. Refresh once a minute and never overlap two requests.
const REFRESH_MS = 60000;
const PAGE_SIZE = 25;

// Prototype screening bands (separation only, not collision probability).
const HIGH_RISK_KM = 20;
const MONITOR_KM = 100;

function getStatus(distance) {
  if (distance <= HIGH_RISK_KM) {
    return { key: "high", label: "HIGH RISK", className: "status-high" };
  }
  if (distance <= MONITOR_KM) {
    return { key: "monitor", label: "MONITOR", className: "status-monitor" };
  }
  return { key: "safe", label: "SAFE", className: "status-safe" };
}

function formatTCA(time) {
  if (!time) return "—";
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC").replace("Z", " UTC");
}

const COLUMNS = [
  { key: "satellite_1", label: "OBJECT 1" },
  { key: "satellite_2", label: "OBJECT 2" },
  { key: "distance_km", label: "MIN. SEPARATION" },
  { key: "time_utc", label: "TCA" },
  { key: "status", label: "STATUS" },
];

function Conjunctions() {
  const [pairs, setPairs] = useState([]);
  const [trackedCount, setTrackedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState({ key: "distance_km", direction: "asc" });
  const [page, setPage] = useState(1);

  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const fetchConjunctions = async () => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;

      try {
        const response = await fetch(API_URL);

        if (!response.ok) {
          throw new Error(`Backend responded with status ${response.status}`);
        }

        const data = await response.json();

        if (cancelled) {
          return;
        }

        setPairs(data.minimum_distance_pairs || []);
        setTrackedCount(Array.isArray(data.satellites) ? data.satellites.length : 0);
        setLastUpdated(data.time_utc || "");
        setErrorMessage("");
      } catch (error) {
        console.error("Conjunction API error:", error);
        if (!cancelled) {
          setErrorMessage(error.message);
        }
      } finally {
        inFlight.current = false;
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchConjunctions();
    const interval = setInterval(fetchConjunctions, REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // ------------------------------------------------------------
  // Summary statistics (all from the backend response)
  // ------------------------------------------------------------

  const summary = useMemo(() => {
    let closest = null;
    let candidates = 0;

    for (const pair of pairs) {
      const distance = Number(pair.distance_km);
      if (!Number.isFinite(distance)) {
        continue;
      }
      if (distance <= HIGH_RISK_KM) {
        candidates += 1;
      }
      if (closest === null || distance < closest.distance_km) {
        closest = { ...pair, distance_km: distance };
      }
    }

    return { closest, candidates };
  }, [pairs]);

  // ------------------------------------------------------------
  // Search, filter, sort
  // ------------------------------------------------------------

  const visiblePairs = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = pairs.filter((pair) => {
      if (
        query &&
        !`${pair.satellite_1} ${pair.satellite_2}`.toLowerCase().includes(query)
      ) {
        return false;
      }
      if (
        statusFilter !== "all" &&
        getStatus(Number(pair.distance_km)).key !== statusFilter
      ) {
        return false;
      }
      return true;
    });

    const direction = sort.direction === "asc" ? 1 : -1;

    return [...filtered].sort((a, b) => {
      let valueA;
      let valueB;

      if (sort.key === "distance_km" || sort.key === "status") {
        valueA = Number(a.distance_km);
        valueB = Number(b.distance_km);
      } else if (sort.key === "time_utc") {
        valueA = new Date(a.time_utc).getTime();
        valueB = new Date(b.time_utc).getTime();
      } else {
        valueA = String(a[sort.key] ?? "");
        valueB = String(b[sort.key] ?? "");
        return valueA.localeCompare(valueB) * direction;
      }

      return (valueA - valueB) * direction;
    });
  }, [pairs, search, statusFilter, sort]);

  const pageCount = Math.max(1, Math.ceil(visiblePairs.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const firstIndex = (safePage - 1) * PAGE_SIZE;
  const pageRows = visiblePairs.slice(firstIndex, firstIndex + PAGE_SIZE);

  const changeSort = (key) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" }
    );
    setPage(1);
  };

  const ariaSort = (key) =>
    sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none";

  return (
    <div className="conjunction-page">

      {/* HEADER */}
      <header className="conjunction-header">
        <div>
          <div style={{ marginBottom: 14 }}>
            <BackToDashboard variant="light" />
          </div>

          <div className="system-label">
            CASPER • ORBITAL SURVEILLANCE
          </div>

          <h1>Conjunction Screening</h1>

          <p>
            Satellite-to-satellite close approach analysis
            using SGP4 propagated trajectories.
          </p>
        </div>

        <div className="header-status">
          <span
            className={`status-dot ${errorMessage ? "status-dot-error" : ""}`}
          ></span>
          {errorMessage ? "BACKEND ERROR" : "SCREENING ACTIVE"}
        </div>
      </header>

      {errorMessage && (
        <div className="error-banner" role="alert">
          Could not refresh screening data: {errorMessage}. Check that the
          backend is running at {API_URL}.
          {pairs.length > 0 && " Showing the last successful result."}
        </div>
      )}

      {/* SUMMARY */}
      <section className="summary-grid">

        <div className="summary-card">
          <span className="summary-label">
            TRACKED OBJECTS
          </span>

          <strong>{loading ? "…" : trackedCount}</strong>

          <span className="summary-description">
            Satellites in the screening set
          </span>
        </div>

        <div className="summary-card">
          <span className="summary-label">
            PAIRS SCREENED
          </span>

          <strong>{loading ? "…" : pairs.length}</strong>

          <span className="summary-description">
            Unique combinations, 3 h horizon
          </span>
        </div>

        <div className="summary-card">
          <span className="summary-label">
            CANDIDATES
          </span>

          <strong>{loading ? "…" : summary.candidates}</strong>

          <span className="summary-description">
            Separation ≤ {HIGH_RISK_KM} km
          </span>
        </div>

        <div className="summary-card">
          <span className="summary-label">
            CLOSEST SEPARATION
          </span>

          <strong>
            {summary.closest
              ? `${summary.closest.distance_km.toFixed(1)} KM`
              : "—"}
          </strong>

          <span className="summary-description">
            {summary.closest
              ? `${summary.closest.satellite_1} ↔ ${summary.closest.satellite_2}`
              : "No data yet"}
          </span>
        </div>

      </section>

      {/* MAIN PANEL */}
      <section className="screening-panel">

        <div className="panel-header">
          <div>
            <h2>Minimum Separation Analysis</h2>

            <p>
              Closest predicted separation for each satellite pair
            </p>
          </div>

          <div className="update-time">
            {lastUpdated
              ? `UTC ${formatTCA(lastUpdated)}`
              : "Updating..."}
          </div>
        </div>

        {/* TOOLBAR */}
        {!loading && pairs.length > 0 && (
          <div className="toolbar">
            <label className="field">
              <span>Search satellite</span>
              <input
                type="search"
                value={search}
                placeholder="e.g. TERRA, ISS"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </label>

            <label className="field">
              <span>Status</span>
              <select
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All</option>
                <option value="high">High risk</option>
                <option value="monitor">Monitor</option>
                <option value="safe">Safe</option>
              </select>
            </label>

            <div className="result-count">
              {visiblePairs.length} of {pairs.length} pairs
            </div>
          </div>
        )}

        {!loading && pairs.length > 0 && summary.candidates === 0 && (
          <div className="info-banner">
            No pair came within {HIGH_RISK_KM} km in this screening window,
            so there are no conjunction candidates. The table lists the
            closest approach of every pair.
          </div>
        )}

        {loading ? (
          <div className="loading">
            Loading orbital screening data... the first request can take a
            few seconds.
          </div>
        ) : pairs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">✓</div>

            <h3>No conjunction data available</h3>

            <p>
              Waiting for orbital screening results from the CASPER backend.
            </p>
          </div>
        ) : visiblePairs.length === 0 ? (
          <div className="empty-state">
            <h3>No pairs match your search</h3>
            <p>Try a different name or set the status filter to All.</p>
          </div>
        ) : (
          <div className="table-wrapper">

            <table className="screening-table">

              <thead>
                <tr>
                  <th>#</th>
                  {COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      aria-sort={ariaSort(column.key)}
                    >
                      <button
                        type="button"
                        className="sort-button"
                        onClick={() => changeSort(column.key)}
                      >
                        {column.label}
                        <span aria-hidden="true" className="sort-arrow">
                          {sort.key === column.key
                            ? sort.direction === "asc"
                              ? "▲"
                              : "▼"
                            : ""}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {pageRows.map((pair, index) => {
                  const status = getStatus(Number(pair.distance_km));

                  return (
                    <tr key={`${pair.satellite_1}-${pair.satellite_2}`}>

                      <td className="row-number">
                        {String(firstIndex + index + 1).padStart(3, "0")}
                      </td>

                      <td>
                        <div className="satellite-name">
                          <span className="satellite-icon">
                            SAT
                          </span>

                          <div>
                            <strong>
                              {pair.satellite_1}
                            </strong>

                            <small>
                              Primary object
                            </small>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className="satellite-name">
                          <span className="satellite-icon">
                            SAT
                          </span>

                          <div>
                            <strong>
                              {pair.satellite_2}
                            </strong>

                            <small>
                              Secondary object
                            </small>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className="distance">
                          {Number(pair.distance_km).toFixed(3)}
                          <span> km</span>
                        </div>
                      </td>

                      <td>
                        <div className="tca">
                          {formatTCA(pair.time_utc)}
                        </div>
                      </td>

                      <td>
                        <span
                          className={`status-badge ${status.className}`}
                        >
                          {status.label}
                        </span>
                      </td>

                    </tr>
                  );
                })}
              </tbody>

            </table>

          </div>
        )}

        {/* PAGING */}
        {!loading && visiblePairs.length > PAGE_SIZE && (
          <nav className="pager" aria-label="Table pages">
            <span>
              Showing {firstIndex + 1}–
              {Math.min(firstIndex + PAGE_SIZE, visiblePairs.length)} of{" "}
              {visiblePairs.length}
            </span>

            <div className="pager-buttons">
              <button
                type="button"
                onClick={() => setPage(Math.max(1, safePage - 1))}
                disabled={safePage === 1}
              >
                Previous
              </button>

              <span className="pager-page">
                Page {safePage} / {pageCount}
              </span>

              <button
                type="button"
                onClick={() => setPage(Math.min(pageCount, safePage + 1))}
                disabled={safePage === pageCount}
              >
                Next
              </button>
            </div>
          </nav>
        )}

      </section>

      {/* LEGEND */}
      <section className="legend-panel">

        <div className="legend-title">
          PROTOTYPE SCREENING BANDS (SEPARATION ONLY, NOT COLLISION PROBABILITY)
        </div>

        <div className="legend-items">

          <div>
            <span className="legend-dot safe"></span>
            <span>SAFE &gt; 100 km</span>
          </div>

          <div>
            <span className="legend-dot monitor"></span>
            <span>MONITOR 20–100 km</span>
          </div>

          <div>
            <span className="legend-dot high"></span>
            <span>HIGH RISK ≤ 20 km</span>
          </div>

        </div>

      </section>

      <style>{`

        * {
          box-sizing: border-box;
        }

        .conjunction-page {
          min-height: 100vh;
          padding: 34px 42px;
          background:
            linear-gradient(
              180deg,
              #e8f2f5 0%,
              #dfecef 100%
            );
          color: #182c35;
          font-family:
            Arial,
            Helvetica,
            sans-serif;
        }

        /* HEADER */

        .conjunction-header {
          max-width: 1450px;
          margin: 0 auto 30px;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 30px;
        }

        .system-label {
          font-size: 11px;
          letter-spacing: 2px;
          font-weight: 700;
          color: #24728b;
          margin-bottom: 8px;
        }

        .conjunction-header h1 {
          margin: 0;
          font-size: 32px;
          font-weight: 600;
          color: #18343e;
        }

        .conjunction-header p {
          margin: 9px 0 0;
          font-size: 14px;
          color: #5c737c;
        }

        .header-status {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 9px 14px;
          border: 1px solid #a8c3cb;
          background: rgba(255, 255, 255, 0.45);
          border-radius: 3px;
          font-size: 11px;
          letter-spacing: 1px;
          font-weight: 700;
          color: #397282;
          white-space: nowrap;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #278c61;
        }

        .status-dot-error {
          background: #ad5050;
        }

        .error-banner {
          max-width: 1450px;
          margin: 0 auto 20px;
          padding: 12px 16px;
          background: #f0dede;
          border: 1px solid #d2aaaa;
          border-radius: 3px;
          color: #7d3333;
          font-size: 13px;
        }

        .info-banner {
          margin: 0;
          padding: 11px 22px;
          background: #e6f1f4;
          border-bottom: 1px solid #c2d2d7;
          color: #3f5f6a;
          font-size: 12px;
        }

        /* SUMMARY */

        .summary-grid {
          max-width: 1450px;
          margin: 0 auto 25px;
          display: grid;
          grid-template-columns:
            repeat(4, minmax(180px, 1fr));
          gap: 14px;
        }

        .summary-card {
          background: rgba(248, 252, 253, 0.72);
          border: 1px solid #b9cdd3;
          border-radius: 3px;
          padding: 17px 19px;
          min-height: 105px;
        }

        .summary-label {
          display: block;
          font-size: 10px;
          letter-spacing: 1.5px;
          font-weight: 700;
          color: #58727b;
        }

        .summary-card strong {
          display: block;
          margin-top: 9px;
          font-size: 25px;
          font-weight: 600;
          color: #1d4653;
        }

        .summary-description {
          display: block;
          margin-top: 3px;
          font-size: 11px;
          color: #71858d;
        }

        /* MAIN PANEL */

        .screening-panel {
          max-width: 1450px;
          margin: 0 auto;
          background: rgba(248, 252, 253, 0.82);
          border: 1px solid #afc5cc;
          border-radius: 3px;
          overflow: hidden;
        }

        .panel-header {
          padding: 20px 22px;
          border-bottom: 1px solid #c2d2d7;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
        }

        .panel-header h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
          color: #23434d;
        }

        .panel-header p {
          margin: 5px 0 0;
          font-size: 12px;
          color: #71858c;
        }

        .update-time {
          font-size: 10px;
          letter-spacing: 0.7px;
          color: #617981;
          white-space: nowrap;
        }

        /* TOOLBAR */

        .toolbar {
          display: flex;
          align-items: flex-end;
          gap: 16px;
          flex-wrap: wrap;
          padding: 14px 22px;
          border-bottom: 1px solid #c2d2d7;
          background: rgba(231, 241, 244, 0.6);
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 5px;
          font-size: 10px;
          letter-spacing: 1px;
          font-weight: 700;
          color: #45616a;
          text-transform: uppercase;
        }

        .field input,
        .field select {
          height: 36px;
          min-width: 200px;
          padding: 0 10px;
          border: 1px solid #a8c3cb;
          border-radius: 3px;
          background: #ffffff;
          color: #1e3a44;
          font-size: 13px;
          font-family: inherit;
          text-transform: none;
          letter-spacing: 0;
          font-weight: 400;
        }

        .field input:focus-visible,
        .field select:focus-visible,
        .sort-button:focus-visible,
        .pager-buttons button:focus-visible {
          outline: 2px solid #24728b;
          outline-offset: 1px;
        }

        .result-count {
          margin-left: auto;
          font-size: 12px;
          color: #617981;
        }

        /* TABLE */

        .table-wrapper {
          overflow-x: auto;
        }

        .screening-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 980px;
        }

        .screening-table th {
          padding: 0;
          text-align: left;
          background: #d7e6ea;
          border-bottom: 1px solid #adc4cb;
          color: #45616a;
          font-size: 10px;
          letter-spacing: 1px;
          font-weight: 700;
          white-space: nowrap;
        }

        .screening-table th:first-child {
          padding: 13px 14px;
        }

        .sort-button {
          display: flex;
          align-items: center;
          gap: 6px;
          width: 100%;
          padding: 13px 14px;
          border: 0;
          background: transparent;
          color: inherit;
          font: inherit;
          letter-spacing: inherit;
          text-align: left;
          cursor: pointer;
        }

        .sort-button:hover {
          background: rgba(36, 114, 139, 0.1);
        }

        .sort-arrow {
          font-size: 8px;
          color: #24728b;
        }

        .screening-table td {
          padding: 14px 14px;
          border-bottom: 1px solid #d2dfe3;
          vertical-align: middle;
          font-size: 13px;
        }

        .screening-table tbody tr:hover {
          background: rgba(219, 235, 239, 0.55);
        }

        .row-number {
          color: #7a9098;
          font-family: monospace;
          font-size: 12px;
        }

        /* SATELLITES */

        .satellite-name {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 205px;
        }

        .satellite-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 24px;
          border: 1px solid #8daeb8;
          color: #397383;
          background: #e6f1f4;
          font-size: 8px;
          font-weight: 700;
          letter-spacing: 0.5px;
        }

        .satellite-name strong {
          display: block;
          color: #294750;
          font-size: 13px;
          font-weight: 600;
        }

        .satellite-name small {
          display: block;
          margin-top: 3px;
          color: #84979e;
          font-size: 9px;
        }

        /* DISTANCE */

        .distance {
          color: #214a57;
          font-family: "Courier New", monospace;
          font-size: 15px;
          font-weight: 700;
          white-space: nowrap;
        }

        .distance span {
          color: #71858c;
          font-family: Arial, sans-serif;
          font-size: 11px;
          font-weight: 400;
        }

        /* TCA */

        .tca {
          color: #5d737b;
          font-family: "Courier New", monospace;
          font-size: 11px;
          white-space: nowrap;
        }

        /* STATUS */

        .status-badge {
          display: inline-block;
          padding: 6px 9px;
          border-radius: 2px;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.8px;
          white-space: nowrap;
        }

        .status-safe {
          background: #e1eee8;
          border: 1px solid #a9cbbb;
          color: #39745b;
        }

        .status-monitor {
          background: #f2ead4;
          border: 1px solid #d5c18b;
          color: #8a6a24;
        }

        .status-high {
          background: #f0dede;
          border: 1px solid #d2aaaa;
          color: #9b4141;
        }

        /* PAGER */

        .pager {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          padding: 12px 22px;
          border-top: 1px solid #c2d2d7;
          font-size: 12px;
          color: #5d737b;
        }

        .pager-buttons {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .pager-buttons button {
          height: 34px;
          padding: 0 14px;
          border: 1px solid #8daeb8;
          border-radius: 3px;
          background: #ffffff;
          color: #24566a;
          font: 600 12px Arial, sans-serif;
          cursor: pointer;
        }

        .pager-buttons button:hover:not(:disabled) {
          background: #e6f1f4;
        }

        .pager-buttons button:disabled {
          opacity: 0.45;
          cursor: default;
        }

        /* EMPTY / LOADING */

        .loading,
        .empty-state {
          padding: 70px 20px;
          text-align: center;
          color: #657c84;
        }

        .empty-icon {
          width: 42px;
          height: 42px;
          margin: 0 auto 15px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid #9bbcbf;
          border-radius: 50%;
          color: #397a68;
          font-size: 18px;
        }

        .empty-state h3 {
          margin: 0;
          color: #34535d;
          font-size: 17px;
          font-weight: 600;
        }

        .empty-state p {
          margin-top: 7px;
          color: #7b8e95;
          font-size: 12px;
        }

        /* LEGEND */

        .legend-panel {
          max-width: 1450px;
          margin: 16px auto 0;
          padding: 13px 17px;
          border-top: 1px solid #b8ccd2;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
        }

        .legend-title {
          font-size: 9px;
          letter-spacing: 1.2px;
          font-weight: 700;
          color: #5e747c;
        }

        .legend-items {
          display: flex;
          align-items: center;
          gap: 24px;
          flex-wrap: wrap;
        }

        .legend-items > div {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 10px;
          color: #667d85;
        }

        .legend-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .legend-dot.safe {
          background: #4f9675;
        }

        .legend-dot.monitor {
          background: #b39142;
        }

        .legend-dot.high {
          background: #ad5050;
        }

        /* RESPONSIVE */

        @media (max-width: 850px) {

          .conjunction-page {
            padding: 24px 15px;
          }

          .conjunction-header {
            flex-direction: column;
          }

          .summary-grid {
            grid-template-columns:
              repeat(2, minmax(140px, 1fr));
          }

          .panel-header {
            align-items: flex-start;
            flex-direction: column;
          }

          .legend-panel {
            align-items: flex-start;
            flex-direction: column;
          }

          .result-count {
            margin-left: 0;
          }
        }

        @media (max-width: 500px) {

          .summary-grid {
            grid-template-columns: 1fr;
          }

          .conjunction-header h1 {
            font-size: 25px;
          }
        }

      `}</style>
    </div>
  );
}

export default Conjunctions;