import express from "express";
import cors from "cors";
import helmet from "helmet";
import healthRoutes from "./routes/healthRoutes.js";
import mosqueRoutes from "./routes/mosqueRoutes.js";
import timingRoutes from "./routes/timingRoutes.js";
import notFoundHandler from "./middleware/notFoundHandler.js";
import errorHandler from "./middleware/errorHandler.js";

const app = express();

// 1. HTTP Security Headers
app.use(helmet());

// 2. Cross-Origin Resource Sharing (CORS)
const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
app.use(
  cors({
    origin: clientUrl,
    credentials: true,
  })
);

// 3. Body Parsing Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 4. API Routes
app.use("/api/health", healthRoutes);
app.use("/api/mosques", mosqueRoutes);
app.use("/api/mosques", timingRoutes);

// 5. 404 Route Not Found Handler
app.use(notFoundHandler);

// 6. Global Error Handler
app.use(errorHandler);

export default app;

