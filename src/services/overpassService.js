/**
 * Overpass API Service
 *
 * Fetches mosque-related OSM elements (nodes, ways, relations) near a given
 * coordinate pair — for ANY location worldwide.
 *
 * Nodes carry their own lat/lon; ways and relations use the `out center`
 * directive so the Overpass API returns a single representative centroid for
 * each polygon / multi-polygon element.
 *
 * Multiple public Overpass mirrors are tried in order so that a single slow or
 * rate-limited server does not block the request.  The primary endpoint is read
 * from the environment; additional fallbacks are built-in.
 *
 * Usage limits:
 *   - Public Overpass servers enforce fair-use rate limits.
 *   - This service must never be called on every visitor HTTP request.
 *     Use mosqueDiscoveryService.js as the gatekeeper.
 *
 * Environment variables consumed:
 *   OVERPASS_API_URL          – Primary Overpass interpreter endpoint
 *   OVERPASS_TIMEOUT_MS       – Per-request AbortController timeout in ms (default: 30000)
 *   OVERPASS_MAX_RETRIES      – Attempts per endpoint before moving to next (default: 1)
 *   OVERPASS_RETRY_DELAY_MS   – Delay between retries in ms (default: 2000)
 */

const OVERPASS_TIMEOUT_MS = parseInt(process.env.OVERPASS_TIMEOUT_MS, 10) || 60000;
const OVERPASS_MAX_RETRIES = parseInt(process.env.OVERPASS_MAX_RETRIES, 10) || 2;
const OVERPASS_RETRY_DELAY_MS =
  parseInt(process.env.OVERPASS_RETRY_DELAY_MS, 10) || 3000;

/**
 * Ordered list of Overpass API endpoints to try.
 * The primary endpoint from the environment is always tried first.
 * Built-in fallbacks cover outages on any single public server.
 */
