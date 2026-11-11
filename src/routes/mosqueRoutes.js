import { Router } from "express";
import { getNearbyMosques } from "../controllers/mosqueController.js";

const router = Router();

// GET /api/mosques/nearby - Find mosques near specified coordinates
router.get("/nearby", getNearbyMosques);

export default router;

