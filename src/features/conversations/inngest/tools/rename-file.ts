import { z } from "zod";
import { tool } from "ai";

import { convex } from "@/lib/convex-client";

import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

interface RenameFileToolOptions {
  internalKey: string;
}

const paramsSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  newName: z.string().min(1, "New name is required"),
});

export const createRenameFileTool = ({
  internalKey,
}: RenameFileToolOptions) => {
  return tool({
    description: "Rename a file or folder",
    parameters: z.object({
      fileId: z.string().describe("The ID of the file or folder to rename"),
      newName: z.string().describe("The new name for the file or folder"),
    }),
    execute: async (params: { fileId: string; newName: string }) => {
      const parsed = paramsSchema.safeParse(params);
      if (!parsed.success) {
        return `Error: ${parsed.error.issues[0].message}`;
      }

      const { fileId, newName } = parsed.data;

      // Validate file exists before running the step
      const file = await convex.query(api.system.getFileById, {
        internalKey,
        fileId: fileId as Id<"files">,
      });

      if (!file) {
        return `Error: File with ID "${fileId}" not found. Use listFiles to get valid file IDs.`;
      }

      try {
        await convex.mutation(api.system.renameFile, {
          internalKey,
          fileId: fileId as Id<"files">,
          newName,
        });

        return `Renamed "${file.name}" to "${newName}" successfully`;
      } catch (error) {
        return `Error renaming file: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    }
  });
};
