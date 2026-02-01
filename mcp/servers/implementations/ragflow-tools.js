/**
 * RAGFlow MCP Tools Implementation
 * Provides knowledge base query, document ingestion, and semantic search
 * for the VisionFlow multi-agent system via docker_ragflow network.
 */

const http = require('http');
const https = require('https');

// RAGFlow service configuration from docker_ragflow network
const RAGFLOW_CONFIG = {
  host: process.env.RAGFLOW_HOST || 'docker-ragflow-cpu-1',
  port: parseInt(process.env.RAGFLOW_PORT || '80'),
  apiPort: parseInt(process.env.RAGFLOW_API_PORT || '9380'),
  timeout: parseInt(process.env.RAGFLOW_TIMEOUT || '30000')
};

/**
 * Make HTTP request to RAGFlow API
 */
function ragflowRequest(path, method = 'GET', data = null, useApiPort = true) {
  return new Promise((resolve, reject) => {
    const port = useApiPort ? RAGFLOW_CONFIG.apiPort : RAGFLOW_CONFIG.port;
    const options = {
      hostname: RAGFLOW_CONFIG.host,
      port: port,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: RAGFLOW_CONFIG.timeout
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          resolve({ status: res.statusCode, data: result });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

/**
 * RAGFlow Tools for MCP Integration
 */
const ragflowTools = {
  /**
   * Check RAGFlow service health and status
   */
  async ragflow_status() {
    try {
      const [webStatus, apiStatus] = await Promise.all([
        ragflowRequest('/', 'GET', null, false).catch(e => ({ status: 0, error: e.message })),
        ragflowRequest('/api/v1/status', 'GET', null, true).catch(e => ({ status: 0, error: e.message }))
      ]);

      return {
        success: true,
        web: {
          host: `${RAGFLOW_CONFIG.host}:${RAGFLOW_CONFIG.port}`,
          status: webStatus.status === 200 ? 'healthy' : 'unhealthy',
          httpCode: webStatus.status
        },
        api: {
          host: `${RAGFLOW_CONFIG.host}:${RAGFLOW_CONFIG.apiPort}`,
          status: apiStatus.status === 200 ? 'healthy' : 'unhealthy',
          httpCode: apiStatus.status,
          data: apiStatus.data
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  /**
   * Query the RAGFlow knowledge base with semantic search
   * @param {string} query - The search query
   * @param {string} knowledgeBase - Knowledge base ID (optional)
   * @param {number} topK - Number of results to return (default: 5)
   */
  async ragflow_query(query, knowledgeBase = null, topK = 5) {
    try {
      const payload = {
        question: query,
        top_k: topK
      };

      if (knowledgeBase) {
        payload.kb_ids = [knowledgeBase];
      }

      const response = await ragflowRequest('/api/v1/retrieval', 'POST', payload);

      return {
        success: response.status === 200,
        query: query,
        results: response.data?.data || [],
        total: response.data?.total || 0
      };
    } catch (error) {
      return { success: false, error: error.message, query: query };
    }
  },

  /**
   * List available knowledge bases
   */
  async ragflow_list_kb() {
    try {
      const response = await ragflowRequest('/api/v1/kb/list', 'GET');

      return {
        success: response.status === 200,
        knowledgeBases: response.data?.data || []
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  /**
   * Create a new knowledge base
   * @param {string} name - Knowledge base name
   * @param {string} description - Description
   * @param {string} embeddingModel - Embedding model to use
   */
  async ragflow_create_kb(name, description = '', embeddingModel = 'BAAI/bge-large-en-v1.5') {
    try {
      const payload = {
        name: name,
        description: description,
        embd_id: embeddingModel,
        parser_id: 'naive'
      };

      const response = await ragflowRequest('/api/v1/kb/create', 'POST', payload);

      return {
        success: response.status === 200,
        knowledgeBase: response.data?.data || null,
        message: response.data?.message || 'Knowledge base created'
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  /**
   * Upload document to knowledge base for ingestion
   * @param {string} kbId - Knowledge base ID
   * @param {string} content - Document content
   * @param {string} filename - Document filename
   */
  async ragflow_ingest(kbId, content, filename = 'document.txt') {
    try {
      const payload = {
        kb_id: kbId,
        file_name: filename,
        file_content: Buffer.from(content).toString('base64')
      };

      const response = await ragflowRequest('/api/v1/document/upload', 'POST', payload);

      return {
        success: response.status === 200,
        documentId: response.data?.data?.id || null,
        message: response.data?.message || 'Document uploaded'
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  /**
   * Chat with RAGFlow assistant (RAG-enhanced conversation)
   * @param {string} message - User message
   * @param {string} assistantId - Assistant/dialog ID
   * @param {string} conversationId - Conversation ID for context
   */
  async ragflow_chat(message, assistantId = null, conversationId = null) {
    try {
      const payload = {
        question: message,
        stream: false
      };

      if (assistantId) payload.assistant_id = assistantId;
      if (conversationId) payload.conversation_id = conversationId;

      const response = await ragflowRequest('/api/v1/chat/completions', 'POST', payload);

      return {
        success: response.status === 200,
        answer: response.data?.data?.answer || response.data?.choices?.[0]?.message?.content || '',
        sources: response.data?.data?.reference || [],
        conversationId: response.data?.data?.conversation_id || conversationId
      };
    } catch (error) {
      return { success: false, error: error.message, message: message };
    }
  }
};

// Register globally for MCP server integration
global.ragflowManager = ragflowTools;

console.log(`[${new Date().toISOString()}] INFO [ragflow-tools] RAGFlow manager initialized (host: ${RAGFLOW_CONFIG.host}:${RAGFLOW_CONFIG.apiPort})`);

// Export tools for MCP server integration
module.exports = {
  ragflowTools,
  RAGFLOW_CONFIG,

  // Tool definitions for MCP schema
  toolDefinitions: [
    {
      name: 'ragflow_status',
      description: 'Check RAGFlow service health and connection status',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'ragflow_query',
      description: 'Query the RAGFlow knowledge base with semantic search',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          knowledgeBase: { type: 'string', description: 'Knowledge base ID (optional)' },
          topK: { type: 'number', description: 'Number of results (default: 5)' }
        },
        required: ['query']
      }
    },
    {
      name: 'ragflow_list_kb',
      description: 'List available knowledge bases in RAGFlow',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'ragflow_create_kb',
      description: 'Create a new knowledge base in RAGFlow',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Knowledge base name' },
          description: { type: 'string', description: 'Description' },
          embeddingModel: { type: 'string', description: 'Embedding model ID' }
        },
        required: ['name']
      }
    },
    {
      name: 'ragflow_ingest',
      description: 'Upload and ingest document into knowledge base',
      inputSchema: {
        type: 'object',
        properties: {
          kbId: { type: 'string', description: 'Knowledge base ID' },
          content: { type: 'string', description: 'Document content' },
          filename: { type: 'string', description: 'Document filename' }
        },
        required: ['kbId', 'content']
      }
    },
    {
      name: 'ragflow_chat',
      description: 'Chat with RAGFlow assistant using RAG-enhanced responses',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'User message' },
          assistantId: { type: 'string', description: 'Assistant ID' },
          conversationId: { type: 'string', description: 'Conversation ID for context' }
        },
        required: ['message']
      }
    }
  ]
};
