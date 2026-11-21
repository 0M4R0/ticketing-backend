import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validate.middleware";
import {
  getCurrentUserController,
  updateCurrentUserController,
} from "./users.controller";
import {
  getCurrentUserSessionsController,
  revokeAllCurrentUserSessionsController,
  revokeCurrentUserSessionController,
} from "./sessions/sessions.controller";
import { updateProfileSchema } from "./users.schema";

const router = Router();

router.use(requireAuth);
router.get("/me", getCurrentUserController);
router.patch(
  "/me",
  validate(z.object({ body: updateProfileSchema })),
  updateCurrentUserController,
);
router.get("/me/sessions", getCurrentUserSessionsController);
router.delete("/me/sessions", revokeAllCurrentUserSessionsController);
router.delete(
  "/me/sessions/:sessionId",
  validate(
    z.object({
      params: z.object({ sessionId: z.coerce.number().int().positive() }),
    }),
  ),
  revokeCurrentUserSessionController,
);

export default router;
