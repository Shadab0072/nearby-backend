import mongoose from "mongoose";
import Mosque from "../models/Mosque.js";
import PrayerCalculation from "../models/PrayerCalculation.js";
import MosqueSchedule from "../models/MosqueSchedule.js";
import { fetchAlAdhanTimings } from "../services/aladhanService.js";
import { getLocalDateInTimezone } from "../utils/dateUtils.js";
import { validateTimingUpdateRequest } from "../utils/timingValidators.js";

/**
 * Helper to build the combined timing object for a single Salah according to priority rules:
 * Azan:
 *   - If azanOverride.time exists, use custom timing with source: "community"
 *   - Otherwise, use AlAdhan reference with source: "api_reference"
 * Jamaat:
 *   - If jamaat.time exists, use custom timing with source: "community"
 *   - Otherwise, return null with source: "not_set"
 *
 * @param {string} calculatedAzanTime - Reference timing from AlAdhan/PrayerCalculation
 * @param {Object} [scheduleEntry] - Salah entry from MosqueSchedule
 * @returns {Object} { azan: { time, source }, jamaat: { time, source } }
 */
const buildSalahTiming = (calculatedAzanTime, scheduleEntry) => {
  // 1. Azan calculation priority
  const customAzanTime = scheduleEntry?.azanOverride?.time;
  const azan = customAzanTime
    ? {
      time: customAzanTime,
      source: "community",
    }
    : {
      time: calculatedAzanTime || null,
      source: "api_reference",
    };

  // 2. Jamaat calculation priority
  const customJamaatTime = scheduleEntry?.jamaat?.time;
  const jamaat = customJamaatTime
    ? {
      time: customJamaatTime,
      source: "community",
    }
    : {
      time: null,
      source: "not_set",
    };

  return { azan, jamaat };
};

/**
 * Helper to retrieve or automatically initialize MosqueSchedule for a mosque.
 * If no document exists, creates one with null Azan overrides and null Jamaat timings for all 5 Salah.
 *
 * @param {mongoose.Types.ObjectId} mosqueId
 * @param {mongoose.ClientSession} [session] - Optional Mongoose session for transactions
 * @returns {Promise<Object>} MosqueSchedule document
 */
const getOrInitializeMosqueSchedule = async (mosqueId, session = null) => {
  const query = MosqueSchedule.findOne({ mosqueId });
  if (session) query.session(session);
  let schedule = await query;

  if (!schedule) {
    try {
      const createOptions = session ? { session } : {};
      const [newSchedule] = await MosqueSchedule.create(
        [
          {
            mosqueId,
            timings: {
              fajr: { azanOverride: { time: null, updatedAt: null }, jamaat: { time: null, updatedAt: null } },
              dhuhr: { azanOverride: { time: null, updatedAt: null }, jamaat: { time: null, updatedAt: null } },
              asr: { azanOverride: { time: null, updatedAt: null }, jamaat: { time: null, updatedAt: null } },
              maghrib: { azanOverride: { time: null, updatedAt: null }, jamaat: { time: null, updatedAt: null } },
              isha: { azanOverride: { time: null, updatedAt: null }, jamaat: { time: null, updatedAt: null } },
            },
            version: 0,
          },
        ],
        createOptions
      );
      schedule = newSchedule;
    } catch (err) {
      if (err.code === 11000) {
        // Race condition: another concurrent request created the schedule
        const retryQuery = MosqueSchedule.findOne({ mosqueId });
        if (session) retryQuery.session(session);
        schedule = await retryQuery;
      } else {
        throw err;
      }
    }
  }

  return schedule;
};

/**
 * Helper to retrieve today's reference calculations from AlAdhan/PrayerCalculation.
 *
 * @param {Object} mosque
 * @returns {Promise<Object>} PrayerCalculation document or null
 */
