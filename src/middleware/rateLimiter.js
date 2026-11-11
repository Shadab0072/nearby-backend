import rateLimit from "express-rate-limit";

/**
 * Rate limiter middleware for timing updates.
 * Prevents rapid-fire automated spam and protects community schedule integrity.
 */
export const timingUpdateRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes window
  max: 30, // Limit each IP to 30 timing updates per 15-minute window
  standardHeaders: true, // Return RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  message: {
    success: false,
    message: "Too many timing update requests from this IP. Please try again after 15 minutes.",
  },
});

export default {
  timingUpdateRateLimiter,
};