const OVERPASS_ENDPOINTS = [
  process.env.OVERPASS_API_URL || "https://overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
].filter(
  // Deduplicate in case the env var matches a built-in fallback
  (url, index, arr) => arr.indexOf(url) === index
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Pauses execution for `ms` milliseconds.
 * @param {number} ms
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Builds an Overpass QL query that fetches:
 *   • nodes tagged amenity=place_of_worship + religion=muslim
 *   • nodes tagged building=mosque
 *   • ways  (same tags) with center coordinates
 *   • relations (same tags) with center coordinates
 *
 * All within `radiusMeters` of the given lat/lon.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusMeters
 * @returns {string} Overpass QL query string
 */
const buildOverpassQuery = (lat, lng, radiusMeters) => {
  // [out:json]  → JSON output format
  // [timeout:N] → server-side query timeout (seconds); kept conservatively below
  //               the client-side AbortController timeout
  const serverTimeoutSec = Math.floor(OVERPASS_TIMEOUT_MS / 1000) - 5;

  return `
[out:json][timeout:${serverTimeoutSec}];
(
  node["amenity"="place_of_worship"]["religion"="muslim"](around:${radiusMeters},${lat},${lng});
  node["building"="mosque"](around:${radiusMeters},${lat},${lng});
  way["amenity"="place_of_worship"]["religion"="muslim"](around:${radiusMeters},${lat},${lng});
  way["building"="mosque"](around:${radiusMeters},${lat},${lng});
  relation["amenity"="place_of_worship"]["religion"="muslim"](around:${radiusMeters},${lat},${lng});
  relation["building"="mosque"](around:${radiusMeters},${lat},${lng});
);
out center tags;
`.trim();
};

// ── Normalisation ─────────────────────────────────────────────────────────────

/**
 * Extracts a human-readable address string from OSM tags.
 * Falls back gracefully when tags are absent or partial.
 *
 * @param {Object} tags  OSM tags object
 * @returns {string}
 */
const extractAddress = (tags) => {
  if (!tags || typeof tags !== "object") return "";

  const parts = [
    tags["addr:housenumber"],
    tags["addr:street"],
    tags["addr:suburb"],
    tags["addr:neighbourhood"],
  ].filter(Boolean);

  return parts.join(", ");
};

/**
 * Resolves lat/lon from an OSM element.
 * Nodes carry top-level `lat`/`lon`.
 * Ways and relations expose a `center` object when queried with `out center`.
 *
 * @param {Object} element  Raw OSM element from Overpass response
 * @returns {{ lat: number|null, lng: number|null }}
 */
const resolveCoordinates = (element) => {
  if (element.type === "node" && element.lat != null && element.lon != null) {
    return { lat: element.lat, lng: element.lon };
  }

  if (element.center && element.center.lat != null && element.center.lon != null) {
    return { lat: element.center.lat, lng: element.center.lon };
  }

  return { lat: null, lng: null };
};

/**
 * Normalises a single raw Overpass element into a structured object.
 * Returns `null` when the element cannot produce usable coordinates.
 *
 * @param {Object} element  Raw OSM element
 * @returns {Object|null}
 */
const normaliseElement = (element) => {
  const { lat, lng } = resolveCoordinates(element);

  // Elements without resolvable coordinates are unusable
  if (lat === null || lng === null) {
    console.warn(
      `[OverpassService] Skipping OSM ${element.type}/${element.id}: no coordinates available.`
    );
    return null;
  }

  const tags = element.tags || {};

  // Name resolution: prefer the localised English tag, then the generic name tag
  const name =
    (tags["name:en"] || tags["name"] || "").trim() || null;

  return {
    osmId: String(element.id),
    osmType: element.type, // "node" | "way" | "relation"
    name,                  // null when OSM element has no name tag
    lat,
    lng,
    address: extractAddress(tags),
    city:    (tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || "").trim() || null,
    state:   (tags["addr:state"] || tags["addr:province"] || "").trim() || null,
    country: (tags["addr:country"] || "").trim() || null,
    pincode: (tags["addr:postcode"] || "").trim() || null,
    rawTags: tags, // retained for debugging; not persisted in MongoDB
  };
};

// ── Core fetch ────────────────────────────────────────────────────────────────

/**
 * Sends a POST request to a single Overpass endpoint with the given QL query.
 * Implements an AbortController timeout and marks transient errors so the
 * caller can fall over to the next endpoint.
 *
 * @param {string} endpointUrl  Full Overpass interpreter URL to use
 * @param {string} query        Overpass QL query string
 * @returns {Promise<Object>}   Parsed JSON response body
 * @throws {Error} with `.isTransient = true` for retriable / fallback-able failures
 */
const fetchFromOverpass = async (endpointUrl, query) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "NearbyMosque/1.0 (https://nearbymosque.org; info@nearbymosque.org)",
        Accept: "*/*",
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
  } catch (networkError) {
    const err = new Error(
      networkError.name === "AbortError"
        ? `Overpass endpoint ${endpointUrl} timed out after ${OVERPASS_TIMEOUT_MS}ms`
        : `Overpass network error on ${endpointUrl}: ${networkError.message}`
    );
    err.isTransient = true;
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  // 429 Too Many Requests – try next endpoint
  if (response.status === 429) {
    const err = new Error(`Overpass rate limit on ${endpointUrl} (HTTP 429).`);
    err.isTransient = true;
    throw err;
  }

  // 5xx – transient server-side problem, try next endpoint
  if (response.status >= 500) {
    const err = new Error(`Overpass server error on ${endpointUrl} (HTTP ${response.status}).`);
    err.isTransient = true;
    throw err;
  }

  if (!response.ok) {
    throw new Error(`Overpass ${endpointUrl} returned HTTP ${response.status}.`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Overpass ${endpointUrl} returned an invalid JSON response.`);
  }

  if (!data || !Array.isArray(data.elements)) {
    throw new Error(`Overpass ${endpointUrl} response is missing the 'elements' array.`);
  }

  return data;
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Queries the Overpass API for mosques near the given coordinates worldwide.
 *
 * Automatically cycles through OVERPASS_ENDPOINTS when a server is slow,
 * rate-limiting, or unreachable.  Within each endpoint, up to
 * OVERPASS_MAX_RETRIES attempts are made before moving on.
 *
 * Returns an empty array when every reachable server reports no matching OSM
 * elements.  Throws only when ALL endpoints fail.
 *
 * @param {number} lat           Decimal latitude  (-90 … +90)  — any location worldwide
 * @param {number} lng           Decimal longitude (-180 … +180) — any location worldwide
 * @param {number} radiusMeters  Search radius in metres
 * @returns {Promise<Array<Object>>}  Normalised mosque objects (no nulls)
 */
export const fetchNearbyMosquesFromOSM = async (lat, lng, radiusMeters) => {
  const query = buildOverpassQuery(lat, lng, radiusMeters);

  let lastError;

  // ── Try each endpoint in order ─────────────────────────────────────────────
  for (const endpoint of OVERPASS_ENDPOINTS) {
    let attemptError;

    for (let attempt = 1; attempt <= OVERPASS_MAX_RETRIES; attempt++) {
      try {
        console.log(
          `[OverpassService] Trying endpoint "${endpoint}" ` +
            `(attempt ${attempt}/${OVERPASS_MAX_RETRIES}) ` +
            `— ${radiusMeters}m around (${lat}, ${lng})`
        );

        const data = await fetchFromOverpass(endpoint, query);
        const raw = data.elements || [];

        console.log(
          `[OverpassService] ✓ ${endpoint} returned ${raw.length} OSM elements.`
        );

        const normalised = raw.map(normaliseElement).filter(Boolean);
        const skipped = raw.length - normalised.length;

        if (skipped > 0) {
          console.log(
            `[OverpassService] ${skipped} element(s) skipped (no resolvable coordinates).`
          );
        }

        console.log(
          `[OverpassService] ${normalised.length} usable mosque(s) ready for import.`
        );

        return normalised; // ← success, stop here
      } catch (err) {
        attemptError = err;
        lastError = err;

        if (!err.isTransient) {
          // Non-transient (e.g. 400 bad query) — no point retrying this endpoint
          break;
        }

        if (attempt < OVERPASS_MAX_RETRIES) {
          const delay = OVERPASS_RETRY_DELAY_MS * attempt;
          console.warn(
            `[OverpassService] Attempt ${attempt} on ${endpoint} failed: ${err.message}. ` +
              `Retrying in ${delay}ms…`
          );
          await sleep(delay);
        }
      }
    }

    // This endpoint exhausted — try the next one
    console.warn(
      `[OverpassService] All attempts on ${endpoint} failed ` +
        `(${attemptError?.message}). Trying next endpoint…`
    );
  }

  // All endpoints exhausted
  console.error(
    `[OverpassService] All ${OVERPASS_ENDPOINTS.length} Overpass endpoint(s) failed. Last error: ${lastError?.message}`
  );
  throw lastError;
};