const getReferenceCalculationForToday = async (mosque) => {
  const timezone = mosque.timezone || "Asia/Kolkata";
  const localDate = getLocalDateInTimezone(timezone);
  const calculationMethod = parseInt(process.env.ALADHAN_CALCULATION_METHOD, 10) || 1;
  const asrSchool = parseInt(process.env.ALADHAN_ASR_SCHOOL, 10) || 1;

  let referenceCalculation = await PrayerCalculation.findOne({
    mosqueId: mosque._id,
    localDate,
    calculationMethod,
    asrSchool,
  });

  if (!referenceCalculation) {
    try {
      const [longitude, latitude] = mosque.location.coordinates;
      const apiData = await fetchAlAdhanTimings({
        latitude,
        longitude,
        localDate,
        timezone,
        calculationMethod,
        asrSchool,
      });

      referenceCalculation = await PrayerCalculation.create({
        mosqueId: mosque._id,
        localDate,
        timezone,
        provider: "AlAdhan",
        calculationMethod,
        asrSchool,
        calculatedTimings: apiData.timings,
        fetchedAt: new Date(),
      });
    } catch (err) {
      // Fallback: use latest calculation if network fails
      referenceCalculation = await PrayerCalculation.findOne({
        mosqueId: mosque._id,
      }).sort({ localDate: -1 });
    }
  }

  return referenceCalculation;
};

/**
 * Controller to get combined prayer timings for a specific mosque
 * GET /api/mosques/:id/timings
 */
export const getMosquePrayerTimings = async (req, res, next) => {
  try {
    const { id } = req.params;

    // 1. Validate MongoDB ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Mosque ID format. Must be a valid 24-character hexadecimal ObjectId.",
      });
    }

    // 2. Find Mosque in database
    const mosque = await Mosque.findById(id);
    if (!mosque) {
      return res.status(404).json({
        success: false,
        message: "Mosque not found.",
      });
    }

    // 3. Extract latitude, longitude and timezone
    if (
      !mosque.location ||
      !Array.isArray(mosque.location.coordinates) ||
      mosque.location.coordinates.length !== 2
    ) {
      return res.status(400).json({
        success: false,
        message: "Mosque does not have valid geographic coordinates configured.",
      });
    }

    const [longitude, latitude] = mosque.location.coordinates;
    const timezone = mosque.timezone || "Asia/Kolkata";

    // 4. Calculate local date in the mosque's timezone
    let localDate;
    if (req.query.date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format in query parameter. Expected YYYY-MM-DD.",
        });
      }
      localDate = req.query.date;
    } else {
      localDate = getLocalDateInTimezone(timezone);
    }

    // 5. Configurable calculation settings (with env defaults)
    const calculationMethod =
      req.query.method !== undefined
        ? parseInt(req.query.method, 10)
        : parseInt(process.env.ALADHAN_CALCULATION_METHOD, 10) || 1;

    const asrSchool =
      req.query.school !== undefined
        ? parseInt(req.query.school, 10)
        : parseInt(process.env.ALADHAN_ASR_SCHOOL, 10) || 1;

    if (Number.isNaN(calculationMethod) || calculationMethod < 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid calculation method. Must be a positive integer ID.",
      });
    }

    if (Number.isNaN(asrSchool) || ![0, 1].includes(asrSchool)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Asr school. Must be 0 (Shafi) or 1 (Hanafi).",
      });
    }

    // 6. Check cache in MongoDB (PrayerCalculation collection)
    let referenceCalculation = await PrayerCalculation.findOne({
      mosqueId: mosque._id,
      localDate,
      calculationMethod,
      asrSchool,
    });

    let isFallback = false;

    // 7. If no cache found: Fetch from AlAdhan external service
    if (!referenceCalculation) {
      try {
        const apiData = await fetchAlAdhanTimings({
          latitude,
          longitude,
          localDate,
          timezone,
          calculationMethod,
          asrSchool,
        });

        // Save calculation into PrayerCalculation (idempotent against concurrent requests)
        try {
          referenceCalculation = await PrayerCalculation.create({
            mosqueId: mosque._id,
            localDate,
            timezone,
            provider: "AlAdhan",
            calculationMethod,
            asrSchool,
            calculatedTimings: apiData.timings,
            fetchedAt: new Date(),
          });
        } catch (saveError) {
          if (saveError.code === 11000) {
            referenceCalculation = await PrayerCalculation.findOne({
              mosqueId: mosque._id,
              localDate,
              calculationMethod,
              asrSchool,
            });
          } else {
            throw saveError;
          }
        }
      } catch (apiError) {
        console.error(
          `[TimingController] AlAdhan API call failed for mosque '${mosque.name}' (${mosque._id}): ${apiError.message}`
        );

        // Fallback: Check if ANY existing cached calculation exists for this mosque
        referenceCalculation = await PrayerCalculation.findOne({
          mosqueId: mosque._id,
          calculationMethod,
          asrSchool,
        }).sort({ localDate: -1 });

        if (referenceCalculation) {
          isFallback = true;
        } else {
          return res.status(502).json({
            success: false,
            message: `External prayer times provider unavailable: ${apiError.message}`,
          });
        }
      }
    }

    // 8. Retrieve or automatically initialize MosqueSchedule
    const schedule = await getOrInitializeMosqueSchedule(mosque._id);

    // 9. Combine calculations according to business priority rules
    const calculatedTimings = referenceCalculation.calculatedTimings;
    const scheduleTimings = schedule.timings || {};

    const timings = {
      fajr: buildSalahTiming(calculatedTimings.fajr, scheduleTimings.fajr),
      dhuhr: buildSalahTiming(calculatedTimings.dhuhr, scheduleTimings.dhuhr),
      asr: buildSalahTiming(calculatedTimings.asr, scheduleTimings.asr),
      maghrib: buildSalahTiming(calculatedTimings.maghrib, scheduleTimings.maghrib),
      isha: buildSalahTiming(calculatedTimings.isha, scheduleTimings.isha),
    };

    // 10. Return combined response
    const responsePayload = {
      success: true,
      mosque: {
        name: mosque.name,
        timezone: mosque.timezone,
      },
      date: referenceCalculation.localDate,
      timings,
    };

    if (isFallback) {
      responsePayload.warning = `External API currently unavailable. Azan references based on latest calculation from ${referenceCalculation.localDate}.`;
    }

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error(`[TimingController] Error fetching combined prayer timings: ${error.message}`);
    return next(error);
  }
};

