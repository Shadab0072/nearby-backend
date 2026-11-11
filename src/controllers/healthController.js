import mongoose from "mongoose";

/**
 * Health check controller
 * GET /api/health
 * Returns server health and current MongoDB connection state.
 */
export const getHealth = (req, res) => {
  const dbStatusMap = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };

  const dbState = dbStatusMap[mongoose.connection.readyState] || "disconnected";

  res.status(200).json({
    success: true,
    message: "NearbyMosque API is running",
    database: dbState,
  });
};

export default {
  getHealth,
};

