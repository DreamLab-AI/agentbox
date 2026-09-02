//! `gemini-url-context` MCP server — a faithful port of
//! `skills/gemini-url-context/mcp-server/server.py`. Same five tools, same
//! parameter names/defaults, same JSON response shapes, same
//! `gemini-url-context://capabilities` resource.

mod api;
mod types;

use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{
    CallToolResult, Implementation, ListResourcesResult, PaginatedRequestParams,
    ReadResourceRequestParams, ReadResourceResponse, ReadResourceResult, Resource,
    ResourceContents, ServerCapabilities, ServerInfo,
};
use rmcp::service::RequestContext;
use rmcp::{tool, tool_handler, tool_router, ErrorData as McpError, RoleServer, ServerHandler};
use serde_json::json;

use crate::common::{invalid_params, json_result};
use api::{call_gemini, format_url_metadata, GeminiConfig};
use types::{CompareUrlsParams, ExpandUrlParams, ExpandUrlsParams, ExtractFromUrlParams};

const RESOURCE_URI: &str = "gemini-url-context://capabilities";
const SERVER_VERSION: &str = "1.1.0";
const TOOL_NAMES: [&str; 5] = [
    "expand_url",
    "expand_urls",
    "compare_urls",
    "extract_from_url",
    "health_check",
];

fn is_success(value: &serde_json::Value) -> bool {
    value.get("success").and_then(|v| v.as_bool()) == Some(true)
}

#[derive(Debug, Clone)]
pub struct GeminiUrlContextServer {
    tool_router: ToolRouter<Self>,
    config: GeminiConfig,
}

impl GeminiUrlContextServer {
    pub fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
            config: GeminiConfig::from_env(),
        }
    }
}

impl Default for GeminiUrlContextServer {
    fn default() -> Self {
        Self::new()
    }
}

