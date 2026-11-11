import dotenv from "dotenv";

// Load environment variables before anything else
dotenv.config();

import app from "./app.js";
import connectDB from "./config/db.js";

const PORT = process.env.PORT || 5000;

/**
 * Initializes database connection and boots Express HTTP server.
 */
const startServer = async () => {
  try {
    // 1. Connect to MongoDB
    await connectDB();

    // 2. Start Express server only after successful database connection
    const server = app.listen(PORT, () => {
      console.log(
        `[Server] NearbyMosque backend running in ${process.env.NODE_ENV || "development"} mode on http://localhost:${PORT}`
      );
    });

    // Handle unhandled promise rejections
    process.on("unhandledRejection", (err) => {
      console.error(`[Server] Unhandled Rejection: ${err.message}`);
      server.close(() => process.exit(1));
    });

    // Handle uncaught exceptions
    process.on("uncaughtException", (err) => {
      console.error(`[Server] Uncaught Exception: ${err.message}`);
      process.exit(1);
    });
  } catch (error) {
    console.error(`[Server] Startup error: ${error.message}`);
    process.exit(1);
  }
};

startServer();
