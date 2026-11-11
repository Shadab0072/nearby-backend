import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import Mosque from "../models/Mosque.js";
import connectDB from "../config/db.js";

/**
 * 10 Sample Mosques in and around Lucknow, Uttar Pradesh, India
 * Coordinates format: [longitude, latitude] (GeoJSON standard)
 */
/**
 * Development-only sample mosques for Lucknow, Uttar Pradesh.
 *
 * These records are explicitly marked source:"manual" and verificationStatus:"development"
 * so they are never confused with real OSM-imported mosque data.
 * osmId and osmType remain null — the unique partial index on (osmType, osmId)
 * does NOT apply to these documents.
 */
const sampleMosques = [
  {
    name: "Asafi Masjid",
    address: "Husainabad Trust Rd, Machchhi Bhavan",
    city: "Lucknow",
    state: "Uttar Pradesh",
    country: "India",
    pincode: "226003",
    timezone: "Asia/Kolkata",
    location: { type: "Point", coordinates: [80.9128, 26.8689] },
    isActive: true,
    source: "manual",
    verificationStatus: "development",
    osmId: null,
    osmType: null,
  },
  {
    name: "Teele Wali Masjid",
    address: "Near Pucca Pul, Hardoi Road, Hussainabad",
    city: "Lucknow",
    state: "Uttar Pradesh",
    country: "India",
    pincode: "226003",
    timezone: "Asia/Kolkata",
    location: { type: "Point", coordinates: [80.9192, 26.8664] },
    isActive: true,
    source: "manual",
    verificationStatus: "development",
    osmId: null,
    osmType: null,
  },
  {
    name: "Jama Masjid",
    address: "Hussainabad, Daulatganj",
    city: "Lucknow",
    state: "Uttar Pradesh",
    country: "India",
    pincode: "226003",
    timezone: "Asia/Kolkata",
    location: { type: "Point", coordinates: [80.9065, 26.8716] },
    isActive: true,
    source: "manual",
    verificationStatus: "development",
    osmId: null,
    osmType: null,
  },
  {
    name: "Chhota Imambara Mosque",
    address: "Tahsin Ganj, Husainabad",
    city: "Lucknow",
    state: "Uttar Pradesh",
    country: "India",
    pincode: "226003",
    timezone: "Asia/Kolkata",
    location: { type: "Point", coordinates: [80.9045, 26.8741] },
    isActive: true,
    source: "manual",
    verificationStatus: "development",
    osmId: null,
    osmType: null,
  },
  {
    name: "Dargah Hazrat Abbas Masjid",
    address: "Rustam Nagar, Rajajipuram",
    city: "Lucknow",
    state: "Uttar Pradesh",
    country: "India",
    pincode: "226003",
    timezone: "Asia/Kolkata",
    location: { type: "Point", coordinates: [80.9073, 26.8622] },
    isActive: true,
    source: "manual",
    verificationStatus: "development",
    osmId: null,
    osmType: null,
  },
  {
    name: "Masjid Taqveeyat-ul-Iman",
    address: "Nazirabad Road, Aminabad",
    city: "Lucknow",
    state: "Uttar Pradesh",
    country: "India",
    pincode: "226018",
    timezone: "Asia/Kolkata",
    location: { type: "Point", coordinates: [80.9285, 26.8447] },
    isActive: true,
    source: "manual",
    verificationStatus: "development",
    osmId: null,
    osmType: null,
  },
  {
    name: "Shahi Masjid Hazratganj",
    address: "Mahatma Gandhi Marg, Hazratganj",
    city: "Lucknow",
    state: "Uttar Pradesh",
    country: "India",
    pincode: "226001",
    timezone: "Asia/Kolkata",
    location: { type: "Point", coordinates: [80.9461, 26.8529] },
    isActive: true,
    source: "manual",
    verificationStatus: "development",
    osmId: null,
    osmType: null,
  },
  {
    name: "Masjid-e-Kashmiri Mohalla",
    address: "Kashmiri Mohalla, Chowk",
    city: "Lucknow",
    state: "Uttar Pradesh",
    country: "India",
    pincode: "226003",
    timezone: "Asia/Kolkata",
    location: { type: "Point", coordinates: [80.9088, 26.8552] },
    isActive: true,
    source: "manual",
    verificationStatus: "development",
    osmId: null,
    osmType: null,
  },
  {
    name: "Masjid Al-Huda",
    address: "Vikas Khand 1, Gomti Nagar",
    city: "Lucknow",
    state: "Uttar Pradesh",
    country: "India",
    pincode: "226010",
    timezone: "Asia/Kolkata",
    location: { type: "Point", coordinates: [80.9852, 26.8522] },
    isActive: true,
    source: "manual",
    verificationStatus: "development",
    osmId: null,
    osmType: null,
  },
  {
    name: "Masjid Talkatora Karbala",
    address: "Talkatora Road, Rajajipuram",
    city: "Lucknow",
    state: "Uttar Pradesh",
    country: "India",
    pincode: "226017",
    timezone: "Asia/Kolkata",
    location: { type: "Point", coordinates: [80.9032, 26.8391] },
    isActive: true,
    source: "manual",
    verificationStatus: "development",
    osmId: null,
    osmType: null,
  },
];

/**
 * Idempotent Seed Function
 * Upserts sample mosques based on (name + city) so running multiple times
 * never creates duplicates.
 */
const seedMosques = async () => {
  try {
    console.log("[Seed] Connecting to MongoDB...");
    await connectDB();

    console.log("[Seed] Ensuring 2dsphere index is built on Mosque collection...");
    await Mosque.init();

    console.log(`[Seed] Upserting ${sampleMosques.length} sample mosques...`);

    const operations = sampleMosques.map((mosque) => ({
      updateOne: {
        filter: { name: mosque.name, city: mosque.city },
        update: { $set: mosque },
        upsert: true,
      },
    }));

    const result = await Mosque.bulkWrite(operations);

    console.log(
      `[Seed] Seeding completed: ${result.upsertedCount} inserted, ${result.modifiedCount} updated, ${result.matchedCount} matched.`
    );

    const totalCount = await Mosque.countDocuments();
    console.log(`[Seed] Total mosques currently in database: ${totalCount}`);

    await mongoose.connection.close();
    console.log("[Seed] Database connection closed.");
    process.exit(0);
  } catch (error) {
    console.error(`[Seed] Seeding failed: ${error.message}`);
    process.exit(1);
  }
};

seedMosques();

