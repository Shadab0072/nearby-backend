/**
 * Cleans time string by stripping any timezone annotations like ' (IST)'
 * Example: '05:02 (IST)' -> '05:02'
 * @param {string} timeStr
 * @returns {string}
 */
const cleanTime = (timeStr) => {
  if (!timeStr) return "";
  return timeStr.split(" ")[0].trim();
};

/**
 * Validates HH:mm 24-hour time format
 * @param {string} timeStr
 * @returns {boolean}
 */
const isValidTimeFormat = (timeStr) => {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(timeStr);
};

/**
 * Fetches prayer timings from the external AlAdhan API.
 *
 * @param {Object} params
 * @param {number} params.latitude - Mosque latitude
 * @param {number} params.longitude - Mosque longitude
 * @param {string} params.localDate - Date in YYYY-MM-DD format
 * @param {string} [params.timezone] - Mosque timezone string (e.g., 'Asia/Kolkata')
 * @param {number} [params.calculationMethod=1] - Calculation method ID (default: 1 Karachi)
 * @param {number} [params.asrSchool=1] - Asr school (0: Shafi, 1: Hanafi)
 * @returns {Promise<Object>} Clean structured prayer calculation data
 */
export const fetchAlAdhanTimings = async ({
  latitude,
  longitude,
  localDate,
  timezone,
  calculationMethod = 1,
  asrSchool = 1,
}) => {
  if (latitude === undefined || longitude === undefined) {
    throw new Error("Latitude and longitude are required to fetch prayer timings.");
  }

  if (!localDate || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    throw new Error(`Invalid localDate format '${localDate}'. Expected YYYY-MM-DD.`);
  }

  // AlAdhan API expects date in DD-MM-YYYY format
  const [year, month, day] = localDate.split("-");
  const aladhanDate = `${day}-${month}-${year}`;

  const queryParams = new URLSearchParams({
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    method: calculationMethod.toString(),
    school: asrSchool.toString(),
  });

  if (timezone) {
    queryParams.append("timezonestring", timezone);
  }

  const url = `https://api.aladhan.com/v1/timings/${aladhanDate}?${queryParams.toString()}`;

  let response;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8-second timeout

    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    clearTimeout(timeoutId);
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("AlAdhan API request timed out after 8 seconds.");
    }
    throw new Error(`AlAdhan network request failed: ${err.message}`);
  }

  if (!response.ok) {
    throw new Error(
      `AlAdhan API returned HTTP ${response.status}: ${response.statusText || "Request failed"}`
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch (parseErr) {
    throw new Error(`Failed to parse AlAdhan API JSON response: ${parseErr.message}`);
  }

  if (!payload || payload.code !== 200 || !payload.data || !payload.data.timings) {
    throw new Error(
      `Invalid response received from AlAdhan API: ${payload?.status || "Incomplete data"}`
    );
  }

  const rawTimings = payload.data.timings;

  const timings = {
    fajr: cleanTime(rawTimings.Fajr),
    sunrise: cleanTime(rawTimings.Sunrise),
    dhuhr: cleanTime(rawTimings.Dhuhr),
    asr: cleanTime(rawTimings.Asr),
    maghrib: cleanTime(rawTimings.Maghrib),
    isha: cleanTime(rawTimings.Isha),
  };

  // Validate that all required timings exist and match HH:mm format
  const requiredKeys = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];
  for (const key of requiredKeys) {
    if (!timings[key] || !isValidTimeFormat(timings[key])) {
      throw new Error(
        `Invalid or missing timing for '${key}': received '${timings[key]}'`
      );
    }
  }

  return {
    provider: "AlAdhan",
    localDate,
    calculationMethod,
    asrSchool,
    timings,
    meta: {
      latitude,
      longitude,
      timezone: payload.data.meta?.timezone || timezone,
      methodName: payload.data.meta?.method?.name,
    },
  };
};

export default {
  fetchAlAdhanTimings,
};

