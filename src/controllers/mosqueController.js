import Mosque from "../models/Mosque.js";
import { discoverMosques } from "../services/mosqueDiscoveryService.js";

/**
 * Controller to fetch mosques within a given radius using geospatial query.
 * GET /api/mosques/nearby
 *
 * Query Parameters:
 *  - lat / latitude  : number (-90 to 90)                       [required]
 *  - lng / lon / longitude : number (-180 to 180)               [required]
 *  - radius          : positive number in meters                 [optional]
 *                      default: 5000, max: 20000
 *
 * Workflow:
 *  1. Validate query parameters.
 *  2. Trigger mosque discovery (Overpass → MongoDB upsert) if the area is new
 *     or stale.  Falls back gracefully if Overpass is unavailable.
 *  3. Run $geoNear aggregation against MongoDB.
 *  4. Return sorted results.
 */
export const getNearbyMosques = async (req, res, next) => {
  try {
    const { lat, latitude, lng, lon, longitude, radius } = req.query;

    const rawLat = lat !== undefined ? lat : latitude;
    const rawLng =
      lng !== undefined ? lng : lon !== undefined ? lon : longitude;

    // ── 1. Validate presence of coordinates ──────────────────────────────────
    if (rawLat === undefined || rawLat === null || rawLat.toString().trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Latitude query parameter ('lat' or 'latitude') is required.",
      });
    }

    if (rawLng === undefined || rawLng === null || rawLng.toString().trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Longitude query parameter ('lng' or 'longitude') is required.",
      });
    }

    // ── 2. Parse and validate coordinate values ──────────────────────────────
    const parsedLat = parseFloat(rawLat);
    const parsedLng = parseFloat(rawLng);

    if (Number.isNaN(parsedLat) || parsedLat < -90 || parsedLat > 90) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid latitude. Latitude must be a numeric value between -90 and 90.",
      });
    }

    if (Number.isNaN(parsedLng) || parsedLng < -180 || parsedLng > 180) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid longitude. Longitude must be a numeric value between -180 and 180.",
      });
    }

    // ── 3. Parse and validate radius ─────────────────────────────────────────
    const DEFAULT_RADIUS_METERS = 5000;
    const MAX_RADIUS_METERS = 20000;
    let parsedRadius = DEFAULT_RADIUS_METERS;

    if (radius !== undefined && radius !== null && radius.toString().trim() !== "") {
      parsedRadius = parseFloat(radius);

      if (Number.isNaN(parsedRadius) || parsedRadius <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid radius. Radius must be a positive number of meters.",
        });
      }

      if (parsedRadius > MAX_RADIUS_METERS) {
        return res.status(400).json({
          success: false,
          message: `Radius exceeds maximum allowed limit of ${MAX_RADIUS_METERS} meters (20 km).`,
        });
      }
    }

    // ── 4. Trigger mosque discovery (Overpass → MongoDB) ─────────────────────
    // This call is cheap when the in-process area cache is warm.
    // It never throws — it returns a warning string instead.
    const discovery = await discoverMosques(parsedLat, parsedLng, parsedRadius);

    if (discovery.discoveryWarning) {
      console.warn(
        `[MosqueController] Discovery warning: ${discovery.discoveryWarning}`
      );
    }

    // ── 5. Geospatial aggregation using $geoNear ─────────────────────────────
    // Notes on $geoNear:
    //  - Must be the first stage in the aggregation pipeline.
    //  - Automatically sorts results by distance (ascending).
    //  - GeoJSON coordinates: [longitude, latitude].
    const mosques = await Mosque.aggregate([
      {
        $geoNear: {
          near: {
            type: "Point",
            coordinates: [parsedLng, parsedLat],
          },
          distanceField: "distanceMeters",
          maxDistance: parsedRadius,
          query: { isActive: true },
          spherical: true,
        },
      },
      { $limit: 50 },
      {
        $project: {
          name: 1,
          address: 1,
          city: 1,
          state: 1,
          country: 1,
          pincode: 1,
          timezone: 1,
          location: 1,
          source: 1,
          osmId: 1,
          osmType: 1,
          verificationStatus: 1,
          lastSyncedAt: 1,
          distanceMeters: { $round: ["$distanceMeters", 0] },
        },
      },
    ]);

    // ── 6. Build response ─────────────────────────────────────────────────────
    const responseBody = {
      success: true,
      count: mosques.length,
      discovery: {
        fromCache: discovery.fromCache,
        newlyImported: discovery.imported,
        updated: discovery.updated,
      },
    };

    if (discovery.discoveryWarning) {
      responseBody.discoveryWarning = discovery.discoveryWarning;
    }

    if (!mosques || mosques.length === 0) {
      responseBody.message =
        "No active mosques found within the specified radius.";
      responseBody.mosques = [];
      return res.status(200).json(responseBody);
    }

    responseBody.mosques = mosques;
    return res.status(200).json(responseBody);
  } catch (error) {
    console.error(
      `[MosqueController] Error finding nearby mosques: ${error.message}`
    );
    return next(error);
  }
};
