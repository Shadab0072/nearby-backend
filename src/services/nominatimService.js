/**
 * Nominatim Reverse Geocoding Service
 *
 * Resolves latitude/longitude coordinates into structured address components
 * (city, state, country, address, pincode) using the OpenStreetMap Nominatim API.
 *
 * Usage policy (https://operations.osmfoundation.org/policies/nominatim/):
 *   - Maximum 1 request per second
 *   - Valid User-Agent required
 *   - No heavy bulk geocoding on the public instance
 *
 * Each mosque is geocoded individually so every mosque gets its own accurate
 * area name, road, and pincode.  The 1-req/sec rate limit is enforced
 * automatically — for 5 mosques this adds ~5 seconds to the first import
 * (subsequent requests are served from MongoDB cache, so no extra delay).
 *
 * Environment variables:
 *   NOMINATIM_API_URL  – Override the Nominatim endpoint (default: public instance)
 */

const NOMINATIM_API_URL =
  process.env.NOMINATIM_API_URL ||
  "https://nominatim.openstreetmap.org/reverse";

const NOMINATIM_TIMEOUT_MS = 10000;

/**
 * Rate-limiter: Nominatim requires max 1 req/sec on the public instance.
 * @type {number}  Timestamp of the last request
 */
let lastRequestTimestamp = 0;

/**
 * Enforces a minimum 1100ms gap between Nominatim requests.
 */
const enforceRateLimit = async () => {
  const elapsed = Date.now() - lastRequestTimestamp;
  if (elapsed < 1100) {
    await new Promise((resolve) => setTimeout(resolve, 1100 - elapsed));
  }
};

/**
 * Reverse geocodes a single coordinate pair into address components.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{
 *   address: string,
 *   city: string|null,
 *   state: string|null,
 *   country: string|null,
 *   pincode: string|null,
 *   countryCode: string|null
 * }>}
 */
export const reverseGeocode = async (lat, lng) => {
  const fallback = {
    address: "",
    city: null,
    state: null,
    country: null,
    pincode: null,
    countryCode: null,
  };

  try {
    await enforceRateLimit();

    const url = `${NOMINATIM_API_URL}?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent":
            "NearbyMosque/1.0 (https://nearbymosque.org; info@nearbymosque.org)",
          Accept: "application/json",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    lastRequestTimestamp = Date.now();

    if (!response.ok) {
      console.warn(
        `[NominatimService] HTTP ${response.status} for (${lat}, ${lng}).`
      );
      return fallback;
    }

    const data = await response.json();
    if (!data || !data.address) {
      return fallback;
    }

    const addr = data.address;

    // Resolve city: Nominatim returns it under various keys depending on location
    const city =
      addr.city ||
      addr.town ||
      addr.village ||
      addr.municipality ||
      addr.county ||
      null;

    // Build a specific street-level address for THIS location
    const addressParts = [
      addr.road,
      addr.neighbourhood,
      addr.suburb,
      addr.city_district,
    ].filter(Boolean);

    return {
      address: addressParts.join(", "),
      city: city ? city.trim() : null,
      state: addr.state ? addr.state.trim() : null,
      country: addr.country ? addr.country.trim() : null,
      pincode: addr.postcode ? addr.postcode.trim() : null,
      countryCode: addr.country_code ? addr.country_code.toUpperCase() : null,
    };
  } catch (error) {
    console.warn(
      `[NominatimService] Reverse geocoding failed for (${lat}, ${lng}): ${error.message}`
    );
    return fallback;
  }
};

/**
 * Enriches an array of normalised OSM mosque elements with address data
 * from Nominatim reverse geocoding.
 *
 * Each mosque is geocoded INDIVIDUALLY using its own coordinates so that
 * every mosque gets its exact area name, road, and pincode.
 *
 * Rate limit: ~1 request per second (enforced by enforceRateLimit).
 * For 5 mosques this adds ~5 seconds to the first import.
 * Subsequent visitor requests are served from MongoDB — no geocoding needed.
 *
 * @param {Array<Object>} mosques  Normalised OSM elements
 * @returns {Promise<Array<Object>>}  Enriched mosque elements
 */
export const enrichWithGeocode = async (mosques) => {
  if (!mosques || mosques.length === 0) return mosques;

  // Check if any mosque needs enrichment
  const needsEnrichment = mosques.some((m) => !m.city || !m.address);
  if (!needsEnrichment) {
    console.log(
      "[NominatimService] All mosques already have address data. Skipping geocoding."
    );
    return mosques;
  }

  console.log(
    `[NominatimService] Reverse geocoding ${mosques.length} mosque(s) individually…`
  );

  const enriched = [];

  for (let i = 0; i < mosques.length; i++) {
    const mosque = mosques[i];

    // Skip geocoding if this mosque already has full address data from OSM tags
    if (mosque.city && mosque.address) {
      enriched.push(mosque);
      continue;
    }

    console.log(
      `[NominatimService] (${i + 1}/${mosques.length}) Geocoding ${mosque.name || mosque.osmId} ` +
        `at (${mosque.lat}, ${mosque.lng})…`
    );

    const geo = await reverseGeocode(mosque.lat, mosque.lng);

    enriched.push({
      ...mosque,
      address: mosque.address || geo.address,
      city: mosque.city || geo.city,
      state: mosque.state || geo.state,
      country: mosque.country || geo.country,
      pincode: mosque.pincode || geo.pincode,
    });
  }

  console.log(`[NominatimService] Geocoding complete for ${enriched.length} mosque(s).`);
  return enriched;
};
