//! `PerplexityClient` — Perplexity API client for content enrichment with UK
//! English focus.
//!
//! Handles API requests, citation extraction, and structured content
//! generation. Ported from
//! `skills/ontology-enrich/src/perplexity_client.py`, keeping the same env
//! var names, model name, endpoint, retry/backoff behaviour and response
//! shape as the Python original.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{OntologyToolsError, Result};

/// Structured citation from the Perplexity API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Citation {
    pub source: String,
    pub url: Option<String>,
    pub relevance: f64,
    pub snippet: Option<String>,
}

/// Enriched content with citations and metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrichedContent {
    pub definition: String,
    pub citations: Vec<Citation>,
    pub related_concepts: Vec<String>,
    pub confidence: f64,
}

const API_BASE: &str = "https://api.perplexity.ai";
pub const DEFAULT_MODEL: &str = "sonar-pro";

/// Client for the Perplexity API with UK English focus and citation
/// extraction.
///
/// Uses `sonar-pro` by default for comprehensive research with citations.
pub struct PerplexityClient {
    api_key: String,
    model: String,
    temperature: f64,
    max_tokens: u32,
    http: reqwest::Client,
}

impl PerplexityClient {
    pub fn new(api_key: impl Into<String>) -> Self {
        Self::with_model(api_key, DEFAULT_MODEL)
    }

