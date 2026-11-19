import { Router } from "express";
import { z } from "zod";
import { validate } from "../../middleware/validate.middleware";
import {
  loginController,
  logoutController,
  refreshController,
  registerController,
} from "./auth.controller";
import { loginSchema, registerSchema } from "./auth.schema";

import {
  registerLimiter,
  loginLimiter,
  refreshLimiter,
  logoutLimiter,
} from "./auth.rate-limit";

const router = Router();

router.post(
  "/register",
  validate(z.object({ body: registerSchema })),
  registerLimiter,
  registerController,
);
router.post(
  "/login",
  validate(z.object({ body: loginSchema })),
  loginLimiter,
  loginController,
);
router.post("/refresh", refreshLimiter, refreshController);
router.post("/logout", logoutLimiter, logoutController);

export default router;
