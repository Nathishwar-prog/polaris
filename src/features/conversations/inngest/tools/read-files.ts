import { z } from "zod";
import { tool } from "ai";

import { convex } from "@/lib/convex-client";

import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

interface ReadFilesToolOptions {
  internalKey: string;
}

const paramsSchema = z.object({
  fileIds: z
    .array(z.string().min(1, "File ID cannot be empty"))
    .min(1, "Provide at least one file ID"),
});

export const createReadFilesTool = ({ internalKey }: ReadFilesToolOptions) => {
  return tool({
    description: "Read the content of files from the project. Returns file contents.",
    parameters: z.object({
      fileIds: z.array(z.string()).describe("Array of file IDs to read"),
    }),
    execute: async (params: { fileIds: string[] }) => {
      const parsed = paramsSchema.safeParse(params);
      if (!parsed.success) {
        return `Error: ${parsed.error.issues[0].message}`;
      }

      const { fileIds } = parsed.data;

      try {
        const results: { id: string; name: string; content: string }[] = [];

        for (const fileId of fileIds) {
          const file = await convex.query(api.system.getFileById, {
            internalKey,
            fileId: fileId as Id<"files">,
          });

          if (file && file.content) {
            results.push({
              id: file._id,
              name: file.name,
              content: file.content,
            });
          };
        }

        if (results.length === 0) {
          return "Error: No files found with provided IDs. Use listFiles to get valid fileIDs.";
        }

        return JSON.stringify(results);
      } catch (error) {
        return `Error reading files: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    }
  });
};