    pub fn with_model(api_key: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            model: model.into(),
            temperature: 0.2,
            max_tokens: 2000,
            http: reqwest::Client::new(),
        }
    }

    pub fn temperature(mut self, temperature: f64) -> Self {
        self.temperature = temperature;
        self
    }

    pub fn max_tokens(mut self, max_tokens: u32) -> Self {
        self.max_tokens = max_tokens;
        self
    }

    /// Enrich an ontology definition with Perplexity API content.
    pub async fn enrich_definition(
        &self,
        current_def: &str,
        context: &str,
        uk_english: bool,
    ) -> Result<EnrichedContent> {
        let prompt = self.build_enrichment_prompt(current_def, context, uk_english);
        let response = self.query_with_retries(&prompt, 3, 2.0).await?;
        self.parse_response(&response)
    }

    fn build_enrichment_prompt(
        &self,
        current_def: &str,
        context: &str,
        uk_english: bool,
    ) -> String {
        let uk_directive = if uk_english {
            "\nLANGUAGE REQUIREMENTS:\n\
             - Use British English spelling (e.g., \"behaviour\", \"optimise\", \"colour\")\n\
             - Use British terminology and conventions\n\
             - Prefer UK-based examples and sources where available\n"
        } else {
            ""
        };

        format!(
            "Context: UK-based technical documentation for AI systems ontology.\n\n\
             {uk_directive}\n\n\
             TASK: Enrich the following ontology definition for the concept \"{context}\".\n\n\
             CURRENT DEFINITION:\n\
             {current_def}\n\n\
             REQUIREMENTS:\n\
             1. Provide a clear, technical explanation suitable for an ontology\n\
             2. Include real-world examples from the UK tech sector where relevant\n\
             3. Cite authoritative sources (academic papers, standards, technical documentation)\n\
             4. Identify 2-3 related concepts that should be cross-referenced\n\
             5. Maintain technical accuracy while improving clarity\n\n\
             OUTPUT FORMAT:\n\
             Respond ONLY with valid JSON in this exact structure:\n\
             {{\n\
             \x20   \"definition\": \"Enhanced definition text here...\",\n\
             \x20   \"citations\": [\n\
             \x20       {{\n\
             \x20           \"source\": \"Source name\",\n\
             \x20           \"url\": \"https://...\",\n\
             \x20           \"relevance\": 0.95,\n\
             \x20           \"snippet\": \"Relevant quote\"\n\
             \x20       }}\n\
             \x20   ],\n\
             \x20   \"related_concepts\": [\"Concept1\", \"Concept2\"],\n\
             \x20   \"confidence\": 0.9\n\
             }}\n\n\
             Do not include any text outside the JSON structure."
        )
    }

    async fn query_with_retries(
        &self,
        prompt: &str,
        max_retries: u32,
        backoff_factor: f64,
    ) -> Result<Value> {
        let body = json!({
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a technical ontology expert specializing in AI systems documentation with UK English preferences."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "return_citations": true,
            "return_related_questions": true
        });

        let mut last_error: Option<String> = None;

        for attempt in 0..max_retries {
            let result = self
                .http
                .post(format!("{API_BASE}/chat/completions"))
                .bearer_auth(&self.api_key)
                .header("Content-Type", "application/json")
                .json(&body)
                .timeout(Duration::from_secs(30))
                .send()
                .await;

            match result {
                Ok(resp) => match resp.error_for_status() {
                    Ok(resp) => {
                        return resp
                            .json::<Value>()
                            .await
                            .map_err(|e| OntologyToolsError::PerplexityApi(e.to_string()));
                    }
                    Err(e) => last_error = Some(e.to_string()),
                },
                Err(e) => last_error = Some(e.to_string()),
            }

            if attempt + 1 < max_retries {
                let sleep_secs = backoff_factor.powi(attempt as i32);
                tokio::time::sleep(Duration::from_secs_f64(sleep_secs)).await;
            }
        }

        Err(OntologyToolsError::PerplexityApi(format!(
            "API request failed after {max_retries} attempts: {}",
            last_error.unwrap_or_default()
        )))
    }

    /// Parse an API response into [`EnrichedContent`].
    fn parse_response(&self, response: &Value) -> Result<EnrichedContent> {
        let content_str = response
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
            .ok_or_else(|| {
                OntologyToolsError::PerplexityApi("missing choices[0].message.content".into())
            })?;

        let cleaned = strip_markdown_fence(content_str);

        let data: Value = serde_json::from_str(&cleaned).map_err(|e| {
            OntologyToolsError::PerplexityApi(format!("Failed to parse API response: {e}"))
        })?;

        for required in ["definition", "citations", "related_concepts"] {
            if data.get(required).is_none() {
                return Err(OntologyToolsError::PerplexityApi(format!(
                    "Missing required field: {required}"
                )));
            }
        }

        let definition = data["definition"].as_str().unwrap_or_default().to_string();

        let mut citations: Vec<Citation> = Vec::new();
        let mut seen_urls: Vec<String> = Vec::new();
        if let Some(cites) = data["citations"].as_array() {
            for cite in cites {
                let url = cite
                    .get("url")
                    .and_then(|u| u.as_str())
                    .map(|s| s.to_string());
                if let Some(u) = &url {
                    seen_urls.push(u.clone());
                }
                citations.push(Citation {
                    source: cite
                        .get("source")
                        .and_then(|s| s.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    url,
                    relevance: cite
                        .get("relevance")
                        .and_then(|r| r.as_f64())
                        .unwrap_or(0.5),
                    snippet: cite
                        .get("snippet")
                        .and_then(|s| s.as_str())
                        .map(|s| s.to_string()),
                });
            }
        }

        // Add API-level citations (bare URL strings) if not already included.
        if let Some(api_citations) = response.get("citations").and_then(|c| c.as_array()) {
            for api_cite in api_citations {
                if let Some(url) = api_cite.as_str() {
                    if !seen_urls.iter().any(|u| u == url) {
                        citations.push(Citation {
                            source: "Perplexity Source".to_string(),
                            url: Some(url.to_string()),
                            relevance: 0.7,
                            snippet: None,
                        });
                    }
                }
            }
        }

        let related_concepts: Vec<String> = data["related_concepts"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        let confidence = data
            .get("confidence")
            .and_then(|c| c.as_f64())
            .unwrap_or(0.8);

        Ok(EnrichedContent {
            definition,
            citations,
            related_concepts,
            confidence,
        })
    }

    /// Extract structured citations from raw API response metadata (the
    /// top-level `citations` array of URL strings).
    pub fn extract_citations(&self, response: &Value) -> Vec<Citation> {
        response
            .get("citations")
            .and_then(|c| c.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(|url| Citation {
                        source: "Perplexity Source".to_string(),
                        url: Some(url.to_string()),
                        relevance: 0.7,
                        snippet: None,
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
}

/// Strip a leading/trailing ``` fenced code block wrapper from `content`, if
/// present, mirroring the Python original's line-based unwrap.
fn strip_markdown_fence(content: &str) -> String {
    let trimmed = content.trim();
    if !trimmed.starts_with("```") {
        return trimmed.to_string();
    }

    let mut json_lines = Vec::new();
    let mut in_block = false;
    for line in trimmed.lines() {
        if line.trim_start().starts_with("```") {
            in_block = !in_block;
            continue;
        }
        json_lines.push(line);
    }
    json_lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_fence_removes_code_block_markers() {
        let wrapped = "```json\n{\"a\": 1}\n```";
        assert_eq!(strip_markdown_fence(wrapped), "{\"a\": 1}");
    }

    #[test]
    fn strip_fence_passthrough_when_no_fence() {
        assert_eq!(strip_markdown_fence("{\"a\": 1}"), "{\"a\": 1}");
    }

    #[test]
    fn parse_response_extracts_definition_and_citations() {
        let client = PerplexityClient::new("test-key");
        let response = json!({
            "choices": [{
                "message": {
                    "content": "{\"definition\": \"A test definition\", \"citations\": [{\"source\": \"S\", \"url\": \"https://x\", \"relevance\": 0.9}], \"related_concepts\": [\"A\", \"B\"], \"confidence\": 0.95}"
                }
            }],
            "citations": ["https://y"]
        });
        let enriched = client.parse_response(&response).unwrap();
        assert_eq!(enriched.definition, "A test definition");
        assert_eq!(enriched.citations.len(), 2);
        assert_eq!(
            enriched.related_concepts,
            vec!["A".to_string(), "B".to_string()]
        );
        assert_eq!(enriched.confidence, 0.95);
    }

    #[test]
    fn parse_response_missing_field_errors() {
        let client = PerplexityClient::new("test-key");
        let response = json!({
            "choices": [{"message": {"content": "{\"definition\": \"x\"}"}}]
        });
        assert!(client.parse_response(&response).is_err());
    }
}
