import { z } from "zod";
import { STAFF_DOC_KINDS } from "@/lib/schemas/documents";

/** HR sends a file to a person (ops.hr_send_document). The title limit matches the database (120). */
export const sendFileSchema = z.object({
  staff_id: z.uuid("Choose who this is for."),
  kind: z.enum(STAFF_DOC_KINDS, "Choose what kind of file it is."),
  title: z.string().trim().min(1, "Give the file a title.").max(120, "Keep the title under 120 characters."),
  note: z.string().trim().max(300, "Keep the note under 300 characters."),
});
export type SendFile = z.infer<typeof sendFileSchema>;
