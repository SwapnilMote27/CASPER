
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import "./Dashboard.css";

const API_URL = "http://127.0.0.1:8000";

const NAV_ITEMS = [
  { path: "/", icon: "⌂", label: "Dashboard" },
  { path: "/live-earth", icon: "◎", label: "Live Earth" },
  { path: "/solar-system", icon: "☼", label: "Solar System" },
  { path: "/satellites", icon: "◈", label: "Satellites" },
  { path: "/conjunctions", icon: "△", label: "Conjunctions" },
  { path: "/ai-prediction", icon: "⌘", label: "AI Prediction" },
  { path: "/analytics", icon: "▥", label: "Analytics" },
];

function formatUtc(value) {
  if (!value) return "UTC timestamp unavailable";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return `${date.toISOString().slice(0, 10)} ${date
    .toISOString()
    .slice(11, 19)} UTC`;
}

function getSatelliteCount(data) {
  const satellites = data?.satellites;

  if (Array.isArray(satellites)) return satellites.length;

  if (satellites && typeof satellites === "object") {
    return Object.keys(satellites).length;
  }

  return [
    data?.orbit,
    data?.tianhe_orbit,
    data?.wentian_orbit,
    data?.leopard_orbit,
  ].filter(Boolean).length || "—";
}

function getDistance(pair) {
  const distance = Number(pair?.distance_km);
  return Number.isFinite(distance) ? distance : null;
}

function getRisk(distance) {
  if (distance === null) {
    return { label: "UNKNOWN", className: "risk-unknown" };
  }

  if (distance <= 20) {
    return { label: "HIGH RISK", className: "risk-high" };
  }

  if (distance <= 100) {
    return { label: "MONITOR", className: "risk-medium" };
  }

  return { label: "SAFE BAND", className: "risk-low" };
}

