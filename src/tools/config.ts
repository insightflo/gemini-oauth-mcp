// @TASK - config MCP Tool Implementation
// @SPEC config_set, config_get, model for runtime configuration

import { z } from "zod";
import {
  getDefaultModel,
  setDefaultModel,
  AVAILABLE_MODELS,
  getConfigPath,
} from "../utils/config.js";

/**
 * MCP Tool response format
 */
export interface ToolResponse {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/**
 * config_get tool definition
 */
export const configGetTool = {
  name: "config_get",
  description: "Get current configuration settings (default model, config path)",
};

/**
 * config_set tool input schema
 */
export const configSetInputSchema = z.object({
  key: z.enum(["default_model"]).describe("Configuration key to set"),
  value: z.string().describe("Value to set"),
});

/**
 * config_set tool definition
 */
export const configSetTool = {
  name: "config_set",
  description:
    "Set configuration value. Available keys: default_model. Available models: " +
    AVAILABLE_MODELS.join(", "),
  inputSchema: configSetInputSchema,
};

/**
 * config_set input type
 */
export type ConfigSetInput = z.infer<typeof configSetInputSchema>;

/**
 * model tool input schema - uses enum for UI selection
 */
export const modelInputSchema = z.object({
  name: z
    .enum(AVAILABLE_MODELS as unknown as [string, ...string[]])
    .optional()
    .describe("Model to set as default. Leave empty to see current model."),
});

/**
 * model tool definition
 */
export const modelTool = {
  name: "model",
  description:
    "View or change the default Gemini model. Call without arguments to see current model, or select a model to set as default.",
  inputSchema: modelInputSchema,
};

/**
 * model tool input type
 */
export type ModelInput = z.infer<typeof modelInputSchema>;

/**
 * Handle config_get tool
 */
export function handleConfigGet(): ToolResponse {
  const defaultModel = getDefaultModel();
  const configPath = getConfigPath();

  const text = `Current Configuration
═══════════════════════════════════════════════════════════

  Setting         Value
  ──────────────  ──────────────────────────────────────────

  Default Model   ${defaultModel}
  Config Path     ${configPath}

═══════════════════════════════════════════════════════════

Available Models:
${AVAILABLE_MODELS.map((m, i) => `  ${i + 1}. ${m}${m === defaultModel ? " (current)" : ""}`).join("\n")}

To change default model:
  config_set key="default_model" value="gemini-3.0-pro"
`;

  return {
    content: [{ type: "text", text }],
  };
}

/**
 * Handle config_set tool
 */
export function handleConfigSet(args: ConfigSetInput): ToolResponse {
  const { key, value } = args;

  if (key === "default_model") {
    // Validate model name
    if (!AVAILABLE_MODELS.includes(value as (typeof AVAILABLE_MODELS)[number])) {
      return {
        content: [
          {
            type: "text",
            text: `[ERROR] Invalid model: ${value}

Available models:
${AVAILABLE_MODELS.map((m) => `  - ${m}`).join("\n")}`,
          },
        ],
        isError: true,
      };
    }

    // Save the setting
    setDefaultModel(value);

    return {
      content: [
        {
          type: "text",
          text: `✓ Default model set to: ${value}

This setting is saved and will persist across sessions.`,
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text",
        text: `[ERROR] Unknown configuration key: ${key}

Available keys:
  - default_model`,
      },
    ],
    isError: true,
  };
}

/**
 * Handle model tool - view or change default model
 */
export function handleModel(args: ModelInput): ToolResponse {
  const { name } = args;
  const currentModel = getDefaultModel();

  // If no model specified, show current model
  if (!name) {
    return {
      content: [
        {
          type: "text",
          text: `Current default model: ${currentModel}

Available models:
${AVAILABLE_MODELS.map((m) => `  ${m === currentModel ? "● " : "○ "}${m}`).join("\n")}

Quick switch:
  use_flash    → gemini-2.5-flash (default)
  use_pro      → gemini-2.5-pro
  use_flash_20 → gemini-2.0-flash
  use_flash_15 → gemini-1.5-flash
  use_pro_15   → gemini-1.5-pro`,
        },
      ],
    };
  }

  // Set new default model
  setDefaultModel(name);

  return {
    content: [
      {
        type: "text",
        text: `✓ Default model changed: ${currentModel} → ${name}`,
      },
    ],
  };
}

/**
 * Shortcut tools for quick model switching
 */
export const useFlashTool = {
  name: "use_flash",
  description: "Switch to Gemini 2.5 Flash (fast, cost-effective) - default",
};

export const useProTool = {
  name: "use_pro",
  description: "Switch to Gemini 2.5 Pro (best reasoning, long context)",
};

export const useFlash20Tool = {
  name: "use_flash_20",
  description: "Switch to Gemini 2.0 Flash",
};

export const useFlash15Tool = {
  name: "use_flash_15",
  description: "Switch to Gemini 1.5 Flash",
};

export const usePro15Tool = {
  name: "use_pro_15",
  description: "Switch to Gemini 1.5 Pro",
};

/**
 * Handle shortcut tool - switch to specific model
 */
export function handleUseModel(modelName: string): ToolResponse {
  const currentModel = getDefaultModel();

  if (currentModel === modelName) {
    return {
      content: [
        {
          type: "text",
          text: `Already using ${modelName}`,
        },
      ],
    };
  }

  setDefaultModel(modelName);

  return {
    content: [
      {
        type: "text",
        text: `✓ Switched to ${modelName}`,
      },
    ],
  };
}

/**
 * Legacy tool for backward compatibility with existing skills
 * Alias for generate_content
 */
export const geminiGenerateTextTool = {
  name: "gemini_generate_text",
  description: "Generate text with Gemini AI (legacy alias for generate_content)",
};

export const geminiGenerateTextInputSchema = z.object({
  prompt: z.string().min(1).describe("The prompt for text generation"),
  model: z.string().optional().describe("Model name (default: uses configured default)"),
});

export type GeminiGenerateTextInput = z.infer<typeof geminiGenerateTextInputSchema>;
