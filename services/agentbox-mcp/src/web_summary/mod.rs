//! `web-summary` MCP server — a faithful port of
//! `skills/web-summary/mcp-server/server.py`. Same four tools, same
//! parameter names/defaults, same JSON response shapes, same
//! `web-summary://capabilities` resource. Summarises via the Ontology Loom
//! facade (agentbox ADR-051), which grounds every call and delegates to
//! whatever model sits behind it.

mod fetch;
mod llm;
mod types;
mod youtube;

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
use fetch::{fetch_url_content, is_youtube_url};
use llm::{call_llm, LlmConfig};
use types::{SummarizeUrlParams, TopicsParams, YouTubeTranscriptParams};
use youtube::fetch_youtube_transcript;

const RESOURCE_URI: &str = "web-summary://capabilities";
const SERVER_VERSION: &str = "2.1.0";
const TOOL_NAMES: [&str; 4] = [
    "summarize_url",
    "youtube_transcript",
    "generate_topics",
    "health_check",
];

fn truncate_chars(s: &str, max_chars: usize) -> String {
    s.chars().take(max_chars).collect()
}

/// Matches `format_topics()` in the Python source: `obsidian` (default,
/// ADR-2028 D4) and its legacy synonym `logseq` both render `[[wikilink]]`
/// bullets; anything else renders plain bullets.
fn format_topics(topics: &[String], format: &str) -> String {
    if matches!(format, "obsidian" | "logseq") {
        topics
            .iter()
            .map(|t| format!("- [[{t}]]"))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        topics
            .iter()
            .map(|t| format!("- {t}"))
            .collect::<Vec<_>>()
            .join("\n")
    }
}

fn split_topics(content: &str, limit: Option<usize>) -> Vec<String> {
    let mut topics: Vec<String> = content.split(',').map(|t| t.trim().to_string()).collect();
    if let Some(limit) = limit {
        topics.truncate(limit);
    }
    topics
}

fn is_success(value: &serde_json::Value) -> bool {
    value.get("success").and_then(|v| v.as_bool()) == Some(true)
}

#[derive(Debug, Clone)]
pub struct WebSummaryServer {
    tool_router: ToolRouter<Self>,
    llm: LlmConfig,
}

impl WebSummaryServer {
    pub fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
            llm: LlmConfig::from_env(),
        }
    }
}

impl Default for WebSummaryServer {
    fn default() -> Self {
        Self::new()
    }
}

#[tool_router]
impl WebSummaryServer {
    #[tool(
        description = "Summarize content from any URL including YouTube videos.\n\nUse for creating summaries of web articles, blog posts, documentation,\nor YouTube video transcripts. Optionally generates semantic topics for\nnote-taking systems — the Obsidian vault by default."
    )]
    async fn summarize_url(
        &self,
        Parameters(params): Parameters<SummarizeUrlParams>,
    ) -> Result<CallToolResult, McpError> {
        params.validate().map_err(invalid_params)?;
        let url = params.url.clone();

        let (content, source_type) = if is_youtube_url(&url) {
            // The Python source always requests the "en" transcript here,
            // regardless of any language preference elsewhere.
            let video_id = types::extract_video_id(&url);
            let transcript_result = fetch_youtube_transcript(&video_id, "en").await;
            if !is_success(&transcript_result) {
                return json_result(transcript_result);
            }
            let content = transcript_result
                .get("transcript")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            (content, "youtube")
        } else {
            let fetch_result = fetch_url_content(&url).await;
            if !is_success(&fetch_result) {
                return json_result(fetch_result);
            }
            let content = fetch_result
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            (content, "webpage")
        };

        let length_instruction = match params.length.as_str() {
            "short" => "in 2-3 sentences",
            "long" => "in a comprehensive summary with key points",
            _ => "in 1-2 paragraphs",
        };

        let prompt = format!(
            "Summarize the following {source_type} content {length_instruction}.\nFocus on the main ideas and key takeaways.\n\nContent:\n{}\n\nProvide the summary in {} format.",
            truncate_chars(&content, 15_000),
            params.format
        );

        let summary_result = call_llm(&self.llm, &prompt, 2000).await;
        if !is_success(&summary_result) {
            return json_result(summary_result);
        }
        let summary_text = summary_result
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        let mut result = json!({
            "success": true,
            "url": url,
            "source_type": source_type,
            "summary": summary_text,
        });

        if params.include_topics {
            let topic_prompt = format!(
                "Extract 5-10 key topics/concepts from this summary as single words or short phrases.\nReturn them as a comma-separated list.\n\nSummary:\n{summary_text}"
            );
            let topic_result = call_llm(&self.llm, &topic_prompt, 500).await;
            if is_success(&topic_result) {
                let topics = split_topics(
                    topic_result
                        .get("content")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default(),
                    None,
                );
                result["topics_formatted"] = json!(format_topics(&topics, &params.format));
                result["topics"] = json!(topics);
            }
        }

        json_result(result)
    }

    #[tool(
        description = "Extract transcript from a YouTube video.\n\nUse when you need the full text content of a YouTube video for analysis,\nnote-taking, or further processing. Supports multiple languages."
    )]
    async fn youtube_transcript(
        &self,
        Parameters(params): Parameters<YouTubeTranscriptParams>,
    ) -> Result<CallToolResult, McpError> {
        let result = fetch_youtube_transcript(&params.video_id, &params.language).await;
        json_result(result)
    }

    #[tool(
        description = "Generate semantic topic links from text.\n\nUse for extracting key concepts and creating linked notes in the Obsidian\nvault, or other knowledge management systems."
    )]
    async fn generate_topics(
        &self,
        Parameters(params): Parameters<TopicsParams>,
    ) -> Result<CallToolResult, McpError> {
        params.validate().map_err(invalid_params)?;
        let prompt = format!(
            "Extract the top {} key topics/concepts from this text.\nReturn them as a comma-separated list of single words or short phrases (2-3 words max).\nFocus on specific, meaningful concepts rather than generic terms.\n\nText:\n{}",
            params.max_topics,
            truncate_chars(&params.text, 10_000)
        );
        let result = call_llm(&self.llm, &prompt, 500).await;
        if !is_success(&result) {
            return json_result(result);
        }
        let topics = split_topics(
            result
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or_default(),
            Some(params.max_topics.max(0) as usize),
        );
        json_result(json!({
            "success": true,
            "count": topics.len(),
            "topics": topics,
            "formatted": format_topics(&topics, &params.format),
        }))
    }

    #[tool(
        description = "Check web-summary service health.\n\nVerifies Ontology Loom facade connectivity and reports configuration."
    )]
    async fn health_check(&self) -> Result<CallToolResult, McpError> {
        let result = call_llm(&self.llm, "Say 'OK' if you can hear me.", 10).await;
        json_result(json!({
            "success": is_success(&result),
            "llm_url": self.llm.url,
            "llm_status": if is_success(&result) { "connected" } else { "disconnected" },
            "error": result.get("error").cloned().unwrap_or(serde_json::Value::Null),
        }))
    }
}

