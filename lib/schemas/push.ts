import { z } from "zod";
import { EMAIL_GROUPS, type EmailGroupId } from "./email";

// Browser notifications use the same topics as email; the database (ops.email_group) decides which one a notification is in.
export const PUSH_GROUPS = EMAIL_GROUPS;
export type PushGroupId = EmailGroupId;

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().startsWith("https://").max(2000),
  p256dh: z.string().min(1).max(200),
  auth: z.string().min(1).max(100),
  userAgent: z.string().max(300).optional(),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const pushEndpointSchema = z.object({ endpoint: z.string().url().max(2000) });

export const pushGroupsSchema = z.object({
  groups: z.array(z.enum(EMAIL_GROUPS.map((g) => g.id) as [EmailGroupId, ...EmailGroupId[]])).max(EMAIL_GROUPS.length),
});