#[tool_router]
impl GeminiUrlContextServer {
    #[tool(
        description = "Expand and summarize content from a single URL.\n\nUses Gemini 2.5 Flash to fetch URL content and generate a summary\nor analysis based on your prompt. Returns grounded response with\nsource citations."
    )]
    async fn expand_url(
        &self,
        Parameters(params): Parameters<ExpandUrlParams>,
    ) -> Result<CallToolResult, McpError> {
        let prompt = format!("{}\n\nURL: {}", params.prompt, params.url);
        let result = call_gemini(
            &self.config,
            &prompt,
            Some(std::slice::from_ref(&params.url)),
        )
        .await;
        if !is_success(&result) {
            return json_result(result);
        }

        let mut response = json!({
            "success": true,
            "url": params.url,
            "content": result.get("content").cloned().unwrap_or(json!("")),
            "tokens_used": result
                .get("usage")
                .and_then(|u| u.get("total_tokens"))
                .cloned()
                .unwrap_or(json!(0)),
        });

        if params.include_metadata {
            let empty = json!({});
            let url_metadata = result.get("url_metadata").unwrap_or(&empty);
            response["url_status"] = json!(format_url_metadata(url_metadata));

            let grounding = result.get("grounding").unwrap_or(&empty);
            let sources: Vec<serde_json::Value> = grounding
                .get("groundingChunks")
                .and_then(|c| c.as_array())
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|chunk| {
                    chunk
                        .get("web")
                        .and_then(|w| w.get("uri"))
                        .cloned()
                        .unwrap_or(json!(""))
                })
                .collect();
            response["sources"] = json!(sources);
        }

        json_result(response)
    }

    #[tool(
        description = "Batch expand and analyze multiple URLs (up to 20).\n\nEfficiently processes multiple URLs in a single API call.\nGemini fetches all URLs and synthesizes information based on your prompt."
    )]
    async fn expand_urls(
        &self,
        Parameters(params): Parameters<ExpandUrlsParams>,
    ) -> Result<CallToolResult, McpError> {
        params.validate().map_err(invalid_params)?;
        let result = call_gemini(&self.config, &params.prompt, Some(&params.urls)).await;
        if !is_success(&result) {
            return json_result(result);
        }

        let mut response = json!({
            "success": true,
            "urls_requested": params.urls.len(),
            "content": result.get("content").cloned().unwrap_or(json!("")),
            "tokens_used": result
                .get("usage")
                .and_then(|u| u.get("total_tokens"))
                .cloned()
                .unwrap_or(json!(0)),
            "url_content_tokens": result
                .get("usage")
                .and_then(|u| u.get("url_content_tokens"))
                .cloned()
                .unwrap_or(json!(0)),
        });

        if params.include_metadata {
            let empty = json!({});
            let url_metadata = result.get("url_metadata").unwrap_or(&empty);
            response["url_statuses"] = json!(format_url_metadata(url_metadata));
        }

        json_result(response)
    }

    #[tool(
        description = "Compare content from multiple URLs.\n\nAnalyzes 2-20 URLs and provides a structured comparison based on\nspecified aspects. Useful for competitive analysis, documentation\ncomparison, or content synthesis."
    )]
    async fn compare_urls(
        &self,
        Parameters(params): Parameters<CompareUrlsParams>,
    ) -> Result<CallToolResult, McpError> {
        params.validate().map_err(invalid_params)?;
        let aspects_str = params.aspects.join(", ");
        let prompt = format!(
            "Compare the following URLs across these aspects: {aspects_str}\n\nProvide a structured comparison in {} format.\nFor each aspect, highlight similarities and differences.",
            params.format
        );

        let result = call_gemini(&self.config, &prompt, Some(&params.urls)).await;
        if !is_success(&result) {
            return json_result(result);
        }

        let empty = json!({});
        let url_metadata = result.get("url_metadata").unwrap_or(&empty);
        json_result(json!({
            "success": true,
            "urls_compared": params.urls.len(),
            "aspects": params.aspects,
            "comparison": result.get("content").cloned().unwrap_or(json!("")),
            "url_statuses": format_url_metadata(url_metadata),
            "tokens_used": result
                .get("usage")
                .and_then(|u| u.get("total_tokens"))
                .cloned()
                .unwrap_or(json!(0)),
        }))
    }

    #[tool(
        description = "Extract structured data from URL content.\n\nFetches URL and extracts specific fields based on your schema.\nReturns data in the requested format (json, yaml, markdown)."
    )]
    async fn extract_from_url(
        &self,
        Parameters(params): Parameters<ExtractFromUrlParams>,
    ) -> Result<CallToolResult, McpError> {
        let schema_desc = params
            .schema
            .iter()
            .map(|(k, v)| format!("- {k}: {v}"))
            .collect::<Vec<_>>()
            .join("\n");
        let prompt = format!(
            "Extract the following information from the URL content:\n\n{schema_desc}\n\nReturn the extracted data in {} format.\nIf a field cannot be found, indicate \"not found\" for that field.\n\nURL: {}",
            params.format, params.url
        );

        let result = call_gemini(
            &self.config,
            &prompt,
            Some(std::slice::from_ref(&params.url)),
        )
        .await;
        if !is_success(&result) {
            return json_result(result);
        }

        let schema_fields: Vec<String> = params.schema.iter().map(|(k, _)| k.clone()).collect();
        let mut response = json!({
            "success": true,
            "url": params.url,
            "extracted_data": result.get("content").cloned().unwrap_or(json!("")),
            "schema_fields": schema_fields,
            "format": params.format,
        });

        let empty = json!({});
        let url_metadata = result.get("url_metadata").unwrap_or(&empty);
        let url_statuses = format_url_metadata(url_metadata);
        if let Some(first) = url_statuses.first() {
            response["url_status"] = first.get("status").cloned().unwrap_or(json!("UNKNOWN"));
        }

        json_result(response)
    }

    #[tool(
        description = "Check Gemini URL Context service health.\n\nVerifies API key validity and tests URL context capability."
    )]
    async fn health_check(&self) -> Result<CallToolResult, McpError> {
        if self.config.api_key.is_empty() {
            return json_result(json!({
                "success": false,
                "status": "not_configured",
                "error": "GOOGLE_API_KEY not set",
            }));
        }

        let result = call_gemini(
            &self.config,
            "Respond with 'OK' if you can read this URL: https://example.com",
            Some(&["https://example.com".to_string()]),
        )
        .await;

        json_result(json!({
            "success": is_success(&result),
            "status": if is_success(&result) { "connected" } else { "error" },
            "model": self.config.model,
            "api_base": self.config.api_base(),
            "error": result.get("error").cloned().unwrap_or(serde_json::Value::Null),
        }))
    }
}

fn capabilities_json(config: &GeminiConfig) -> serde_json::Value {
    json!({
        "name": "gemini-url-context",
        "version": SERVER_VERSION,
        "protocol": "rmcp",
        "tools": TOOL_NAMES,
        "model": config.model,
        "limits": {
            "max_urls_per_request": 20,
            "max_content_size_mb": 34,
            "supported_content": ["text", "html", "pdf", "images"],
        },
        "api_configured": !config.api_key.is_empty(),
    })
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for GeminiUrlContextServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .build(),
        )
        .with_server_info(Implementation::new("gemini-url-context", SERVER_VERSION))
        .with_instructions("Expand and analyze URLs using Google Gemini 2.5 Flash URL Context API")
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, McpError> {
        Ok(ListResourcesResult::with_all_items(vec![Resource::new(
            RESOURCE_URI,
            "gemini-url-context capabilities",
        )]))
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResponse, McpError> {
        if request.uri != RESOURCE_URI {
            return Err(McpError::invalid_params(
                format!("Unknown resource: {}", request.uri),
                None,
            ));
        }
        let text = serde_json::to_string_pretty(&capabilities_json(&self.config))
            .map_err(|e| McpError::internal_error(e.to_string(), None))?;
        Ok(ReadResourceResult::new(vec![ResourceContents::text(text, RESOURCE_URI)]).into())
    }
}
