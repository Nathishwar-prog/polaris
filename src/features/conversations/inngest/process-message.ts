import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

// Create a custom OpenAI instance pointing to the local Ollama provider
const ollama = createOpenAI({
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama', // Required by the SDK but ignored by Ollama
});

import { inngest } from "@/inngest/client";
import { Id } from "../../../../convex/_generated/dataModel";
import { NonRetriableError } from "inngest";
import { convex } from "@/lib/convex-client";
import { api } from "../../../../convex/_generated/api";
import {
  CODING_AGENT_SYSTEM_PROMPT,
  TITLE_GENERATOR_SYSTEM_PROMPT
} from "./constants";
import { DEFAULT_CONVERSATION_TITLE } from "../constants";

interface MessageEvent {
  messageId: Id<"messages">;
  conversationId: Id<"conversations">;
  projectId: Id<"projects">;
  message: string;
};

export const processMessage = inngest.createFunction(
  {
    id: "process-message",
    cancelOn: [
      {
        event: "message/cancel",
        if: "event.data.messageId == async.data.messageId",
      },
    ],
    onFailure: async ({ event, step }) => {
      const { messageId } = event.data.event.data as MessageEvent;
      const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;

      // Update the message with error content
      if (internalKey) {
        await step.run("update-message-on-failure", async () => {
          await convex.mutation(api.system.updateMessageContent, {
            internalKey,
            messageId,
            content:
              "My apologies, I encountered an error while processing your request. Let me know if you need anything else!",
          });
        });
      }
    }
  },
  {
    event: "message/sent",
  },
  async ({ event, step }) => {
    const {
      messageId,
      conversationId,
      projectId,
      message
    } = event.data as MessageEvent;

    const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;

    if (!internalKey) {
      throw new NonRetriableError("POLARIS_CONVEX_INTERNAL_KEY is not configured");
    }

    // TODO: Check if this is needed
    await step.sleep("wait-for-db-sync", "1s");

    // Get conversation for title generation check
    const conversation = await step.run("get-conversation", async () => {
      return await convex.query(api.system.getConversationById, {
        internalKey,
        conversationId,
      });
    });

    if (!conversation) {
      throw new NonRetriableError("Conversation not found");
    }

    // Fetch recent messages for conversation context
    const recentMessages = await step.run("get-recent-messages", async () => {
      return await convex.query(api.system.getRecentMessages, {
        internalKey,
        conversationId,
        limit: 10,
      });
    });

    // Build system prompt with conversation history (exclude the current processing message)
    let systemPrompt = CODING_AGENT_SYSTEM_PROMPT;

    // Filter out the current processing message and empty messages
    const contextMessages = recentMessages.filter(
      (msg) => msg._id !== messageId && msg.content.trim() !== ""
    );

    if (contextMessages.length > 0) {
      const historyText = contextMessages
        .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
        .join("\n\n");

      systemPrompt += `\n\n## Previous Conversation (for context only - do NOT repeat these responses):\n${historyText}\n\n## Current Request:\nRespond ONLY to the user's new message below. Do not repeat or reference your previous responses.`;
    }

    // Generate conversation title if it's still the default
    const shouldGenerateTitle =
      conversation.title === DEFAULT_CONVERSATION_TITLE;

    if (shouldGenerateTitle) {
      await step.run("generate-title", async () => {
        const { text: title } = await generateText({
          model: ollama('deepseek-coder:6.7b'),
          system: TITLE_GENERATOR_SYSTEM_PROMPT,
          prompt: message,
        });

        if (title && title.trim().length > 0) {
          await convex.mutation(api.system.updateConversationTitle, {
            internalKey,
            conversationId,
            title: title.trim(),
          });
        }
      });
    }

    // Run the main coding agent
    const assistantResponse = await step.run("generate-response", async () => {
      const { text } = await generateText({
        model: ollama('deepseek-coder:6.7b'),
        system: systemPrompt,
        prompt: message,
        tools: undefined, // Explicitly disable tools for deepseek-coder
      });
      return text;
    });

    // Parse and execute actions from the text response
    await step.run("execute-text-actions", async () => {
      const createFileRegex = /<create_file\s+path="([^"]+)">([\s\S]*?)<\/create_file>/g;
      const updateFileRegex = /<update_file\s+id="([^"]+)">([\s\S]*?)<\/update_file>/g;

      const createMatches = [...assistantResponse.matchAll(createFileRegex)];
      const updateMatches = [...assistantResponse.matchAll(updateFileRegex)];

      // Helper to resolve folder path to ID, creating if needed
      const resolvePath = async (path: string): Promise<Id<"files"> | undefined> => {
        const parts = path.split("/");
        const fileName = parts.pop(); // Remove file name
        if (parts.length === 0) return undefined; // Root

        let currentParentId: Id<"files"> | undefined = undefined;

        for (const part of parts) {
          // Check if folder exists in current parent
          const existing = await convex.query(api.system.getFolderByName, {
            internalKey,
            projectId,
            parentId: currentParentId,
            name: part
          });

          if (existing) {
            currentParentId = existing._id;
          } else {
            // Create folder
            currentParentId = await convex.mutation(api.system.createFolder, {
              internalKey,
              projectId,
              parentId: currentParentId,
              name: part
            });
          }
        }
        return currentParentId;
      };

      // Execute Creates
      for (const match of createMatches) {
        const path = match[1];
        const content = match[2];

        try {
          const parentId = await resolvePath(path);
          const name = path.split("/").pop()!;

          await convex.mutation(api.system.createFile, {
            internalKey,
            projectId,
            parentId,
            name,
            content
          });
        } catch (e) {
          console.error(`Failed to create file ${path}:`, e);
        }
      }

      // Execute Updates
      for (const match of updateMatches) {
        const fileId = match[1] as Id<"files">;
        const content = match[2];

        try {
          await convex.mutation(api.system.updateFile, {
            internalKey,
            fileId,
            content
          });
        } catch (e) {
          console.error(`Failed to update file ${fileId}:`, e);
        }
      }
    });

    // Update the assistant message with the response (this also sets status to completed)
    await step.run("update-assistant-message", async () => {
      await convex.mutation(api.system.updateMessageContent, {
        internalKey,
        messageId,
        content: assistantResponse || "I processed your request.",
      })
    });

    return { success: true, messageId, conversationId };
  }
);

