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

const router = Router();

router.post("/register", validate(z.object({ body: registerSchema })), registerController);
router.post("/login", validate(z.object({ body: loginSchema })), loginController);
router.post("/refresh", refreshController);
router.post("/logout", logoutController);

export default router;
