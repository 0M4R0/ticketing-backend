import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validate.middleware";
import {
  getCurrentUserController,
  updateCurrentUserController,
} from "./users.controller";
import { updateProfileSchema } from "./users.schema";

const router = Router();

router.use(requireAuth);
router.get("/me", getCurrentUserController);
router.patch(
  "/me",
  validate(z.object({ body: updateProfileSchema })),
  updateCurrentUserController,
);

export default router;
