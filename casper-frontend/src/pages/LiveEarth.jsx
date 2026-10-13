import { useEffect, useRef, useState } from "react";

import {
  Viewer,
  Ion,
  ImageryLayer,
  Simon1994PlanetaryPositions,
  createWorldImageryAsync,
  WebMapTileServiceImageryProvider,
  CallbackPositionProperty,
  CallbackProperty,
  Color,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Transforms,
  Matrix3,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  JulianDate,
  SampledPositionProperty,
  PathGraphics,
  PolylineGraphics,
  DistanceDisplayCondition,
  NearFarScalar,
  ArcType,
  Math as CesiumMath,
} from "cesium";

import "cesium/Build/Cesium/Widgets/widgets.css";
import BackToDashboard from "../components/BackToDashboard";

import "./LiveEarth.css";

const API_BASE = "http://127.0.0.1:8000";
const EXISTING_GROUP = "Existing /satellite feed";

// ==============================================================
// EXISTING FEED (same keys as before, now drawn with icons)
// ==============================================================

const SATELLITES = [
  { key: "orbit", name: "ISS (ZARYA)", css: "#00ffff", role: "Space station" },
  { key: "tianhe_orbit", name: "CSS (TIANHE)", css: "#ffa500", role: "Space station module" },
  { key: "wentian_orbit", name: "CSS (WENTIAN)", css: "#00ff00", role: "Space station module" },
  { key: "leopard_orbit", name: "LEOPARD", css: "#ff00ff", role: "" },
];

// Icon and orbit colour per country for the /catalog satellites.
const COUNTRY_COLORS = {
  USA: "#4cc9f0",
  "International (NASA/ESA)": "#90e0ef",
  "Europe (ESA/EU)": "#7b9cff",
  Russia: "#ff6b6b",
  China: "#ffd166",
  Japan: "#f78fb3",
  India: "#ff9f43",
  France: "#a29bfe",
  Germany: "#b2bec3",
  Italy: "#55efc4",
  "United Kingdom": "#74b9ff",
  Canada: "#fab1a0",
  Brazil: "#badc58",
  "South Korea": "#81ecec",
  Argentina: "#fdcb6e",
  Israel: "#dfe6e9",
  Turkey: "#e17055",
  UAE: "#c8d6e5",
};
const FALLBACK_COLOR = "#cbd5e1";

const LABEL_MAX_DISTANCE = 2.0e7;
const LABEL_RANGE = new DistanceDisplayCondition(0, LABEL_MAX_DISTANCE);
const LABEL_FADE = new NearFarScalar(1.0e7, 1.0, LABEL_MAX_DISTANCE, 0.0);

// Orbit lines: faint and thin by default, stronger for the chosen satellite.
const ORBIT_WIDTH = 1;
const ORBIT_ALPHA = 0.28;
const ORBIT_WIDTH_SELECTED = 2.5;
const ORBIT_ALPHA_SELECTED = 0.9;

// Moving trail behind each satellite: faint by default.
const TRAIL_WIDTH = 1;
const TRAIL_ALPHA = 0.35;
const TRAIL_WIDTH_SELECTED = 2;
const TRAIL_ALPHA_SELECTED = 0.9;
const TRAIL_SECONDS = 900;

const GIBS_LAYER = "VIIRS_SNPP_CorrectedReflectance_TrueColor";
const SIDEREAL_MONTH_SECONDS = 27.321661 * 86400;

function yesterdayUtc() {
  return new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
}

// Ring marker: hollow ring with a centre dot, tinted per satellite.
const iconCache = new Map();
function satelliteIcon(css) {
  if (!iconCache.has(css)) {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
      `<circle cx="16" cy="16" r="9" fill="#05080f" fill-opacity="0.55" stroke="${css}" stroke-width="2.5"/>` +
      `<circle cx="16" cy="16" r="3" fill="${css}"/>` +
      "</svg>";
    iconCache.set(
      css,
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)
    );
  }
  return iconCache.get(css);
}