function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    let active = true;

    const loadData = async () => {
      try {
        const response = await fetch(`${API_URL}/satellite`);

        if (!response.ok) {
          throw new Error(`Backend returned ${response.status}`);
        }

        const result = await response.json();

        if (active) {
          setData(result);
          setApiError(false);
          setLastUpdated(new Date().toISOString());
        }
      } catch {
        if (active) setApiError(true);
      } finally {
        if (active) setLoading(false);
      }
    };

    loadData();
    const intervalId = setInterval(loadData, 15000);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, []);

  const pairs = useMemo(() => {
    const rawPairs = Array.isArray(data?.minimum_distance_pairs)
      ? data.minimum_distance_pairs
      : [];

    return [...rawPairs].sort(
      (a, b) =>
        (getDistance(a) ?? Infinity) - (getDistance(b) ?? Infinity)
    );
  }, [data]);

  const candidates = Array.isArray(data?.conjunction_candidates)
    ? data.conjunction_candidates
    : [];

  const highRiskCount = pairs.filter((pair) => {
    const distance = getDistance(pair);
    return distance !== null && distance <= 20;
  }).length;

  const monitorCount = pairs.filter((pair) => {
    const distance = getDistance(pair);
    return distance !== null && distance > 20 && distance <= 100;
  }).length;

  const trackedObjects = getSatelliteCount(data);
  const pairsScreened = pairs.length || (loading ? "…" : 0);

  const displayedPairs = candidates.length
    ? [...candidates].sort(
        (a, b) =>
          (getDistance(a) ?? Infinity) - (getDistance(b) ?? Infinity)
      )
    : pairs.slice(0, 4);

  const displayMode = candidates.length
    ? "Detected candidates"
    : "Closest screened pairs";

  const utcNow = formatUtc(data?.time_utc || lastUpdated);

  return (
    <div className="casper-dashboard">
      <aside className="casper-sidebar">
        <Link
          to="/"
          className="casper-brand"
          aria-label="CASPER Dashboard"
        >
          <img
            src="/casper-logo.svg"
            alt="CASPER logo"
            onError={(event) => {
              console.error(
                "CASPER logo failed to load:",
                event.currentTarget.src
              );
            }}
          />
          <div className="casper-brand-copy">
            <strong>CASPER</strong>
            <span>SPACE SAFETY SYSTEM</span>
          </div>
        </Link>

        <div className="sidebar-section-label">MISSION CONTROL</div>

        <nav className="casper-navigation" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`casper-nav-item ${
                item.path === "/" ? "active" : ""
              }`}
              aria-current={item.path === "/" ? "page" : undefined}
            >
              <span className="nav-symbol" aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.label}</span>
              {item.path === "/" && (
                <span className="nav-active-mark" />
              )}
            </Link>
          ))}
        </nav>

        <div className="sidebar-spacer" />

        <div className="sidebar-system-card">
          <div className="system-card-heading">
            <span className={`status-dot ${apiError ? "offline" : ""}`} />
            <strong>
              {apiError ? "BACKEND OFFLINE" : "API CONNECTION"}
            </strong>
          </div>

          <p>
            {loading
              ? "Connecting to CASPER..."
              : apiError
                ? "Unable to retrieve screening data"
                : "Screening data endpoint"}
          </p>

          <span className="system-endpoint">127.0.0.1:8000</span>
        </div>

        <div className="sidebar-footer">
          <span>CASPER RESEARCH PROTOTYPE</span>
          <span>SPACE SITUATIONAL AWARENESS</span>
        </div>
      </aside>

      <main className="casper-main">
        <header className="casper-topbar">
          <div className="breadcrumb">
            <span>CASPER</span>
            <span className="breadcrumb-separator">/</span>
            <strong>Dashboard</strong>
          </div>

          <div className="topbar-right">
            <div className="utc-clock">
              <span className="clock-symbol">◷</span>
              <div>
                <span className="topbar-label">LATEST DATA TIME</span>
                <strong>{utcNow}</strong>
              </div>
            </div>

            <span
              className={`connection-pill ${
                apiError ? "disconnected" : ""
              }`}
            >
              <span className={`status-dot ${apiError ? "offline" : ""}`} />
              {apiError
                ? "DISCONNECTED"
                : loading
                  ? "CONNECTING"
                  : "API LINK"}
            </span>
          </div>
        </header>

        <div className="dashboard-content">
          {apiError && (
            <div className="dashboard-error" role="alert">
              <strong>Backend connection unavailable.</strong>
              <span>
                Start FastAPI to refresh the dashboard. Displayed figures may
                be from the last successful request.
              </span>
            </div>
          )}

          <section className="dashboard-hero">
            <div className="hero-copy">
              <span className="eyebrow">
                <span className="eyebrow-line" />
                SPACE TRAFFIC MONITORING
              </span>

              <h1>
                Mission <span>Control.</span>
              </h1>

              <p>
                Monitor orbital environments, screen satellite conjunctions,
                and explore AI-assisted space safety research.
              </p>

              <div className="hero-actions">
                <Link to="/conjunctions" className="primary-action">
                  View Screening Results <span>↗</span>
                </Link>
                <Link to="/live-earth" className="secondary-action">
                  Open Live Earth
                </Link>
              </div>
            </div>

            <div
              className="hero-visual"
              aria-label="Decorative orbital illustration"
            >
              <div className="visual-grid" />
              <div className="visual-orbit visual-orbit-outer" />
              <div className="visual-orbit visual-orbit-middle" />
              <div className="visual-orbit visual-orbit-inner" />

              <div className="visual-earth">
                <div className="earth-shading" />
              </div>

              <span className="visual-node node-one" />
              <span className="visual-node node-two" />
              <span className="visual-node node-three" />

              <span className="visual-tag tag-top">ORBITAL TRACKING</span>
              <span className="visual-tag tag-bottom">SGP4 · UTC</span>
            </div>

            <div className="hero-index">
              <span>01</span>
              <span className="hero-index-line" />
              <span>OVERVIEW</span>
            </div>
          </section>

          <section className="section-heading">
            <div>
              <span className="eyebrow">SYSTEM OVERVIEW</span>
              <h2>Screening at a glance</h2>
            </div>

            <span className="refresh-label">
              <span className={`status-dot ${apiError ? "offline" : ""}`} />
              AUTO-REFRESH · 15 SEC
            </span>
          </section>

          <section className="dashboard-stats">
            <article className="metric-card">
              <div className="metric-topline">
                <span className="metric-label">TRACKED OBJECTS</span>
                <span className="metric-icon cyan">◈</span>
              </div>
              <div className="metric-value">
                {loading && !data ? "…" : trackedObjects}
              </div>
              <div className="metric-bottom">
                <span className="metric-indicator cyan-indicator" />
                Objects represented by current API response
              </div>
              <div className="metric-accent cyan-accent" />
            </article>

            <article className="metric-card">
              <div className="metric-topline">
                <span className="metric-label">PAIRS SCREENED</span>
                <span className="metric-icon blue">⌁</span>
              </div>
              <div className="metric-value">
                {loading && !data ? "…" : pairsScreened}
              </div>
              <div className="metric-bottom">
                <span className="metric-indicator blue-indicator" />
                Minimum-distance pair records
              </div>
              <div className="metric-accent blue-accent" />
            </article>

            <article className="metric-card">
              <div className="metric-topline">
                <span className="metric-label">SCREENING CANDIDATES</span>
                <span className="metric-icon amber">△</span>
              </div>
              <div className="metric-value">{candidates.length}</div>
              <div className="metric-bottom">
                <span className="metric-indicator amber-indicator" />
                Current backend candidate list
              </div>
              <div className="metric-accent amber-accent" />
            </article>

            <article className="metric-card">
              <div className="metric-topline">
                <span className="metric-label">AI MODEL STATUS</span>
                <span className="metric-icon violet">⌘</span>
              </div>
              <div className="metric-value metric-status-text">
                NOT CONNECTED
              </div>
              <div className="metric-bottom">
                <span className="metric-indicator violet-indicator" />
                GCN + GAT integration pending
              </div>
              <div className="metric-accent violet-accent" />
            </article>
          </section>

          <section className="dashboard-lower-grid">
            <article className="dashboard-panel screening-panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">PROXIMITY MONITOR</span>
                  <h2>{displayMode}</h2>
                  <p>
                    {candidates.length
                      ? "Pairs returned by the current candidate detector."
                      : "Closest pairs in the current screening window; these are not necessarily collision risks."}
                  </p>
                </div>

                <Link to="/conjunctions" className="text-link">
                  Full report <span>↗</span>
                </Link>
              </div>

              <div className="screening-summary">
                <div>
                  <span className="summary-dot high-dot" />
                  <span>≤ 20 km</span>
                  <strong>{highRiskCount}</strong>
                </div>
                <div>
                  <span className="summary-dot monitor-dot" />
                  <span>20–100 km</span>
                  <strong>{monitorCount}</strong>
                </div>
              </div>

              <div className="pair-table-wrap">
                <table className="pair-table">
                  <thead>
                    <tr>
                      <th>OBJECT PAIR</th>
                      <th>MIN. SEPARATION</th>
                      <th>TIME OF CLOSEST APPROACH</th>
                      <th>STATUS</th>
                    </tr>
                  </thead>

                  <tbody>
                    {displayedPairs.map((pair, index) => {
                      const distance = getDistance(pair);
                      const risk = getRisk(distance);
                      const pairKey = `${pair.satellite_1 || "object-1"}-${
                        pair.satellite_2 || "object-2"
                      }-${index}`;

                      return (
                        <tr key={pairKey}>
                          <td>
                            <div className="pair-name">
                              <span className="pair-mark">↔</span>
                              <div>
                                <strong>
                                  {pair.satellite_1 || "Unknown object"}
                                </strong>
                                <span>
                                  {pair.satellite_2 || "Unknown object"}
                                </span>
                              </div>
                            </div>
                          </td>

                          <td>
                            <strong className="distance-value">
                              {distance === null
                                ? "—"
                                : `${distance.toFixed(2)} km`}
                            </strong>
                          </td>

                          <td className="tca-value">
                            {formatUtc(pair.time_utc)}
                          </td>

                          <td>
                            <span className={`risk-badge ${risk.className}`}>
                              {risk.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}

                    {!displayedPairs.length && (
                      <tr>
                        <td colSpan={4} className="empty-table">
                          {loading
                            ? "Loading screening results…"
                            : apiError
                              ? "Screening results unavailable while the backend is offline."
                              : "No pair records are available in the current response."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="panel-footnote">
                <span>SCREENING SOURCE: SGP4 BACKEND</span>
                <span>TIME STANDARD: UTC</span>
              </div>
            </article>

            <article className="dashboard-panel pipeline-panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">RESEARCH PIPELINE</span>
                  <h2>AI screening engine</h2>
                  <p>Planned model architecture</p>
                </div>
                <span className="prototype-badge">IN DEVELOPMENT</span>
              </div>

              <div className="pipeline-list">
                <div className="pipeline-step">
                  <div className="pipeline-number">01</div>
                  <div className="pipeline-copy">
                    <strong>TLE CATALOGUE</strong>
                    <span>Orbital element input</span>
                  </div>
                  <span className="pipeline-state available">SOURCE</span>
                </div>

                <div className="pipeline-connector" />

                <div className="pipeline-step">
                  <div className="pipeline-number">02</div>
                  <div className="pipeline-copy">
                    <strong>SGP4 PROPAGATION</strong>
                    <span>Position and velocity</span>
                  </div>
                  <span className="pipeline-state available">AVAILABLE</span>
                </div>

                <div className="pipeline-connector" />

                <div className="pipeline-step">
                  <div className="pipeline-number">03</div>
                  <div className="pipeline-copy">
                    <strong>GCN + GAT</strong>
                    <span>Dynamic graph prediction</span>
                  </div>
                  <span className="pipeline-state pending">PENDING</span>
                </div>

                <div className="pipeline-connector" />

                <div className="pipeline-step">
                  <div className="pipeline-number">04</div>
                  <div className="pipeline-copy">
                    <strong>UNCERTAINTY ESTIMATION</strong>
                    <span>Planned MC Dropout</span>
                  </div>
                  <span className="pipeline-state pending">PENDING</span>
                </div>
              </div>

              <div className="pipeline-note">
                <span className="note-icon">i</span>
                <p>
                  The AI model and uncertainty estimates are not yet connected.
                  Current conjunction results come from numerical screening,
                  not AI predictions.
                </p>
              </div>

              <Link to="/ai-prediction" className="pipeline-action">
                Explore AI Prediction <span>→</span>
              </Link>
            </article>
          </section>

          <footer className="dashboard-footer">
            <div className="footer-brand">
              <img src="/casper-logo.svg" alt="CASPER" />
              <span>CASPER · SPACE SAFETY RESEARCH</span>
            </div>

            <span>
              {apiError
                ? "BACKEND CONNECTION UNAVAILABLE"
                : `LATEST RESPONSE: ${utcNow}`}
            </span>

            <span>ALL DISPLAYED TIMES IN UTC</span>
          </footer>
        </div>
      </main>
    </div>
  );
}

export default Dashboard;
