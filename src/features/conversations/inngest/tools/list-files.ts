import { z } from "zod";
import { tool } from "ai";

import { convex } from "@/lib/convex-client";

import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

interface ListFilesToolOptions {
  projectId: Id<"projects">;
  internalKey: string;
}

export const createListFilesTool = ({
  projectId,
  internalKey,
}: ListFilesToolOptions) => {
  return tool({
    description:
      "List all files and folders in the project. Returns names, IDs, types, and parentId for each item. Items with parentId: null are at root level. Use the parentId to understand the folder structure - items with the same parentId are in the same folder.",
    parameters: z.object({}),
    execute: async (_args) => {
      try {
        const files = await convex.query(api.system.getProjectFiles, {
          internalKey,
          projectId,
        });

        // Sort: folders first, then files, alphabetically
        const sorted = files.sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === "folder" ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });

        const fileList = sorted.map((f) => ({
          id: f._id,
          name: f.name,
          type: f.type,
          parentId: f.parentId ?? null,
        }));

        return JSON.stringify(fileList);
      } catch (error) {
        return `Error listing files: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    }
  });
};