fn capabilities_json() -> serde_json::Value {
    json!({
        "name": "web-summary",
        "version": SERVER_VERSION,
        "protocol": "rmcp",
        "tools": TOOL_NAMES,
        "llm_backend": "ontology-loom-facade",
        "supported_formats": ["markdown", "plain", "obsidian", "logseq (legacy synonym)"],
        "visionclaw_compatible": true,
    })
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for WebSummaryServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .build(),
        )
        .with_server_info(Implementation::new("web-summary", SERVER_VERSION))
        .with_instructions(
            "Summarize web content including YouTube videos with semantic topic links for an Obsidian vault",
        )
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, McpError> {
        Ok(ListResourcesResult::with_all_items(vec![Resource::new(
            RESOURCE_URI,
            "web-summary capabilities",
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
        let text = serde_json::to_string_pretty(&capabilities_json())
            .map_err(|e| McpError::internal_error(e.to_string(), None))?;
        Ok(ReadResourceResult::new(vec![ResourceContents::text(text, RESOURCE_URI)]).into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_topics_renders_obsidian_wikilinks_for_obsidian_and_logseq() {
        let topics = vec!["rust".to_string(), "mcp servers".to_string()];
        assert_eq!(
            format_topics(&topics, "obsidian"),
            "- [[rust]]\n- [[mcp servers]]"
        );
        assert_eq!(
            format_topics(&topics, "logseq"),
            "- [[rust]]\n- [[mcp servers]]"
        );
    }

    #[test]
    fn format_topics_renders_plain_bullets_otherwise() {
        let topics = vec!["rust".to_string()];
        assert_eq!(format_topics(&topics, "plain"), "- rust");
        assert_eq!(format_topics(&topics, "markdown"), "- rust");
    }

    #[test]
    fn split_topics_trims_and_limits() {
        let topics = split_topics(" rust , mcp , servers , extra ", Some(2));
        assert_eq!(topics, vec!["rust".to_string(), "mcp".to_string()]);
    }

    #[test]
    fn split_topics_without_limit_keeps_everything() {
        let topics = split_topics("a, b, c", None);
        assert_eq!(
            topics,
            vec!["a".to_string(), "b".to_string(), "c".to_string()]
        );
    }

    #[test]
    fn capabilities_json_lists_all_four_tools() {
        let caps = capabilities_json();
        let tools = caps["tools"].as_array().expect("tools array");
        assert_eq!(tools.len(), 4);
        assert_eq!(caps["protocol"], "rmcp");
    }
}
