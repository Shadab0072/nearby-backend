const ALLOWED_ROOT_KEYS = new Set(["expectedVersion", "changes"]);
const ALLOWED_CHANGE_KEYS = new Set(["prayer", "type", "time"]);
const VALID_PRAYERS = new Set(["fajr", "dhuhr", "asr", "maghrib", "isha"]);
const VALID_TYPES = new Set(["azan", "jamaat"]);
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Validates the body of a PATCH /api/mosques/:id/timings request.
 *
 * @param {Object} body
 * @returns {{ isValid: boolean, message?: string }}
 */
export const validateTimingUpdateRequest = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      isValid: false,
      message: "Request body must be a valid JSON object.",
    };
  }

  // Reject unsupported root keys to prevent parameter pollution
  for (const key of Object.keys(body)) {
    if (!ALLOWED_ROOT_KEYS.has(key)) {
      return {
        isValid: false,
        message: `Unsupported field '${key}' in request body.`,
      };
    }
  }

  // Validate expectedVersion
  if (body.expectedVersion === undefined || body.expectedVersion === null) {
    return {
      isValid: false,
      message: "'expectedVersion' is required for optimistic concurrency control.",
    };
  }

  if (
    typeof body.expectedVersion !== "number" ||
    !Number.isInteger(body.expectedVersion) ||
    body.expectedVersion < 0
  ) {
    return {
      isValid: false,
      message: "'expectedVersion' must be a non-negative integer.",
    };
  }

  // Validate changes array
  if (!Array.isArray(body.changes)) {
    return {
      isValid: false,
      message: "'changes' must be an array of timing modifications.",
    };
  }

  if (body.changes.length === 0) {
    return {
      isValid: false,
      message: "At least one timing change must be provided in 'changes'.",
    };
  }

  if (body.changes.length > 5) {
    return {
      isValid: false,
      message: "Maximum 5 prayer changes allowed per request.",
    };
  }

  const seenCombinations = new Set();

  for (let i = 0; i < body.changes.length; i++) {
    const change = body.changes[i];

    if (!change || typeof change !== "object" || Array.isArray(change)) {
      return {
        isValid: false,
        message: `Change item at index ${i} must be an object.`,
      };
    }

    // Check for unsupported keys in change item
    for (const key of Object.keys(change)) {
      if (!ALLOWED_CHANGE_KEYS.has(key)) {
        return {
          isValid: false,
          message: `Unsupported field '${key}' in changes item at index ${i}.`,
        };
      }
    }

    // Validate prayer
    if (!change.prayer || typeof change.prayer !== "string") {
      return {
        isValid: false,
        message: `Missing or invalid 'prayer' at index ${i}.`,
      };
    }
    const prayer = change.prayer.toLowerCase().trim();
    if (!VALID_PRAYERS.has(prayer)) {
      return {
        isValid: false,
        message: `Invalid prayer '${change.prayer}' at index ${i}. Must be one of: fajr, dhuhr, asr, maghrib, isha.`,
      };
    }

    // Validate type
    if (!change.type || typeof change.type !== "string") {
      return {
        isValid: false,
        message: `Missing or invalid 'type' at index ${i}.`,
      };
    }
    const type = change.type.toLowerCase().trim();
    if (!VALID_TYPES.has(type)) {
      return {
        isValid: false,
        message: `Invalid timing type '${change.type}' at index ${i}. Must be 'azan' or 'jamaat'.`,
      };
    }

    // Check duplicate combinations
    const comboKey = `${prayer}:${type}`;
    if (seenCombinations.has(comboKey)) {
      return {
        isValid: false,
        message: `Duplicate change for '${prayer}' ${type} detected at index ${i}. Each prayer/type combination can only be updated once per request.`,
      };
    }
    seenCombinations.add(comboKey);

    // Validate time: strictly HH:mm or null
    if (change.time === undefined) {
      return {
        isValid: false,
        message: `'time' is required at index ${i} (must be 'HH:mm' or null to reset).`,
      };
    }

    if (change.time !== null) {
      if (typeof change.time !== "string" || !TIME_REGEX.test(change.time)) {
        return {
          isValid: false,
          message: `Invalid time format '${change.time}' at index ${i}. Time must be strictly in 24-hour HH:mm format (00:00 to 23:59) or null to reset.`,
        };
      }
    }
  }

  return { isValid: true };
};

export default {
  validateTimingUpdateRequest,
};

