/**
 * Returns current date formatted as YYYY-MM-DD in the specified IANA timezone.
 * Uses native Intl.DateTimeFormat (supported natively in Node.js).
 *
 * @param {string} timezone - e.g. "Asia/Kolkata", "America/New_York"
 * @param {Date} [date=new Date()] - Date object to format
 * @returns {string} Date string in YYYY-MM-DD format
 */
export const getLocalDateInTimezone = (timezone = "UTC", date = new Date()) => {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(date);
  } catch (error) {
    // If timezone is invalid or unrecognized, fallback to UTC
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(date);
  }
};

export default {
  getLocalDateInTimezone,
};

