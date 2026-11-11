/**
 * Mosque Discovery Service
 *
 * Acts as the gatekeeper between visitor HTTP requests and the Overpass API.
 *
 * Key responsibilities:
 *   1. Decide whether the requested geographical area needs an Overpass query
 *      (first visit or stale data).
 *   2. If a fresh import is needed, call overpassService, normalise results,
 *      and upsert them into MongoDB without duplicates.
 *   3. After import (or when the cache is still fresh), return all matching
 *      mosque records from MongoDB so the controller can run $geoNear.
 *   4. Never fail the caller's HTTP request because of an Overpass outage —
 *      return whatever MongoDB already holds and attach a warning flag.
 *
 * ── Discovery Cache ───────────────────────────────────────────────────────────
 * Tracking "has this area already been successfully imported?" is done with an
 * in-process Map keyed by a rounded grid-cell string.  The cell size equals the
 * discovery radius so that overlapping but meaningfully different areas still
 * trigger a real Overpass query.
 *
 * The in-process cache is intentionally lightweight:
 *   • It resets on server restart (safe — the data is in MongoDB).
 *   • It prevents redundant Overpass queries within the same process during
 *     normal operation (the most common case).
 *   • MOSQUE_DISCOVERY_REFRESH_HOURS controls how long a cell stays "fresh".
 *
 * ── Duplicate Prevention ──────────────────────────────────────────────────────
 * MongoDB documents for OSM-sourced mosques are uniquely identified by
 * (osmType, osmId).  bulkWrite with updateOne + upsert guarantees that:
 *   • A new element creates exactly one document.
 *   • A re-imported element updates only OSM-sourced fields.
 *   • MosqueSchedule and PrayerCalculation are untouched
 *     because they reference the Mosque _id, not the OSM identity.
 *
 * Environment variables consumed:
 *   MOSQUE_DISCOVERY_RADIUS         – default search radius in metres (5000)
 *   MOSQUE_DISCOVERY_REFRESH_HOURS  – cache TTL in hours (168 = 7 days)
 */

import Mosque from "../models/Mosque.js";
import { fetchNearbyMosquesFromOSM } from "./overpassService.js";
import { enrichWithGeocode } from "./nominatimService.js";

// ── Configuration ─────────────────────────────────────────────────────────────

const DISCOVERY_RADIUS_METERS =
  parseInt(process.env.MOSQUE_DISCOVERY_RADIUS, 10) || 5000;

const REFRESH_HOURS =
  parseInt(process.env.MOSQUE_DISCOVERY_REFRESH_HOURS, 10) || 168; // 7 days

const REFRESH_MS = REFRESH_HOURS * 60 * 60 * 1000;

// ── In-process area cache ─────────────────────────────────────────────────────

/**
 * @type {Map<string, number>}  key → timestamp (ms) of last successful import
 */
const areaCache = new Map();

/**
 * Derives a grid-cell key from coordinates.
 * Cell size equals the discovery radius so that two requests within the same
 * cell share one import while requests that differ by more than a radius always
 * get their own import.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusMeters
 * @returns {string}
 */
const cellKey = (lat, lng, radiusMeters) => {
  // Convert radius from metres to approximate degrees (1° ≈ 111 km)
  const degreeSpan = radiusMeters / 111_000;
  const latCell = Math.floor(lat / degreeSpan);
  const lngCell = Math.floor(lng / degreeSpan);
  return `${latCell}:${lngCell}:${radiusMeters}`;
};

/**
 * Returns true when the in-process cache says this area was recently and
 * successfully imported.
 *
 * @param {string} key
 * @returns {boolean}
 */
const isCacheFresh = (key) => {
  const ts = areaCache.get(key);
  if (!ts) return false;
  return Date.now() - ts < REFRESH_MS;
};

// ── Timezone resolution ───────────────────────────────────────────────────────

/**
 * Determines the IANA timezone string for a mosque location.
 *
 * India-only initial launch: any mosque whose country tag is "IN" or "India",
 * or whose city/state is known to be in India, gets "Asia/Kolkata".
 * Everything else also defaults to "Asia/Kolkata" for now (since all seeded
 * data is Indian).  This function is intentionally left easy to extend later
 * (e.g., with a timezone-lookup library or API).
 *
 * @param {Object} osmData  Normalised OSM element
 * @returns {string}
 */
const resolveTimezone = (osmData) => {
  const country = (osmData.country || "").toLowerCase();

  if (country === "" || country === "in" || country === "india") {
    return "Asia/Kolkata";
  }

  // Future: add more country → timezone mappings here
  // For now, default to IST for the India-only launch
  return "Asia/Kolkata";
};

// ── Normalise OSM element → Mosque document fields ────────────────────────────

/**
 * Converts a normalised OSM element (from overpassService) into a plain object
 * suitable for MongoDB upsert.
 *
 * Fields that must NOT overwrite community data are intentionally excluded from
 * the `$set` payload and kept in a separate `$setOnInsert` payload so they are
 * only written when the document is first created.
 *
 * @param {Object} osm  Normalised OSM element
 * @returns {{ filter: Object, setAlways: Object, setOnInsert: Object }}
 */
