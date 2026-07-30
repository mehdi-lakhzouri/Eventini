import { z } from "zod";

export const mfaVerificationSchema = z.object({
  code: z.string().min(1),
});
