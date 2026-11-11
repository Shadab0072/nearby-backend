import mongoose from "mongoose";

/**
 * 24-hour time format validator (HH:mm)
 */
const timeFormatValidator = {
  validator: function (v) {
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(v);
  },
  message: (props) => `${props.value} is not a valid 24-hour time format (HH:mm)`,
};

/**
 * Calculated Timings Sub-Schema
 */
const calculatedTimingsSchema = new mongoose.Schema(
  {
    fajr: {
      type: String,
      required: [true, "Fajr timing is required"],
      validate: timeFormatValidator,
    },
    sunrise: {
      type: String,
      required: [true, "Sunrise timing is required"],
      validate: timeFormatValidator,
    },
    dhuhr: {
      type: String,
      required: [true, "Dhuhr timing is required"],
      validate: timeFormatValidator,
    },
    asr: {
      type: String,
      required: [true, "Asr timing is required"],
      validate: timeFormatValidator,
    },
    maghrib: {
      type: String,
      required: [true, "Maghrib timing is required"],
      validate: timeFormatValidator,
    },
    isha: {
      type: String,
      required: [true, "Isha timing is required"],
      validate: timeFormatValidator,
    },
  },
  { _id: false }
);

/**
 * PrayerCalculation Schema
 * Caches calculated prayer times fetched from external providers (e.g., AlAdhan).
 */
const prayerCalculationSchema = new mongoose.Schema(
  {
    mosqueId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Mosque",
      required: [true, "Mosque ID is required"],
      index: true,
    },
    localDate: {
      type: String,
      required: [true, "Local date is required"],
      match: [/^\d{4}-\d{2}-\d{2}$/, "localDate must be in YYYY-MM-DD format"],
    },
    timezone: {
      type: String,
      required: [true, "Timezone is required"],
      trim: true,
    },
    provider: {
      type: String,
      default: "AlAdhan",
      trim: true,
    },
    calculationMethod: {
      type: Number,
      required: [true, "Calculation method is required"],
    },
    asrSchool: {
      type: Number,
      required: [true, "Asr school is required"],
    },
    calculatedTimings: {
      type: calculatedTimingsSchema,
      required: [true, "Calculated timings are required"],
    },
    fetchedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Compound unique index prevents duplicate calculation records for the same mosque, date, and settings
prayerCalculationSchema.index(
  {
    mosqueId: 1,
    localDate: 1,
    calculationMethod: 1,
    asrSchool: 1,
  },
  { unique: true }
);

const PrayerCalculation =
  mongoose.models.PrayerCalculation ||
  mongoose.model("PrayerCalculation", prayerCalculationSchema);

export default PrayerCalculation;

