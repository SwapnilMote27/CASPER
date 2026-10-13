import { useEffect, useState } from "react";

function Satellites() {
  const [satellites, setSatellites] = useState([]);
const [timestamp, setTimestamp] = useState(null);
const [loading, setLoading] = useState(true);

  useEffect(() => {
  const fetchSatellites = () => {
    fetch("http://127.0.0.1:8000/satellite")
      .then((response) => response.json())
      .then((data) => {
        setSatellites(data.satellites || []);
        setTimestamp(data.time_utc);
        setLoading(false);
      })
      .catch((error) => {
        console.error("Error fetching satellites:", error);
        setLoading(false);
      });
  };

  // Initial fetch
  fetchSatellites();

  // Refresh every 5 seconds
  const interval = setInterval(fetchSatellites, 5000);

  // Cleanup when page is closed
  return () => clearInterval(interval);
}, []);

  if (loading) {
    return <h1>Loading satellites...</h1>;
  }

    return (
    <div
      style={{
        minHeight: "100vh",
        background: "#050b14",
        color: "white",
        padding: "40px",
      }}
    >
      <h1>Satellite Tracking</h1>

      <p style={{ color: "#8b9bb4" }}>
        Live satellite data from CASPER SGP4 engine
      </p>

      {timestamp && (
  <p style={{ color: "#00e676" }}>
    Last updated: {new Date(timestamp).toLocaleString()}
  </p>
)}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
          gap: "20px",
          marginTop: "30px",
        }}
      >
        {satellites.map((satellite) => (
          <div
            key={satellite.norad_id}
            style={{
              background: "#0b1624",
              border: "1px solid #1c3047",
              borderRadius: "12px",
              padding: "20px",
            }}
          >
            <h2>{satellite.name}</h2>

            <p>
              <strong>NORAD ID:</strong>{" "}
              {satellite.norad_id}
            </p>

            <p>
              <strong>SGP4 Status:</strong>{" "}
              <span style={{ color: "#00e676" }}>
                {satellite.error_code === 0
                  ? "Operational"
                  : "Error"}
              </span>
            </p>

            <p>
              <strong>Position:</strong>
            </p>

            <p>
              X: {satellite.position_km.x.toFixed(2)} km
              <br />
              Y: {satellite.position_km.y.toFixed(2)} km
              <br />
              Z: {satellite.position_km.z.toFixed(2)} km
            </p>

            <p>
              <strong>Velocity:</strong>
            </p>

            <p>
              X: {satellite.velocity_km_s.x.toFixed(3)} km/s
              <br />
              Y: {satellite.velocity_km_s.y.toFixed(3)} km/s
              <br />
              Z: {satellite.velocity_km_s.z.toFixed(3)} km/s
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
export default Satellites;