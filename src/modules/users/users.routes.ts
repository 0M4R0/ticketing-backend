import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/require-role.middleware";
import { validate } from "../../middleware/validate.middleware";
import {
  getCurrentUserController,
  banUserController,
  unbanUserController,
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
router.post(
  "/:userId/ban",
  requireRole("admin"),
  validate(
    z.object({
      params: z.object({ userId: z.uuid() }),
      body: z
        .object({ reason: z.string().trim().max(1000).optional() })
        .optional(),
    }),
  ),
  banUserController,
);
router.post(
  "/:userId/unban",
  requireRole("admin"),
  validate(z.object({ params: z.object({ userId: z.uuid() }) })),
  unbanUserController,
);
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
      params: z.object({ sessionId: z.uuid() }),
    }),
  ),
  revokeCurrentUserSessionController,
);

export default router;
