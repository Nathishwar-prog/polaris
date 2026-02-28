import { z } from "zod";
import { tool } from "ai";

import { convex } from "@/lib/convex-client";

import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

interface CreateFolderToolOptions {
  projectId: Id<"projects">;
  internalKey: string;
}

const paramsSchema = z.object({
  name: z.string().min(1, "Folder name is required"),
  parentId: z.string(),
});

export const createCreateFolderTool = ({
  projectId,
  internalKey,
}: CreateFolderToolOptions) => {
  return tool({
    description: "Create a new folder in the project",
    parameters: z.object({
      name: z.string().describe("The name of the folder to create"),
      parentId: z
        .string()
        .describe(
          "The ID (not name!) of the parent folder from listFiles, or empty string for root level"
        ),
    }),
    execute: async (params: { name: string; parentId: string }) => {
      const parsed = paramsSchema.safeParse(params);
      if (!parsed.success) {
        return `Error: ${parsed.error.issues[0].message}`;
      }

      const { name, parentId } = parsed.data;

      try {
        // Validate parentId if provided
        if (parentId) {
          try {
            const parentFolder = await convex.query(api.system.getFileById, {
              internalKey,
              fileId: parentId as Id<"files">,
            });
            if (!parentFolder) {
              return `Error: Parent folder with ID "${parentId}" not found. Use listFiles to get valid folder IDs.`;
            }
            if (parentFolder.type !== "folder") {
              return `Error: The ID "${parentId}" is a file, not a folder. Use a folder ID as parentId.`;
            }
          } catch {
            return `Error: Invalid parentId "${parentId}". Use listFiles to get valid folder IDs, or use empty string for root level.`;
          }
        }

        const folderId = await convex.mutation(api.system.createFolder, {
          internalKey,
          projectId,
          name,
          parentId: parentId ? (parentId as Id<"files">) : undefined,
        });

        return `Folder created with ID: ${folderId}`;
      } catch (error) {
        return `Error creating folder: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    }
  });
};
