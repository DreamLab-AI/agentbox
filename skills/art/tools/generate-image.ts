#!/usr/bin/env bun

/**
 * generate-image - Image Generation CLI
 *
 * Generate images using Nano Banana 2 or Nano Banana Pro (Google Gemini).
 * Supports Google Gemini API (direct) and OpenRouter as providers.
 * Follows llcli pattern for deterministic, composable CLI design.
 *
 * Usage:
 *   generate-image --prompt "..." --size 2K --aspect-ratio 16:9 --output /tmp/image.png
 */

import { GoogleGenAI } from "@google/genai";
import { writeFile, readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

// ============================================================================
// Environment Loading
// ============================================================================

/**
 * Load environment variables from ~/.claude/.env
 * This ensures API keys are available regardless of how the CLI is invoked
 */
async function loadEnv(): Promise<void> {
  const envPath = resolve(process.env.HOME!, '.claude/.env');
  try {
    const envContent = await readFile(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Only set if not already defined (allow overrides from shell)
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    // Silently continue if .env doesn't exist - rely on shell env vars
  }
}

// ============================================================================
// Types
// ============================================================================

type Model = "nano-banana-pro" | "nano-banana-2";
type Provider = "google" | "openrouter";
type AspectRatio = "1:1" | "1:4" | "1:8" | "2:3" | "3:2" | "3:4" | "4:1" | "4:3" | "4:5" | "5:4" | "8:1" | "9:16" | "16:9" | "21:9";
type GeminiSize = "512px" | "1K" | "2K" | "4K";
type ThinkingLevel = "minimal" | "low" | "medium" | "high";

interface CLIArgs {
  model: Model;
  provider?: Provider;
  prompt: string;
  size: GeminiSize;
  output: string;
  creativeVariations?: number;
  aspectRatio: AspectRatio;
  transparent?: boolean;
  referenceImage?: string;
  removeBg?: boolean;
  thinking?: ThinkingLevel;
  grounded?: boolean;
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULTS = {
  model: "nano-banana-2" as Model,
  size: "2K" as GeminiSize,
  aspectRatio: "16:9" as AspectRatio,
  output: "/tmp/generated-image.png",
};

const GEMINI_SIZES: GeminiSize[] = ["512px", "1K", "2K", "4K"];
const GEMINI_ASPECT_RATIOS: AspectRatio[] = ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"];

const OPENROUTER_MODELS: Record<Model, string> = {
  "nano-banana-2": "google/gemini-3.1-flash-image-preview",
  "nano-banana-pro": "google/gemini-3-pro-image-preview",
};

const OPENROUTER_SIZE_MAP: Record<GeminiSize, string> = {
  "512px": "0.5K",
  "1K": "1K",
  "2K": "2K",
  "4K": "4K",
};

// ============================================================================
// Error Handling
// ============================================================================

class CLIError extends Error {
  constructor(message: string, public exitCode: number = 1) {
    super(message);
    this.name = "CLIError";
  }
}

function handleError(error: unknown): never {
  if (error instanceof CLIError) {
    console.error(`Error: ${error.message}`);
    process.exit(error.exitCode);
  }

  if (error instanceof Error) {
    console.error(`Unexpected error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }

  console.error(`Unknown error:`, error);
  process.exit(1);
}

// ============================================================================
// Help Text
// ============================================================================

function showHelp(): void {
  console.log(`
generate-image - Image Generation CLI

Generate images using Nano Banana 2 (default) or Nano Banana Pro.
Supports Google Gemini API (direct) and OpenRouter as providers.

USAGE:
  generate-image --prompt "<prompt>" [OPTIONS]

REQUIRED:
  --prompt <text>      Image generation prompt (quote if contains spaces)

OPTIONS:
  --model <model>          Model: nano-banana-2 (default), nano-banana-pro
  --provider <provider>    API provider: google, openrouter
                           Auto-detected from available API keys if not specified
  --size <size>            Resolution: 512px, 1K, 2K (default), 4K
                           512px is Nano Banana 2 only
  --aspect-ratio <ratio>   Aspect ratio (default: 16:9)
                           Standard: 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
                           Extended (NB2): 1:4, 4:1, 1:8, 8:1
  --output <path>          Output file path (default: /tmp/generated-image.png)
  --reference-image <path> Reference image for style/composition guidance
                           Accepts: PNG, JPEG, WebP images
  --transparent            Add transparency instructions to prompt
  --remove-bg              Remove background after generation (requires REMOVEBG_API_KEY)
  --thinking <level>       Thinking level for NB2: minimal (default), high (Google only)
                           Use high for complex compositions with precise positioning
  --grounded               Enable web search grounding (NB2 only, Google only)
                           Real-time web/image search for accurate logos, landmarks, brands
  --creative-variations <n>  Generate N variations (appends -v1, -v2, etc.)
  --help, -h               Show this help message

EXAMPLES:
  # Generate blog header (default: NB2, 2K, 16:9)
  generate-image --prompt "Abstract illustration of connected systems" --output /tmp/header.png

  # Quick preview at 512px
  generate-image --prompt "Isometric diorama of a home office" --size 512px --output /tmp/preview.png

  # Complex composition with extended thinking
  generate-image --prompt "Architecture diagram with 5 services..." --thinking high --output /tmp/arch.png

  # Web search grounded (accurate real-world subjects)
  generate-image --prompt "The Sagrada Familia at golden hour" --grounded --size 2K --output /tmp/sagrada.png

  # High-res with Nano Banana Pro
  generate-image --model nano-banana-pro --prompt "Editorial cover..." --size 4K --aspect-ratio 3:2

  # Style transfer with reference image
  generate-image --prompt "Apply this style to a lighthouse at sunset" \\
    --reference-image /tmp/style-ref.png --size 2K --output /tmp/styled.png

  # Generate 3 creative variations
  generate-image --prompt "Abstract neural network" --creative-variations 3 --output /tmp/art.png
  # Outputs: /tmp/art-v1.png, /tmp/art-v2.png, /tmp/art-v3.png

  # Use OpenRouter provider explicitly
  generate-image --provider openrouter --prompt "A cozy cafe scene" --size 2K --output /tmp/cafe.png

ENVIRONMENT VARIABLES:
  GOOGLE_API_KEY       Required for Google provider
  OPENROUTER_KEY       Required for OpenRouter provider
  REMOVEBG_API_KEY     Required for --remove-bg flag

PROVIDER AUTO-DETECTION:
  If --provider is not specified, the CLI checks for available API keys:
  1. GOOGLE_API_KEY found → uses Google provider
  2. OPENROUTER_KEY found → uses OpenRouter provider

ERROR CODES:
  0  Success
  1  General error (invalid arguments, API error, file write error)

MORE INFO:
  Documentation: ~/.claude/skills/art/SKILL.md
  Aesthetic: ~/.claude/skills/art/aesthetic.md
`);
  process.exit(0);
}

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(argv: string[]): CLIArgs {
  const args = argv.slice(2);

  // Check for help flag
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    showHelp();
  }

  const parsed: Partial<CLIArgs> = {
    model: DEFAULTS.model,
    size: DEFAULTS.size,
    aspectRatio: DEFAULTS.aspectRatio,
    output: DEFAULTS.output,
  };

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];

    if (!flag.startsWith("--")) {
      throw new CLIError(`Invalid flag: ${flag}. Flags must start with --`);
    }

    const key = flag.slice(2);

    // Handle boolean flags (no value)
    if (key === "transparent") {
      parsed.transparent = true;
      continue;
    }
    if (key === "remove-bg") {
      parsed.removeBg = true;
      continue;
    }
    if (key === "grounded") {
      parsed.grounded = true;
      continue;
    }

    // Handle flags with values
    const value = args[i + 1];
    if (!value || value.startsWith("--")) {
      throw new CLIError(`Missing value for flag: ${flag}`);
    }

    switch (key) {
      case "model":
        if (value !== "nano-banana-pro" && value !== "nano-banana-2") {
          throw new CLIError(`Invalid model: ${value}. Must be: nano-banana-2 or nano-banana-pro`);
        }
        parsed.model = value;
        i++;
        break;
      case "provider":
        if (value !== "google" && value !== "openrouter") {
          throw new CLIError(`Invalid provider: ${value}. Must be: google or openrouter`);
        }
        parsed.provider = value as Provider;
        i++;
        break;
      case "prompt":
        parsed.prompt = value;
        i++;
        break;
      case "size":
        if (!GEMINI_SIZES.includes(value as GeminiSize)) {
          throw new CLIError(`Invalid size: ${value}. Must be: ${GEMINI_SIZES.join(", ")}`);
        }
        parsed.size = value as GeminiSize;
        i++;
        break;
      case "aspect-ratio":
        if (!GEMINI_ASPECT_RATIOS.includes(value as AspectRatio)) {
          throw new CLIError(`Invalid aspect-ratio: ${value}. Must be: ${GEMINI_ASPECT_RATIOS.join(", ")}`);
        }
        parsed.aspectRatio = value as AspectRatio;
        i++;
        break;
      case "output":
        parsed.output = value;
        i++;
        break;
      case "reference-image":
        parsed.referenceImage = value;
        i++;
        break;
      case "thinking":
        if (value !== "minimal" && value !== "low" && value !== "medium" && value !== "high") {
          throw new CLIError(`Invalid thinking level: ${value}. Must be: minimal, low, medium, high`);
        }
        parsed.thinking = value as ThinkingLevel;
        i++;
        break;
      case "creative-variations":
        const variations = parseInt(value, 10);
        if (isNaN(variations) || variations < 1 || variations > 10) {
          throw new CLIError(`Invalid creative-variations: ${value}. Must be 1-10`);
        }
        parsed.creativeVariations = variations;
        i++;
        break;
      default:
        throw new CLIError(`Unknown flag: ${flag}`);
    }
  }

  // Validate required arguments
  if (!parsed.prompt) {
    throw new CLIError("Missing required argument: --prompt");
  }

  // Validate thinking is only used with nano-banana-2
  if (parsed.thinking && parsed.model !== "nano-banana-2") {
    throw new CLIError("--thinking is only supported with --model nano-banana-2");
  }

  // Validate grounded is only used with nano-banana-2
  if (parsed.grounded && parsed.model !== "nano-banana-2") {
    throw new CLIError("--grounded is only supported with --model nano-banana-2");
  }

  // Validate 512px is only used with nano-banana-2
  if (parsed.size === "512px" && parsed.model !== "nano-banana-2") {
    throw new CLIError("512px size is only supported with --model nano-banana-2");
  }

  return parsed as CLIArgs;
}

// ============================================================================
// Prompt Enhancement
// ============================================================================

function enhancePromptForTransparency(prompt: string): string {
  const transparencyPrefix = "CRITICAL: Transparent background (PNG with alpha channel) - NO background color, pure transparency. Object floating in transparent space. ";
  return transparencyPrefix + prompt;
}

// ============================================================================
// Background Removal
// ============================================================================

async function removeBackground(imagePath: string): Promise<void> {
  const apiKey = process.env.REMOVEBG_API_KEY;
  if (!apiKey) {
    throw new CLIError("Missing environment variable: REMOVEBG_API_KEY");
  }

  console.log("Removing background with remove.bg API...");

  const imageBuffer = await readFile(imagePath);
  const formData = new FormData();
  formData.append("image_file", new Blob([imageBuffer]), "image.png");
  formData.append("size", "auto");

  const response = await fetch("https://api.remove.bg/v1.0/removebg", {
    method: "POST",
    headers: {
      "X-Api-Key": apiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new CLIError(`remove.bg API error: ${response.status} - ${errorText}`);
  }

  const resultBuffer = Buffer.from(await response.arrayBuffer());
  await writeFile(imagePath, resultBuffer);
  console.log("Background removed successfully");
}

// ============================================================================
// Reference Image Helper
// ============================================================================

async function loadReferenceImage(imagePath: string): Promise<{ mimeType: string; data: string }> {
  const imageBuffer = await readFile(imagePath);
  const imageBase64 = imageBuffer.toString("base64");

  const ext = extname(imagePath).toLowerCase();
  let mimeType: string;
  switch (ext) {
    case ".png":
      mimeType = "image/png";
      break;
    case ".jpg":
    case ".jpeg":
      mimeType = "image/jpeg";
      break;
    case ".webp":
      mimeType = "image/webp";
      break;
    default:
      throw new CLIError(`Unsupported image format: ${ext}. Supported: .png, .jpg, .jpeg, .webp`);
  }

  return { mimeType, data: imageBase64 };
}

// ============================================================================
// Image Generation
// ============================================================================

async function generateWithNanoBananaPro(
  prompt: string,
  size: GeminiSize,
  aspectRatio: AspectRatio,
  output: string,
  referenceImage?: string
): Promise<void> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new CLIError("Missing environment variable: GOOGLE_API_KEY");
  }

  const ai = new GoogleGenAI({ apiKey });

  if (referenceImage) {
    console.log(`Generating with Nano Banana Pro (Gemini 3 Pro) at ${size} ${aspectRatio} with reference image...`);
  } else {
    console.log(`Generating with Nano Banana Pro (Gemini 3 Pro) at ${size} ${aspectRatio}...`);
  }

  // Prepare content parts
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

  if (referenceImage) {
    const ref = await loadReferenceImage(referenceImage);
    parts.push({ inlineData: ref });
  }

  parts.push({ text: prompt });

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-image-preview",
    contents: [{ parts }],
    config: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio: aspectRatio,
        imageSize: size,
      },
    },
  });

  const imageData = extractImageData(response);
  const imageBuffer = Buffer.from(imageData, "base64");
  await writeFile(output, imageBuffer);
  console.log(`Image saved to ${output}`);
}

async function generateWithNanoBanana2(
  prompt: string,
  size: GeminiSize,
  aspectRatio: AspectRatio,
  output: string,
  referenceImage?: string,
  thinking?: ThinkingLevel,
  grounded?: boolean
): Promise<void> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new CLIError("Missing environment variable: GOOGLE_API_KEY");
  }

  const ai = new GoogleGenAI({ apiKey });

  const thinkingLabel = thinking ? `, thinking=${thinking}` : "";
  const groundedLabel = grounded ? ", grounded" : "";
  if (referenceImage) {
    console.log(`Generating with Nano Banana 2 (Gemini 3.1 Flash Image) at ${size} ${aspectRatio}${thinkingLabel}${groundedLabel} with reference image...`);
  } else {
    console.log(`Generating with Nano Banana 2 (Gemini 3.1 Flash Image) at ${size} ${aspectRatio}${thinkingLabel}${groundedLabel}...`);
  }

  // Prepare content parts
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

  if (referenceImage) {
    const ref = await loadReferenceImage(referenceImage);
    parts.push({ inlineData: ref });
  }

  parts.push({ text: prompt });

  // Build config
  const config: Record<string, any> = {
    responseModalities: ["TEXT", "IMAGE"],
    imageConfig: {
      aspectRatio: aspectRatio,
      imageSize: size,
    },
  };

  if (thinking) {
    config.thinkingConfig = {
      thinkingLevel: thinking,
    };
  }

  if (grounded) {
    config.tools = [{ googleSearch: {} }];
  }

  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-image-preview",
    contents: [{ parts }],
    config,
  });

  // Extract text and image
  let imageData: string | undefined;
  let textResponse: string | undefined;

  if (response.candidates && response.candidates.length > 0) {
    const candidate = response.candidates[0];
    if (!candidate.content || !candidate.content.parts) {
      console.error("Gemini returned candidate without content.");
      console.error("Finish reason:", candidate.finishReason);
      if ((response as any).promptFeedback) {
        console.error("Prompt feedback:", JSON.stringify((response as any).promptFeedback));
      }
      throw new CLIError("Gemini blocked or returned empty response. Try simplifying the prompt.");
    }
    for (const part of candidate.content.parts) {
      if (part.inlineData && part.inlineData.data) {
        imageData = part.inlineData.data;
      } else if (part.text) {
        textResponse = part.text;
      }
    }

    // Log grounding metadata if present
    if (grounded && candidate.groundingMetadata) {
      const gm = candidate.groundingMetadata as any;
      if (gm.groundingChunks && gm.groundingChunks.length > 0) {
        console.log("\nGrounding sources:");
        for (const chunk of gm.groundingChunks) {
          if (chunk.web) {
            console.log(`  - ${chunk.web.title || "Source"}: ${chunk.web.uri}`);
          }
        }
      }
      if (gm.webSearchQueries && gm.webSearchQueries.length > 0) {
        console.log(`Search queries used: ${gm.webSearchQueries.join(", ")}`);
      }
    }
  }

  if (textResponse) {
    console.log(`\nModel response: ${textResponse}`);
  }

  if (!imageData) {
    throw new CLIError("No image data returned from Gemini API");
  }

  const imageBuffer = Buffer.from(imageData, "base64");
  await writeFile(output, imageBuffer);
  console.log(`Image saved to ${output}`);
}

// ============================================================================
// OpenRouter Image Generation
// ============================================================================

async function generateWithOpenRouter(
  model: Model,
  prompt: string,
  size: GeminiSize,
  aspectRatio: AspectRatio,
  output: string,
  referenceImage?: string
): Promise<void> {
  const apiKey = process.env.OPENROUTER_KEY;
  if (!apiKey) {
    throw new CLIError("Missing environment variable: OPENROUTER_KEY");
  }

  const openrouterModel = OPENROUTER_MODELS[model];
  const modelLabel = model === "nano-banana-pro" ? "Nano Banana Pro" : "Nano Banana 2";
  const refLabel = referenceImage ? " with reference image" : "";
  console.log(`Generating with ${modelLabel} via OpenRouter (${openrouterModel}) at ${size} ${aspectRatio}${refLabel}...`);

  // Build message content
  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

  if (referenceImage) {
    const ref = await loadReferenceImage(referenceImage);
    content.push({
      type: "image_url",
      image_url: { url: `data:${ref.mimeType};base64,${ref.data}` },
    });
  }

  content.push({ type: "text", text: prompt });

  const body = {
    model: openrouterModel,
    messages: [{ role: "user", content }],
    modalities: ["image", "text"],
    stream: false,
    image_config: {
      aspect_ratio: aspectRatio,
      image_size: OPENROUTER_SIZE_MAP[size],
    },
  };

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new CLIError(`OpenRouter API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as any;

  const message = data.choices?.[0]?.message;
  if (!message) {
    throw new CLIError("OpenRouter returned empty response");
  }

  // Log text response if present
  if (message.content && typeof message.content === "string" && message.content.trim()) {
    console.log(`\nModel response: ${message.content}`);
  }

  // Extract image from the images array (OpenRouter extension)
  let imageBase64: string | undefined;

  if (message.images && Array.isArray(message.images) && message.images.length > 0) {
    const imageUrl = message.images[0]?.image_url?.url;
    if (imageUrl && imageUrl.startsWith("data:image/")) {
      const commaIdx = imageUrl.indexOf(",");
      if (commaIdx !== -1) {
        imageBase64 = imageUrl.slice(commaIdx + 1);
      }
    }
  }

  // Fallback: check if content is an array with image parts
  if (!imageBase64 && Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === "image_url" && part.image_url?.url?.startsWith("data:image/")) {
        const commaIdx = part.image_url.url.indexOf(",");
        if (commaIdx !== -1) {
          imageBase64 = part.image_url.url.slice(commaIdx + 1);
          break;
        }
      }
    }
  }

  if (!imageBase64) {
    throw new CLIError("No image data returned from OpenRouter API");
  }

  const imageBuffer = Buffer.from(imageBase64, "base64");
  await writeFile(output, imageBuffer);
  console.log(`Image saved to ${output}`);
}

// ============================================================================
// Response Extraction Helper
// ============================================================================

function extractImageData(response: any): string {
  if (response.candidates && response.candidates.length > 0) {
    const candidate = response.candidates[0];
    if (!candidate.content || !candidate.content.parts) {
      console.error("Gemini returned candidate without content.");
      console.error("Finish reason:", candidate.finishReason);
      if (response.promptFeedback) {
        console.error("Prompt feedback:", JSON.stringify(response.promptFeedback));
      }
      throw new CLIError("Gemini blocked or returned empty response. Try simplifying the prompt.");
    }
    for (const part of candidate.content.parts) {
      if (part.inlineData && part.inlineData.data) {
        return part.inlineData.data;
      }
    }
  }
  throw new CLIError("No image data returned from Gemini API");
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  try {
    // Load API keys from ~/.claude/.env
    await loadEnv();

    const args = parseArgs(process.argv);

    // Determine provider (explicit flag > auto-detect from API keys)
    let provider: Provider;
    if (args.provider) {
      provider = args.provider;
    } else if (process.env.GOOGLE_API_KEY) {
      provider = "google";
    } else if (process.env.OPENROUTER_KEY) {
      provider = "openrouter";
    } else {
      throw new CLIError("No API key found. Set GOOGLE_API_KEY or OPENROUTER_KEY in ~/.claude/.env");
    }

    // Warn about provider-specific features when using OpenRouter
    if (provider === "openrouter") {
      if (args.thinking) {
        console.warn("Warning: --thinking is not supported with OpenRouter provider, ignoring");
      }
      if (args.grounded) {
        console.warn("Warning: --grounded is not supported with OpenRouter provider, ignoring");
      }
    }

    // Enhance prompt for transparency if requested
    const finalPrompt = args.transparent
      ? enhancePromptForTransparency(args.prompt)
      : args.prompt;

    if (args.transparent) {
      console.log("Transparent background mode enabled");
      console.log("Note: Not all models support transparency natively; may require post-processing\n");
    }

    // Generate function dispatcher
    const generate = (prompt: string, output: string): Promise<void> => {
      if (provider === "openrouter") {
        return generateWithOpenRouter(args.model, prompt, args.size, args.aspectRatio, output, args.referenceImage);
      }
      if (args.model === "nano-banana-pro") {
        return generateWithNanoBananaPro(prompt, args.size, args.aspectRatio, output, args.referenceImage);
      }
      return generateWithNanoBanana2(prompt, args.size, args.aspectRatio, output, args.referenceImage, args.thinking, args.grounded);
    };

    // Handle creative variations mode
    if (args.creativeVariations && args.creativeVariations > 1) {
      console.log(`Creative Mode: Generating ${args.creativeVariations} variations...`);
      console.log(`Note: CLI mode uses same prompt for all variations (tests model variability)\n`);

      const basePath = args.output.replace(/\.png$/, "");
      const promises: Promise<void>[] = [];

      for (let i = 1; i <= args.creativeVariations; i++) {
        const varOutput = `${basePath}-v${i}.png`;
        console.log(`Variation ${i}/${args.creativeVariations}: ${varOutput}`);
        promises.push(generate(finalPrompt, varOutput));
      }

      await Promise.all(promises);
      console.log(`\nGenerated ${args.creativeVariations} variations`);
      return;
    }

    // Standard single image generation
    await generate(finalPrompt, args.output);

    // Remove background if requested
    if (args.removeBg) {
      await removeBackground(args.output);
    }
  } catch (error) {
    handleError(error);
  }
}

main();
