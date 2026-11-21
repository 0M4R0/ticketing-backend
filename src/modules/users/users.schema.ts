import { z } from "zod";

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    phone: z.string().trim().max(30).nullable().optional(),
  })
  .refine((profile) => Object.keys(profile).length > 0, {
    message: "At least one profile field must be provided",
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