function temeToFixed(point) {
  const time = JulianDate.fromIso8601(point.time_utc);
  const matrix = Transforms.computeTemeToPseudoFixedMatrix(time, new Matrix3());
  if (!matrix) {
    return null;
  }
  const teme = new Cartesian3(
    point.position_km.x * 1000,
    point.position_km.y * 1000,
    point.position_km.z * 1000
  );
  return { time, fixed: Matrix3.multiplyByVector(matrix, teme, new Cartesian3()) };
}

// One helper builds every satellite: icon, label, moving trail, full orbit.
function addSatellite(viewer, { name, points, css, defaultArc }) {
  if (!points || points.length <= 1) {
    return null;
  }

  const color = Color.fromCssColorString(css);
  const positionProperty = new SampledPositionProperty();
  const orbitPositions = [];

  for (const point of points) {
    const converted = temeToFixed(point);
    if (!converted) {
      continue;
    }
    orbitPositions.push(converted.fixed);
    positionProperty.addSample(converted.time, converted.fixed);
  }

  return viewer.entities.add({
    name,
    position: positionProperty,

    billboard: {
      image: satelliteIcon(css),
      width: 24,
      height: 24,
      scaleByDistance: new NearFarScalar(1.0e6, 1.2, 4.0e7, 0.6),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },

    label: {
      text: name,
      font: "bold 13px sans-serif",
      fillColor: color,
      outlineColor: Color.BLACK,
      outlineWidth: 3,
      style: 2,
      horizontalOrigin: 0,
      verticalOrigin: 1,
      pixelOffset: new Cartesian2(16, -16),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      distanceDisplayCondition: LABEL_RANGE,
      translucencyByDistance: LABEL_FADE,
    },

    path: new PathGraphics({
      show: true,
      width: TRAIL_WIDTH,
      material: color.withAlpha(TRAIL_ALPHA),
      leadTime: 0,
      trailTime: TRAIL_SECONDS,
    }),

    polyline: new PolylineGraphics({
      positions: orbitPositions,
      width: ORBIT_WIDTH,
      material: color.withAlpha(ORBIT_ALPHA),
      // the part of the orbit behind the Earth stays visible, fainter,
      // so the whole orbit can be seen
      depthFailMaterial: color.withAlpha(ORBIT_ALPHA * 0.45),
      // straight segments: correct for high orbits such as geostationary
      ...(defaultArc ? {} : { arcType: ArcType.NONE }),
    }),
  });
}