/**
 * Controller to update Azan and Jamaat timings for a mosque (community editing)
 * PATCH /api/mosques/:id/timings
 */
export const updateMosqueTimings = async (req, res, next) => {
  const { id } = req.params;

  // 1. Validate MongoDB ObjectId format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid Mosque ID format. Must be a valid 24-character hexadecimal ObjectId.",
    });
  }

  // 2. Validate request body (fields, types, format, limits)
  const validation = validateTimingUpdateRequest(req.body);
  if (!validation.isValid) {
    return res.status(400).json({
      success: false,
      message: validation.message,
    });
  }

  // 3. Verify Mosque existence
  const mosque = await Mosque.findById(id);
  if (!mosque) {
    return res.status(404).json({
      success: false,
      message: "Mosque not found.",
    });
  }

  // 4. Start MongoDB Transaction Session
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 5. Retrieve or initialize MosqueSchedule within transaction
    const schedule = await getOrInitializeMosqueSchedule(mosque._id, session);

    // 6. Optimistic Concurrency Control Check
    const { expectedVersion, changes } = req.body;
    if (schedule.version !== expectedVersion) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({
        success: false,
        message: "Version conflict: The schedule has been modified by another request.",
        currentVersion: schedule.version,
        expectedVersion,
      });
    }

    // 7. Apply timing changes
    const updatedPrayers = new Set();
    const now = new Date();

    for (const change of changes) {
      const prayer = change.prayer.toLowerCase().trim();
      const type = change.type.toLowerCase().trim();
      const newTime = change.time;

      updatedPrayers.add(prayer);

      if (type === "azan") {
        schedule.timings[prayer].azanOverride = {
          time: newTime,
          updatedAt: now,
        };
      } else if (type === "jamaat") {
        schedule.timings[prayer].jamaat = {
          time: newTime,
          updatedAt: now,
        };
      }
    }

    // 8. Increment version
    schedule.version += 1;

    // 9. Persist schedule changes
    await schedule.save({ session });

    // 10. Commit transaction
    await session.commitTransaction();
    session.endSession();

    // 11. Retrieve today's reference calculations for response construction
    const referenceCalculation = await getReferenceCalculationForToday(mosque);
    const calculatedTimings = referenceCalculation?.calculatedTimings || {};

    // 12. Build updatedTimings object for all modified prayers
    const updatedTimings = {};
    for (const prayer of updatedPrayers) {
      const calculatedAzanTime = calculatedTimings[prayer] || null;
      updatedTimings[prayer] = buildSalahTiming(calculatedAzanTime, schedule.timings[prayer]);
    }

    return res.status(200).json({
      success: true,
      message: "Mosque timings updated successfully",
      version: schedule.version,
      updatedTimings,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    console.error(`[TimingController] Error updating mosque timings: ${error.message}`);
    return next(error);
  }
};

export default {
  getMosquePrayerTimings,
  updateMosqueTimings,
};
