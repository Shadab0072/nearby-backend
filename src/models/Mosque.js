import mongoose from "mongoose";

/**
 * GeoJSON Point Sub-Schema
 * Strictly adheres to RFC 7946 GeoJSON format: coordinates are [longitude, latitude].
 */
const pointSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["Point"],
      required: true,
      default: "Point",
    },
    coordinates: {
      type: [Number],
      required: [true, "Location coordinates are required"],
      validate: {
        validator: function (coords) {
          if (!Array.isArray(coords) || coords.length !== 2) {
            return false;
          }
          const [longitude, latitude] = coords;
          return (
            typeof longitude === "number" &&
            typeof latitude === "number" &&
            !Number.isNaN(longitude) &&
            !Number.isNaN(latitude) &&
            longitude >= -180 &&
            longitude <= 180 &&
            latitude >= -90 &&
            latitude <= 90
          );
        },
        message:
          "Coordinates must be an array of [longitude, latitude] where longitude is between -180 and 180, and latitude is between -90 and 90.",
      },
    },
  },
  { _id: false }
);

/**
 * Mosque Schema
 */
const mosqueSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Mosque name is required"],
      trim: true,
    },
    address: {
      type: String,
      trim: true,
      default: "",
    },
    city: {
      type: String,
      required: [true, "City is required"],
      trim: true,
    },
    state: {
      type: String,
      trim: true,
      default: "",
    },
    country: {
      type: String,
      trim: true,
      default: "India",
    },
    pincode: {
      type: String,
      trim: true,
      default: "",
    },
    timezone: {
      type: String,
      required: [true, "Timezone is required"],
      trim: true,
      default: "Asia/Kolkata",
    },
    location: {
      type: pointSchema,
      required: [true, "Location is required"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },

    // ── OSM / Discovery fields ─────────────────────────────────────────────
    /**
     * Where this record originated.
     * "openstreetmap" – imported via Overpass API.
     * "manual"        – hand-entered (seed data, admin entry, etc.).
     */
    source: {
      type: String,
      enum: ["openstreetmap", "manual"],
      default: "manual",
      trim: true,
    },

    /** Numeric ID string of the OSM element (node/way/relation). */
    osmId: {
      type: String,
      trim: true,
      default: null,
    },

    /** OSM element type for this record. */
    osmType: {
      type: String,
      enum: ["node", "way", "relation"],
      default: null,
    },

    /**
     * Community verification status.
     * Imported OSM records start as "unverified".
     */
    verificationStatus: {
      type: String,
      default: "unverified",
      trim: true,
    },

    /** Timestamp of the last successful OSM sync for this record. */
    lastSyncedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// 2dsphere index for MongoDB geospatial queries ($geoNear, $near, $geoWithin)
mosqueSchema.index({ location: "2dsphere" });

/**
 * Unique compound partial index on (osmType, osmId).
 * Only applies to documents that actually carry an OSM identity so that
 * manual / seed records (osmId: null) are never affected.
 */
mosqueSchema.index(
  { osmType: 1, osmId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      osmId: { $exists: true, $ne: null },
      osmType: { $exists: true, $ne: null },
    },
    name: "osm_identity_unique",
  }
);

const Mosque = mongoose.models.Mosque || mongoose.model("Mosque", mosqueSchema);

export default Mosque;