const toUpsertPayload = (osm) => {
  const timezone = resolveTimezone(osm);

  // These fields come from OSM and are always refreshed on re-import
  const setAlways = {
    source: "openstreetmap",
    osmId: osm.osmId,
    osmType: osm.osmType,
    lastSyncedAt: new Date(),
    "location.type": "Point",
    "location.coordinates": [osm.lng, osm.lat], // GeoJSON: [lon, lat]
    // Address / metadata from OSM – overwrite if OSM provides better data
    ...(osm.address && { address: osm.address }),
    ...(osm.city && { city: osm.city }),
    ...(osm.state && { state: osm.state }),
    ...(osm.pincode && { pincode: osm.pincode }),
  };

  // name: only update when OSM provides one (don't blank out a community name)
  if (osm.name) {
    setAlways.name = osm.name;
  }

  // These fields are only written when the document is freshly created
  const setOnInsert = {
    country: osm.country || "India",
    timezone,
    isActive: true,
    verificationStatus: "unverified",
    // name fallback when OSM has no name tag
    ...(!osm.name && { name: `Mosque (${osm.osmType}:${osm.osmId})` }),
    // city fallback — required by schema
    ...(!osm.city && { city: "Unknown" }),
  };

  return {
    filter: { osmType: osm.osmType, osmId: osm.osmId },
    setAlways,
    setOnInsert,
  };
};

// ── Import ────────────────────────────────────────────────────────────────────

/**
 * Runs a bulkWrite upsert for all OSM elements returned by Overpass.
 * Returns counts for logging.
 *
 * @param {Array<Object>} osmElements  Normalised OSM elements
 * @returns {Promise<{ upserted: number, modified: number, matched: number }>}
 */
const importOSMElements = async (osmElements) => {
  if (!osmElements.length) {
    return { upserted: 0, modified: 0, matched: 0 };
  }

  const operations = osmElements.map(({ filter, setAlways, setOnInsert }) => ({
    updateOne: {
      filter,
      update: {
        $set: setAlways,
        $setOnInsert: setOnInsert,
      },
      upsert: true,
    },
  }));

  // ordered: false → continue on individual write errors (e.g., validation
  // failures on a single element won't abort the entire batch)
  const result = await Mosque.bulkWrite(operations, { ordered: false });

  return {
    upserted: result.upsertedCount,
    modified: result.modifiedCount,
    matched: result.matchedCount,
  };
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Ensures that mosque data for the requested area exists in MongoDB, triggering
 * an Overpass import when needed, then returns the discovery result.
 *
 * @param {number} lat           Visitor latitude
 * @param {number} lng           Visitor longitude
 * @param {number} [radiusMeters] Search radius (defaults to DISCOVERY_RADIUS_METERS)
 * @returns {Promise<{
 *   imported: number,
 *   updated: number,
 *   fromCache: boolean,
 *   discoveryWarning: string|null
 * }>}
 */
export const discoverMosques = async (lat, lng, radiusMeters) => {
  const radius = radiusMeters || DISCOVERY_RADIUS_METERS;
  const key = cellKey(lat, lng, radius);

  // ── 1. Check in-process cache ──────────────────────────────────────────────
  if (isCacheFresh(key)) {
    console.log(`[MosqueDiscovery] Area cache hit for key "${key}". Skipping Overpass.`);
    return { imported: 0, updated: 0, fromCache: true, discoveryWarning: null };
  }

  // ── 2. Query Overpass ──────────────────────────────────────────────────────
  console.log(`[MosqueDiscovery] Querying Overpass for area key "${key}"…`);

  let osmElements;
  try {
    osmElements = await fetchNearbyMosquesFromOSM(lat, lng, radius);
  } catch (err) {
    console.error(`[MosqueDiscovery] Overpass query failed: ${err.message}`);
    return {
      imported: 0,
      updated: 0,
      fromCache: false,
      discoveryWarning:
        "Mosque discovery service is temporarily unavailable. " +
        "Showing previously cached results.",
    };
  }

  // ── 3. Handle empty Overpass result ───────────────────────────────────────
  // An empty result is legitimate (genuinely no mosques in OSM for this area).
  // We still mark the area as "imported" so we don't hammer Overpass for the
  // same empty area on every visitor request.
  if (!osmElements.length) {
    console.log(
      `[MosqueDiscovery] Overpass returned 0 elements for area "${key}". ` +
      "Caching result to prevent repeated queries."
    );
    areaCache.set(key, Date.now());
    return { imported: 0, updated: 0, fromCache: false, discoveryWarning: null };
  }

  // ── 4. Enrich with reverse geocoding (city, state, country, address) ────
  // Most OSM mosque entries lack addr:city tags. Use Nominatim to resolve
  // each mosque's coordinates into its specific area name and address.
  try {
    osmElements = await enrichWithGeocode(osmElements);
  } catch (err) {
    console.warn(
      `[MosqueDiscovery] Geocode enrichment failed (non-fatal): ${err.message}`
    );
    // Continue with unenriched data — city will use fallback "Unknown"
  }

  // ── 5. Upsert into MongoDB ────────────────────────────────────────────────
  console.log(
    `[MosqueDiscovery] Upserting ${osmElements.length} OSM elements into MongoDB…`
  );

  let counts;
  try {
    const payloads = osmElements.map(toUpsertPayload);
    counts = await importOSMElements(payloads);
  } catch (err) {
    console.error(`[MosqueDiscovery] MongoDB upsert failed: ${err.message}`);
    // Don't cache — we want to retry the import next time
    return {
      imported: 0,
      updated: 0,
      fromCache: false,
      discoveryWarning:
        "Failed to persist discovered mosques. Showing previously cached results.",
    };
  }

  console.log(
    `[MosqueDiscovery] Import complete — ` +
    `${counts.upserted} new, ${counts.modified} updated, ${counts.matched} unchanged.`
  );

  // ── 6. Mark area as freshly imported ─────────────────────────────────────
  areaCache.set(key, Date.now());

  return {
    imported: counts.upserted,
    updated: counts.modified,
    fromCache: false,
    discoveryWarning: null,
  };
};

