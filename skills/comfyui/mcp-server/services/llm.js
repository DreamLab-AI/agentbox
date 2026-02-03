/**
 * LLM Service for ComfyUI Workflow Generation
 * Supports Claude (Anthropic/Z.AI) and OpenAI
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

class LLMService {
  constructor() {
    this.provider = null;
    this.client = null;
    this.model = null;
    this.initialize();
  }

  /**
   * Initialize LLM client based on available credentials
   */
  initialize() {
    // Try Anthropic/Claude first (direct or Z.AI)
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL;

    if (anthropicKey || anthropicBaseUrl) {
      const config = { apiKey: anthropicKey || 'dummy-key' };

      // Z.AI service on port 9600
      if (anthropicBaseUrl) {
        config.baseURL = anthropicBaseUrl;
      }

      this.client = new Anthropic(config);
      this.provider = 'anthropic';
      this.model = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
      console.log(`[LLM] Initialized Anthropic provider (${anthropicBaseUrl ? 'Z.AI' : 'direct'}) with model: ${this.model}`);
      return;
    }

    // Fallback to OpenAI
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      this.client = new OpenAI({ apiKey: openaiKey });
      this.provider = 'openai';
      this.model = process.env.OPENAI_MODEL || 'gpt-4-turbo-preview';
      console.log(`[LLM] Initialized OpenAI provider with model: ${this.model}`);
      return;
    }

    console.warn('[LLM] No LLM provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY');
  }

  /**
   * Check if LLM service is available
   */
  isAvailable() {
    return this.client !== null;
  }

  /**
   * Build system prompt for workflow generation
   */
  buildSystemPrompt(context = {}) {
    const { models = [], nodes = [] } = context;

    const modelList = models.length > 0
      ? models.map(m => `  - ${m.name} (${m.type})`).join('\n')
      : '  - No models available';

    const nodeTypes = nodes.length > 0
      ? nodes.slice(0, 20).join(', ')
      : 'CheckpointLoaderSimple, KSampler, VAEDecode, SaveImage, CLIPTextEncode';

    return `You are a ComfyUI workflow generation expert. Generate valid ComfyUI workflow JSON structures.

AVAILABLE MODELS:
${modelList}

COMMON NODE TYPES:
${nodeTypes}

WORKFLOW STRUCTURE RULES:
1. Node IDs must be string numbers: "1", "2", "3", etc.
2. Connections use format: [node_id, output_index] where output_index is typically 0
3. Every workflow must include:
   - CheckpointLoaderSimple: Load the model
   - CLIPTextEncode: Encode positive and negative prompts
   - KSampler: Generate latent image
   - VAEDecode: Decode latent to image
   - SaveImage: Save final output

4. Standard workflow structure:
   {
     "1": {
       "class_type": "CheckpointLoaderSimple",
       "inputs": { "ckpt_name": "model.safetensors" }
     },
     "2": {
       "class_type": "CLIPTextEncode",
       "inputs": {
         "text": "positive prompt",
         "clip": ["1", 1]
       }
     },
     "3": {
       "class_type": "CLIPTextEncode",
       "inputs": {
         "text": "negative prompt",
         "clip": ["1", 1]
       }
     },
     "4": {
       "class_type": "KSampler",
       "inputs": {
         "seed": 123456,
         "steps": 20,
         "cfg": 7.0,
         "sampler_name": "euler",
         "scheduler": "normal",
         "denoise": 1.0,
         "model": ["1", 0],
         "positive": ["2", 0],
         "negative": ["3", 0],
         "latent_image": ["5", 0]
       }
     },
     "5": {
       "class_type": "EmptyLatentImage",
       "inputs": {
         "width": 512,
         "height": 512,
         "batch_size": 1
       }
     },
     "6": {
       "class_type": "VAEDecode",
       "inputs": {
         "samples": ["4", 0],
         "vae": ["1", 2]
       }
     },
     "7": {
       "class_type": "SaveImage",
       "inputs": {
         "filename_prefix": "ComfyUI",
         "images": ["6", 0]
       }
     }
   }

OUTPUT FORMAT:
Return ONLY valid JSON. No markdown, no explanations, just the workflow object.`;
  }

  /**
   * Generate ComfyUI workflow from natural language description
   */
  async generateWorkflow(description, context = {}) {
    if (!this.isAvailable()) {
      throw new Error('No LLM provider available. Configure ANTHROPIC_API_KEY or OPENAI_API_KEY');
    }

    const systemPrompt = this.buildSystemPrompt(context);
    const userPrompt = `Generate a ComfyUI workflow for: ${description}

Return only the workflow JSON object, no additional text or formatting.`;

    try {
      let response;

      if (this.provider === 'anthropic') {
        const result = await this.client.messages.create({
          model: this.model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{
            role: 'user',
            content: userPrompt
          }]
        });

        response = result.content[0].text;
      } else if (this.provider === 'openai') {
        const result = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.7,
          max_tokens: 4096
        });

        response = result.choices[0].message.content;
      }

      // Parse and validate JSON
      const workflow = this.parseWorkflowResponse(response);
      this.validateWorkflow(workflow);

      return {
        workflow,
        description,
        provider: this.provider,
        model: this.model
      };

    } catch (error) {
      console.error('[LLM] Workflow generation failed:', error.message);
      throw new Error(`Workflow generation failed: ${error.message}`);
    }
  }

  /**
   * Analyze existing workflow and explain its structure
   */
  async analyzeWorkflow(workflow) {
    if (!this.isAvailable()) {
      throw new Error('No LLM provider available');
    }

    const prompt = `Analyze this ComfyUI workflow and explain what it does:

${JSON.stringify(workflow, null, 2)}

Provide a clear, concise explanation of:
1. What this workflow generates
2. Key parameters and their effects
3. The flow of data through nodes`;

    try {
      let response;

      if (this.provider === 'anthropic') {
        const result = await this.client.messages.create({
          model: this.model,
          max_tokens: 2048,
          messages: [{
            role: 'user',
            content: prompt
          }]
        });

        response = result.content[0].text;
      } else if (this.provider === 'openai') {
        const result = await this.client.chat.completions.create({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.5,
          max_tokens: 2048
        });

        response = result.choices[0].message.content;
      }

      return {
        analysis: response,
        workflow,
        provider: this.provider
      };

    } catch (error) {
      console.error('[LLM] Workflow analysis failed:', error.message);
      throw new Error(`Workflow analysis failed: ${error.message}`);
    }
  }

  /**
   * Optimize workflow and suggest improvements
   */
  async optimizeWorkflow(workflow, goals = []) {
    if (!this.isAvailable()) {
      throw new Error('No LLM provider available');
    }

    const goalsText = goals.length > 0
      ? `Optimization goals: ${goals.join(', ')}`
      : 'Optimize for quality and efficiency';

    const prompt = `Analyze this ComfyUI workflow and suggest optimizations:

${JSON.stringify(workflow, null, 2)}

${goalsText}

Provide:
1. Specific parameter improvements
2. Alternative node configurations
3. Performance optimizations
4. Quality enhancements`;

    try {
      let response;

      if (this.provider === 'anthropic') {
        const result = await this.client.messages.create({
          model: this.model,
          max_tokens: 2048,
          messages: [{
            role: 'user',
            content: prompt
          }]
        });

        response = result.content[0].text;
      } else if (this.provider === 'openai') {
        const result = await this.client.chat.completions.create({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.5,
          max_tokens: 2048
        });

        response = result.choices[0].message.content;
      }

      return {
        suggestions: response,
        originalWorkflow: workflow,
        goals,
        provider: this.provider
      };

    } catch (error) {
      console.error('[LLM] Workflow optimization failed:', error.message);
      throw new Error(`Workflow optimization failed: ${error.message}`);
    }
  }

  /**
   * Suggest parameters for a workflow description
   */
  async suggestParameters(description) {
    if (!this.isAvailable()) {
      throw new Error('No LLM provider available');
    }

    const prompt = `For this image generation request: "${description}"

Suggest optimal ComfyUI parameters:
1. Recommended model type (SD1.5, SDXL, etc.)
2. Sampler settings (steps, cfg, sampler name)
3. Image dimensions
4. Positive prompt enhancements
5. Negative prompt suggestions

Return as JSON with keys: modelType, steps, cfg, samplerName, width, height, positivePrompt, negativePrompt`;

    try {
      let response;

      if (this.provider === 'anthropic') {
        const result = await this.client.messages.create({
          model: this.model,
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: prompt
          }]
        });

        response = result.content[0].text;
      } else if (this.provider === 'openai') {
        const result = await this.client.chat.completions.create({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 1024
        });

        response = result.choices[0].message.content;
      }

      // Try to parse as JSON
      try {
        const params = JSON.parse(response.replace(/```json\n?|\n?```/g, '').trim());
        return params;
      } catch {
        // Return as text if not valid JSON
        return { suggestions: response };
      }

    } catch (error) {
      console.error('[LLM] Parameter suggestion failed:', error.message);
      throw new Error(`Parameter suggestion failed: ${error.message}`);
    }
  }

  /**
   * Parse workflow response and extract JSON
   */
  parseWorkflowResponse(response) {
    // Remove markdown code blocks if present
    let cleaned = response.replace(/```json\n?|\n?```/g, '').trim();

    // Try to find JSON object
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    }

    try {
      return JSON.parse(cleaned);
    } catch (error) {
      throw new Error(`Invalid workflow JSON: ${error.message}`);
    }
  }

  /**
   * Validate workflow structure
   */
  validateWorkflow(workflow) {
    if (!workflow || typeof workflow !== 'object') {
      throw new Error('Workflow must be an object');
    }

    // Check for at least one node
    const nodes = Object.keys(workflow);
    if (nodes.length === 0) {
      throw new Error('Workflow must contain at least one node');
    }

    // Validate node structure
    for (const nodeId of nodes) {
      const node = workflow[nodeId];

      if (!node.class_type) {
        throw new Error(`Node ${nodeId} missing class_type`);
      }

      if (!node.inputs || typeof node.inputs !== 'object') {
        throw new Error(`Node ${nodeId} missing inputs object`);
      }
    }

    // Check for required node types (basic validation)
    const nodeTypes = nodes.map(id => workflow[id].class_type);
    const hasCheckpoint = nodeTypes.some(t => t.includes('Checkpoint') || t.includes('Loader'));
    const hasSampler = nodeTypes.some(t => t.includes('Sampler'));
    const hasSave = nodeTypes.some(t => t.includes('Save') || t.includes('Preview'));

    if (!hasCheckpoint) {
      console.warn('[LLM] Warning: Workflow missing checkpoint loader');
    }
    if (!hasSampler) {
      console.warn('[LLM] Warning: Workflow missing sampler node');
    }
    if (!hasSave) {
      console.warn('[LLM] Warning: Workflow missing save/preview node');
    }

    return true;
  }

  /**
   * Get provider information
   */
  getProviderInfo() {
    return {
      provider: this.provider,
      model: this.model,
      available: this.isAvailable()
    };
  }
}

// Export singleton instance
export default new LLMService();
