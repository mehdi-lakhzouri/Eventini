import { z } from "zod";

export const invitationAcceptanceSchema = z.object({
  invitationToken: z.string().min(1),
  password: z.string().min(12),
});