function LiveEarth() {
  const container = useRef(null);
  const viewerRef = useRef(null);
  const gibsLayerRef = useRef(null);
  const entityMapRef = useRef(new Map()); // name -> entity (satellites + Moon)
  const moonOrbitRef = useRef(null);
  const choiceRef = useRef("all");

  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [errorMessage, setErrorMessage] = useState("");
  const [catalogNote, setCatalogNote] = useState("");
  const [available, setAvailable] = useState([]);
  const [choice, setChoice] = useState("all"); // "all" | satellite name | "Moon"
  const [showAllOrbits, setShowAllOrbits] = useState(true);
  const [showMoonOrbit, setShowMoonOrbit] = useState(true);
  const [info, setInfo] = useState(null);
  const [sceneTime, setSceneTime] = useState("");
  const [gibsOn, setGibsOn] = useState(false);
  const [observedDate] = useState(yesterdayUtc);

  // ============================================================
  // CESIUM VIEWER
  // ============================================================

  useEffect(() => {
    let viewer;
    let handler;
    let removeTick;
    let cancelled = false;
    const entityMap = entityMapRef.current;

    async function createViewer() {
      try {
        // ====================================================
        // FETCH EXISTING SATELLITE DATA
        // ====================================================

        const response = await fetch(`${API_BASE}/satellite`);

        if (!response.ok) {
          throw new Error(`Backend responded with status ${response.status}`);
        }

        const satelliteData = await response.json();

        if (!satelliteData || !Array.isArray(satelliteData.satellites)) {
          throw new Error("Satellite API returned invalid satellite data");
        }

        if (cancelled) {
          return;
        }

        const issOrbit = satelliteData.orbit || [];

        // ====================================================
        // CESIUM TOKEN + IMAGERY
        // ====================================================

        Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN;

        const imageryLayer = await ImageryLayer.fromProviderAsync(
          createWorldImageryAsync()
        );

        if (cancelled) {
          return;
        }

        // ====================================================
        // CREATE VIEWER ONLY ONCE
        // ====================================================

        viewer = new Viewer(container.current, {
          baseLayer: imageryLayer,
          baseLayerPicker: false,
          animation: false,
          timeline: false,
          geocoder: false,
          homeButton: true,
          sceneModePicker: false,
          navigationHelpButton: false,
          fullscreenButton: true,
        });

        viewerRef.current = viewer;

        viewer.scene.globe.enableLighting = true;
        viewer.scene.logarithmicDepthFarToNearRatio = 100;
        viewer.scene.globe.depthTestAgainstTerrain = false;

        const controller = viewer.scene.screenSpaceCameraController;
        controller.enableRotate = true;
        controller.enableTilt = true;
        controller.enableTranslate = true;
        controller.enableZoom = true;
        controller.enableCollisionDetection = false;

        // ====================================================
        // MOON (unchanged logic)
        // ====================================================

        const moonEntity = viewer.entities.add({
          name: "Moon",

          position: new CallbackPositionProperty((time, result) => {
            const moonInertial =
              Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(
                time
              );

            const icrfToFixed = Transforms.computeIcrfToFixedMatrix(
              time,
              new Matrix3()
            );

            if (!icrfToFixed) {
              return result;
            }

            return Matrix3.multiplyByVector(icrfToFixed, moonInertial, result);
          }, false),

          ellipsoid: {
            radii: new Cartesian3(1737400.0, 1737400.0, 1737400.0),
            material: Color.GRAY,
          },

          label: {
            text: "Moon",
            font: "14px sans-serif",
            pixelOffset: new Cartesian2(12, 0),
          },
        });

        entityMap.set("Moon", moonEntity);

        // ====================================================
        // MOON ORBIT
        // One sidereal month of Moon positions in the inertial
        // frame, rotated to Earth-fixed each frame so the ring
        // stays still in space while the Earth turns.
        // ====================================================

        const orbitStartTime = JulianDate.now();
        const moonRing = [];
        const ringSteps = 180;

        for (let i = 0; i <= ringSteps; i += 1) {
          const t = JulianDate.addSeconds(
            orbitStartTime,
            (i / ringSteps) * SIDEREAL_MONTH_SECONDS,
            new JulianDate()
          );
          moonRing.push(
            Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(t)
          );
        }

        const moonOrbitEntity = viewer.entities.add({
          name: "Moon orbit",
          polyline: {
            positions: new CallbackProperty(() => {
              const matrix = Transforms.computeIcrfToFixedMatrix(
                viewer.clock.currentTime,
                new Matrix3()
              );
              if (!matrix) {
                return [];
              }
              return moonRing.map((p) =>
                Matrix3.multiplyByVector(matrix, p, new Cartesian3())
              );
            }, false),
            width: 1.5,
            material: Color.WHITE.withAlpha(0.4),
            arcType: ArcType.NONE,
          },
        });

        moonOrbitRef.current = moonOrbitEntity;

        // ====================================================
        // SATELLITES: existing feed first, then the catalogue
        // ====================================================

        const list = [];

        for (const config of SATELLITES) {
          const entity = addSatellite(viewer, {
            name: config.name,
            points: satelliteData[config.key],
            css: config.css,
            defaultArc: true,
          });

          if (!entity) {
            console.warn(`${config.name} orbit data is missing or too short.`);
            continue;
          }

          entityMap.set(config.name, entity);
          list.push({
            name: config.name,
            css: config.css,
            group: EXISTING_GROUP,
            role: config.role,
          });
        }

        // Extra satellites configured in the backend (satellites.json),
        // delivered by /satellite exactly like the four built-in ones.
        const extras = Array.isArray(satelliteData.extra_satellites)
          ? satelliteData.extra_satellites
          : [];

        for (const sat of extras) {
          if (entityMap.has(sat.name)) {
            continue;
          }
          const css = COUNTRY_COLORS[sat.country] || FALLBACK_COLOR;
          const entity = addSatellite(viewer, {
            name: sat.name,
            points: sat.orbit,
            css,
            defaultArc: false,
          });

          if (!entity) {
            continue;
          }

          entityMap.set(sat.name, entity);
          list.push({
            name: sat.name,
            css,
            group: sat.country || "Other",
            role: sat.role || "",
            noradId: sat.norad_id,
            periodMin: sat.period_min,
          });
        }

        if (extras.length === 0) {
          setCatalogNote(
            "Only the 4 built-in satellites are configured. Add more with pick_satellites.py (see backend instructions)."
          );
        }

        setAvailable(list);

        // ====================================================
        // CESIUM CLOCK (unchanged logic)
        // ====================================================

        if (issOrbit.length > 1) {
          const orbitStart = JulianDate.fromIso8601(issOrbit[0].time_utc);
          const orbitEnd = JulianDate.fromIso8601(
            issOrbit[issOrbit.length - 1].time_utc
          );

          viewer.clock.startTime = orbitStart.clone();
          viewer.clock.stopTime = orbitEnd.clone();

          const now = JulianDate.now();

          if (JulianDate.lessThan(now, orbitStart)) {
            viewer.clock.currentTime = orbitStart.clone();
          } else if (JulianDate.greaterThan(now, orbitEnd)) {
            viewer.clock.currentTime = orbitEnd.clone();
          } else {
            viewer.clock.currentTime = now;
          }

          viewer.clock.clockRange = 2;
          viewer.clock.multiplier = 10;
          viewer.clock.shouldAnimate = true;
        }

        // ====================================================
        // CLICK: choose a satellite from the globe
        // ====================================================

        handler = new ScreenSpaceEventHandler(viewer.scene.canvas);

        handler.setInputAction((click) => {
          const picked = viewer.scene.pick(click.position);

          if (picked && picked.id && entityMap.has(picked.id.name)) {
            setChoice(picked.id.name);
          }
        }, ScreenSpaceEventType.LEFT_CLICK);

        // ====================================================
        // 1 Hz HUD UPDATE
        // ====================================================

        let lastUpdate = 0;

        const onTick = () => {
          const nowMs = performance.now();
          if (nowMs - lastUpdate < 1000) {
            return;
          }
          lastUpdate = nowMs;

          const time = viewer.clock.currentTime;
          setSceneTime(
            JulianDate.toDate(time).toISOString().slice(0, 19).replace("T", " ")
          );

          const name = choiceRef.current;
          const entity = name === "all" ? null : entityMap.get(name);
          const position = entity?.position?.getValue(time);

          if (!position) {
            setInfo(null);
            return;
          }

          const cartographic = Cartographic.fromCartesian(position);
          setInfo({
            lat: CesiumMath.toDegrees(cartographic.latitude),
            lon: CesiumMath.toDegrees(cartographic.longitude),
            altKm: cartographic.height / 1000,
          });
        };

        viewer.clock.onTick.addEventListener(onTick);
        removeTick = () => viewer.clock.onTick.removeEventListener(onTick);

        viewer.camera.flyHome(0);
        setStatus("ready");
      } catch (error) {
        console.error("Error creating CASPER Live Earth:", error);
        if (!cancelled) {
          setErrorMessage(error.message);
          setStatus("error");
        }
      }
    }

    createViewer();

    return () => {
      cancelled = true;

      if (removeTick) {
        removeTick();
      }
      if (handler && !handler.isDestroyed()) {
        handler.destroy();
      }
      if (viewer && !viewer.isDestroyed()) {
        viewer.destroy();
      }

      entityMap.clear();
      viewerRef.current = null;
      gibsLayerRef.current = null;
      moonOrbitRef.current = null;
    };
  }, []);

  // ============================================================
  // WHICH SATELLITE TO SEE (drop-down)
  // "all": every icon, orbits optional.  One name: only that
  // satellite with its orbit and a permanent label.
  // ============================================================

  useEffect(() => {
    choiceRef.current = choice;
    const viewer = viewerRef.current;

    if (status !== "ready" || !viewer || viewer.isDestroyed()) {
      return;
    }

    for (const sat of available) {
      const entity = entityMapRef.current.get(sat.name);
      if (!entity) {
        continue;
      }
      const isChosen = choice === sat.name;
      const visible = choice === "all" || isChosen;

      entity.show = visible;
      entity.polyline.show = isChosen || (choice === "all" && showAllOrbits);

      const orbitColor = Color.fromCssColorString(sat.css);
      const alpha = isChosen ? ORBIT_ALPHA_SELECTED : ORBIT_ALPHA;
      entity.polyline.width = isChosen ? ORBIT_WIDTH_SELECTED : ORBIT_WIDTH;
      entity.polyline.material = orbitColor.withAlpha(alpha);
      entity.polyline.depthFailMaterial = orbitColor.withAlpha(alpha * 0.45);

      entity.path.width = isChosen ? TRAIL_WIDTH_SELECTED : TRAIL_WIDTH;
      entity.path.material = orbitColor.withAlpha(
        isChosen ? TRAIL_ALPHA_SELECTED : TRAIL_ALPHA
      );
      entity.label.distanceDisplayCondition = isChosen ? undefined : LABEL_RANGE;
      entity.label.translucencyByDistance = isChosen ? undefined : LABEL_FADE;
    }

    if (moonOrbitRef.current) {
      moonOrbitRef.current.show = showMoonOrbit;
    }
  }, [choice, showAllOrbits, showMoonOrbit, available, status]);

  useEffect(() => {
    const viewer = viewerRef.current;

    if (status !== "ready" || !viewer || viewer.isDestroyed()) {
      return;
    }

    if (choice === "all") {
      viewer.camera.flyHome(1.2);
      return;
    }

    const entity = entityMapRef.current.get(choice);
    if (entity) {
      viewer.flyTo(entity);
    }
  }, [choice, status]);

  // ============================================================
  // OPTIONAL NASA GIBS OBSERVATION LAYER
  // ============================================================

  useEffect(() => {
    const viewer = viewerRef.current;

    if (status !== "ready" || !viewer || viewer.isDestroyed()) {
      return;
    }

    if (gibsOn && !gibsLayerRef.current) {
      const provider = new WebMapTileServiceImageryProvider({
        url:
          "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/" +
          `${GIBS_LAYER}/default/{Time}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpeg`,
        layer: GIBS_LAYER,
        style: "default",
        format: "image/jpeg",
        tileMatrixSetID: "GoogleMapsCompatible_Level9",
        maximumLevel: 9,
        dimensions: { Time: observedDate },
        credit: "Imagery: NASA GIBS / Suomi NPP VIIRS",
      });

      gibsLayerRef.current = viewer.imageryLayers.addImageryProvider(provider);
    }

    if (!gibsOn && gibsLayerRef.current) {
      viewer.imageryLayers.remove(gibsLayerRef.current, true);
      gibsLayerRef.current = null;
    }
  }, [gibsOn, status, observedDate]);

  // ============================================================
  // RENDER
  // ============================================================

  const groups = new Map();
  for (const sat of available) {
    if (!groups.has(sat.group)) {
      groups.set(sat.group, []);
    }
    groups.get(sat.group).push(sat);
  }
  const groupNames = [...groups.keys()].sort((a, b) =>
    a === EXISTING_GROUP ? -1 : b === EXISTING_GROUP ? 1 : a.localeCompare(b)
  );

  const chosenMeta = available.find((sat) => sat.name === choice);

  return (
    <>
      <div ref={container} className="le-canvas" />

      <div className="le-overlay">
        <BackToDashboard variant="dark" floating />

        <section className="le-panel le-picker" aria-label="Satellite selection">
          <label className="le-title" htmlFor="le-satellite-select">
            Show satellite
          </label>
          <select
            id="le-satellite-select"
            className="le-select"
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            disabled={status !== "ready"}
          >
            <option value="all">All satellites ({available.length})</option>
            <option value="Moon">Moon</option>
            {groupNames.map((group) => (
              <optgroup key={group} label={group}>
                {groups.get(group).map((sat) => (
                  <option key={sat.name} value={sat.name}>
                    {sat.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <label className="le-check">
            <input
              type="checkbox"
              checked={showAllOrbits}
              onChange={(event) => setShowAllOrbits(event.target.checked)}
              disabled={choice !== "all"}
            />
            <span>Show every orbit</span>
          </label>
          <label className="le-check">
            <input
              type="checkbox"
              checked={showMoonOrbit}
              onChange={(event) => setShowMoonOrbit(event.target.checked)}
            />
            <span>
              Moon orbit
              <small>One sidereal month, approximate</small>
            </span>
          </label>

          {catalogNote && <p className="le-note">{catalogNote}</p>}
        </section>

        {choice !== "all" && (
          <section className="le-panel le-details" aria-live="polite">
            <h2 className="le-title">
              {chosenMeta && (
                <span
                  className="le-chip"
                  style={{ background: chosenMeta.css }}
                  aria-hidden="true"
                />
              )}
              {choice}
            </h2>
            <dl className="le-data">
              {chosenMeta && chosenMeta.group !== EXISTING_GROUP && (
                <>
                  <dt>Country</dt>
                  <dd>{chosenMeta.group}</dd>
                </>
              )}
              {chosenMeta && chosenMeta.role && (
                <>
                  <dt>Role</dt>
                  <dd>{chosenMeta.role}</dd>
                </>
              )}
              {chosenMeta && chosenMeta.noradId && (
                <>
                  <dt>NORAD ID</dt>
                  <dd>{chosenMeta.noradId}</dd>
                </>
              )}
              {chosenMeta && chosenMeta.periodMin && (
                <>
                  <dt>Period</dt>
                  <dd>{chosenMeta.periodMin} min</dd>
                </>
              )}
              {info && (
                <>
                  <dt>Latitude</dt>
                  <dd>{info.lat.toFixed(3)}°</dd>
                  <dt>Longitude</dt>
                  <dd>{info.lon.toFixed(3)}°</dd>
                  <dt>Altitude</dt>
                  <dd>{Math.round(info.altKm).toLocaleString()} km</dd>
                </>
              )}
            </dl>
            <p className="le-note">
              {choice === "Moon"
                ? "Moon position from the Simon1994 planetary model."
                : "Propagated from orbital elements with SGP4. Scene time, not live telemetry."}
              {chosenMeta && chosenMeta.epoch
                ? ` Elements epoch: ${chosenMeta.epoch} UTC.`
                : ""}
            </p>
          </section>
        )}

        <div className="le-clock" role="timer" aria-label="Scene time UTC">
          <span className="le-clock-label">Scene time (UTC)</span>
          <span className="le-clock-value">{sceneTime || "--"}</span>
        </div>

        <section className="le-panel le-layers" aria-label="Earth imagery">
          <h2 className="le-title">Earth imagery</h2>
          <label className="le-check">
            <input
              type="checkbox"
              checked={gibsOn}
              onChange={(event) => setGibsOn(event.target.checked)}
              disabled={status !== "ready"}
            />
            <span>
              NASA GIBS: Suomi NPP / VIIRS true colour
              <small>Observed imagery, not a satellite position source</small>
            </span>
          </label>
          {gibsOn && (
            <p className="le-observed">
              Data observed on <strong>{observedDate}</strong>
            </p>
          )}
        </section>

        {status === "loading" && (
          <div className="le-status" role="status">
            Loading satellite data...
          </div>
        )}

        {status === "error" && (
          <div className="le-status le-error" role="alert">
            Live Earth could not load: {errorMessage}. Check that the backend
            is running at {API_BASE}.
          </div>
        )}
      </div>
    </>
  );
}

export default LiveEarth;