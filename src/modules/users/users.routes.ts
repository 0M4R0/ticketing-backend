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
import {
  usersIpLimit,
  banUserLimit,
  getCurrentUserLimit,
  getCurrentUserSessionsLimit,
  revokeAllCurrentUserSessionsLimit,
  revokeCurrentUserSessionLimit,
  unbanUserLimit,
  updateCurrentUserLimit,
} from "./user.rate-limit";

const router = Router();

// 1. IP protection for the whole router (catches bad/expired tokens too)
router.use(usersIpLimit);

// 2. Auth required for everything below
router.use(requireAuth);

// Admin actions
router.post(
  "/:userId/ban",
  requireRole("admin"),
  banUserLimit,
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
  unbanUserLimit,
  validate(z.object({ params: z.object({ userId: z.uuid() }) })),
  unbanUserController,
);

// /me
router.get("/me", getCurrentUserLimit, getCurrentUserController);

router.patch(
  "/me",
  updateCurrentUserLimit,
  validate(z.object({ body: updateProfileSchema })),
  updateCurrentUserController,
);

// /me/sessions
router.get(
  "/me/sessions",
  getCurrentUserSessionsLimit,
  getCurrentUserSessionsController,
);

router.delete(
  "/me/sessions",
  revokeAllCurrentUserSessionsLimit,
  revokeAllCurrentUserSessionsController,
);

router.delete(
  "/me/sessions/:sessionId",
  revokeCurrentUserSessionLimit,
  validate(
    z.object({
      params: z.object({ sessionId: z.uuid() }),
    }),
  ),
  revokeCurrentUserSessionController,
);

export default router;
