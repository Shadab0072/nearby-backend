import mongoose from "mongoose";

/**
 * 24-hour time format validator (HH:mm) allowing null / undefined
 */
const timeFormatValidator = {
  validator: function (v) {
    if (v === null || v === undefined) return true;
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(v);
  },
  message: (props) => `${props.value} is not a valid 24-hour time format (HH:mm)`,
};

/**
 * Reusable Sub-Schema for Timing Entries (Azan override or Jamaat time)
 */
const timingEntrySchema = new mongoose.Schema(
  {
    time: {
      type: String,
      default: null,
      validate: timeFormatValidator,
      trim: true,
    },
    updatedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

/**
 * Reusable Sub-Schema for an individual Salah schedule
 */
const prayerScheduleEntrySchema = new mongoose.Schema(
  {
    azanOverride: {
      type: timingEntrySchema,
      default: () => ({ time: null, updatedAt: null }),
    },
    jamaat: {
      type: timingEntrySchema,
      default: () => ({ time: null, updatedAt: null }),
    },
  },
  { _id: false }
);

/**
 * MosqueSchedule Schema
 * Represents the community-managed schedule (custom Azan overrides and Jamaat times) for a Mosque.
 */
const mosqueScheduleSchema = new mongoose.Schema(
  {
    mosqueId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Mosque",
      required: [true, "Mosque ID is required"],
      unique: true,
      index: true,
    },
    timings: {
      fajr: {
        type: prayerScheduleEntrySchema,
        default: () => ({}),
      },
      dhuhr: {
        type: prayerScheduleEntrySchema,
        default: () => ({}),
      },
      asr: {
        type: prayerScheduleEntrySchema,
        default: () => ({}),
      },
      maghrib: {
        type: prayerScheduleEntrySchema,
        default: () => ({}),
      },
      isha: {
        type: prayerScheduleEntrySchema,
        default: () => ({}),
      },
    },
    version: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

const MosqueSchedule =
  mongoose.models.MosqueSchedule ||
  mongoose.model("MosqueSchedule", mosqueScheduleSchema);

export default MosqueSchedule;

