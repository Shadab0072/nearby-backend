import mongoose from "mongoose";

/**
 * Connect to MongoDB database using Mongoose.
 * Reads MONGODB_URI from environment variables.
 * Logs connection status and handles connection events.
 */
export const connectDB = async () => {
  const mongoURI = process.env.MONGODB_URI;

  if (!mongoURI || mongoURI === "your_mongodb_connection_string") {
    throw new Error(
      "MONGODB_URI is not configured in .env file. Please provide a valid MongoDB connection string."
    );
  }

  try {
    const conn = await mongoose.connect(mongoURI);
    console.log(`[Database] MongoDB connected successfully: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error(`[Database] MongoDB connection failed: ${error.message}`);
    throw error;
  }
};

// Listen for connection events
mongoose.connection.on("disconnected", () => {
  console.warn("[Database] MongoDB connection lost.");
});

mongoose.connection.on("reconnected", () => {
  console.log("[Database] MongoDB reconnected successfully.");
});

export default connectDB;

