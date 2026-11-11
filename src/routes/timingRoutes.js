import { Router } from "express";
import {
  getMosquePrayerTimings,
  updateMosqueTimings,
} from "../controllers/timingController.js";
import { timingUpdateRateLimiter } from "../middleware/rateLimiter.js";

const router = Router();

// GET /api/mosques/:id/timings - Get combined prayer timings for a mosque
router.get("/:id/timings", getMosquePrayerTimings);

// PATCH /api/mosques/:id/timings - Update Azan and Jamaat timings with rate limiting
router.patch("/:id/timings", timingUpdateRateLimiter, updateMosqueTimings);

export default router;
