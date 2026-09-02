//! Gemini judge HTTP client — port of `GEMINI_BASE_URL`, `GEMINI_MODEL`,
//! `RUBRIC_A_PROMPT`, `RUBRIC_B_PROMPT`, and `run_gemini_judge` from
//! `promote.py`.

use crate::common::http::client;

pub const GEMINI_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta/openai";
pub const GEMINI_MODEL: &str = "gemini-3.1-pro-preview";

const RUBRIC_A_HEAD: &str = "You are evaluating two versions of a knowledge-base wiki page on a
technology/AI topic. You do not know how these versions were produced or what
process created them — just read them as a reader would and judge quality.

Page topic: {topic}

=== VERSION A ===
{version_a}
=== END VERSION A ===

=== VERSION B ===
{version_b}
=== END VERSION B ===

Score VERSION B RELATIVE TO VERSION A on this rubric. For each numeric field,
score VERSION B's absolute quality (0-5, 5 best); \"improvement\" should reflect
whether B is better or worse than A specifically.

Return STRICT JSON only, no markdown fencing, no commentary, matching exactly
this shape:
{
  \"factual_grounding\": <0-5 integer, VERSION B's factual grounding/specificity>,
  \"relevance\": <0-5 integer, VERSION B's relevance/focus on the page topic>,
  \"coherence\": <0-5 integer, VERSION B's internal coherence and readability>,
  \"better_version\": \"A\" | \"B\" | \"tie\",
  \"improvement\": <integer -2..2, how much better (positive) or worse (negative)
                  VERSION B is compared to VERSION A overall>
}

Return ONLY the JSON object.";

const RUBRIC_B_HEAD: &str = "You are evaluating two versions of a knowledge-base wiki page on a
technology/AI topic. You do not know how these versions were produced or what
process created them — just read them as a reader would.

Page topic: {topic}

=== VERSION A ===
{version_a}
=== END VERSION A ===

=== VERSION B ===
{version_b}
=== END VERSION B ===

A reader consults this page to get current, accurate knowledge of the
topic. Which version better serves that reader? Weigh informativeness and
currency of content alongside prose quality — a page that omits significant
recent developments serves the reader worse, and new content is valuable
when accurate and relevant, though it must still be well-integrated.

Score VERSION B RELATIVE TO VERSION A on this rubric. For each numeric field,
score VERSION B's absolute quality (0-5, 5 best); \"improvement\" should reflect
whether B is better or worse than A specifically for that reader.

Return STRICT JSON only, no markdown fencing, no commentary, matching exactly
this shape:
{
  \"factual_grounding\": <0-5 integer, VERSION B's factual grounding/specificity>,
  \"relevance\": <0-5 integer, VERSION B's relevance/focus on the page topic,
                 including whether it covers what a reader would currently
                 want to know>,
  \"coherence\": <0-5 integer, VERSION B's internal coherence and readability>,
  \"better_version\": \"A\" | \"B\" | \"tie\",
  \"improvement\": <integer -2..2, how much better (positive) or worse (negative)
                  VERSION B serves a reader seeking current, accurate
                  knowledge, compared to VERSION A>
}

Return ONLY the JSON object.";

fn render(template: &str, topic: &str, version_a: &str, version_b: &str) -> String {
    template
        .replace("{topic}", topic)
        .replace("{version_a}", version_a)
        .replace("{version_b}", version_b)
}

/// Port of `RUBRIC_A_PROMPT.format(...)`.
pub fn rubric_a_prompt(topic: &str, version_a: &str, version_b: &str) -> String {
    render(RUBRIC_A_HEAD, topic, version_a, version_b)
}

/// Port of `RUBRIC_B_PROMPT.format(...)`.
pub fn rubric_b_prompt(topic: &str, version_a: &str, version_b: &str) -> String {
    render(RUBRIC_B_HEAD, topic, version_a, version_b)
}

/// Port of `run_gemini_judge`: 3 attempts, retrying on HTTP 429 or 5xx.
pub async fn run_gemini_judge(prompt: &str, api_key: &str, timeout_secs: u64) -> Option<String> {
    let body = serde_json::json!({
        "model": GEMINI_MODEL,
        "messages": [
            {"role": "system", "content": "You are a strict JSON-only evaluation assistant."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.0,
        // 1024 truncated rubric-B JSON mid-object on large before/after pages
        // — the estate-wide lesson is max_tokens >= 1536 for judge/reasoning calls.
        "max_tokens": 2048,
        "response_format": {"type": "json_object"},
    });
    let url = format!("{GEMINI_BASE_URL}/chat/completions");

    for attempt in 0..3 {
        let result = client()
            .post(&url)
            .bearer_auth(api_key)
            .json(&body)
            .timeout(std::time::Duration::from_secs(timeout_secs))
            .send()
            .await;

        match result {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    match resp.json::<serde_json::Value>().await {
                        Ok(v) => {
                            return v
                                .get("choices")
                                .and_then(|c| c.get(0))
                                .and_then(|c| c.get("message"))
                                .and_then(|m| m.get("content"))
                                .and_then(|c| c.as_str())
                                .map(|s| s.to_string());
                        }
                        Err(e) => {
                            eprintln!("    [judge] gemini error (attempt {}/3): {e}", attempt + 1);
                            continue;
                        }
                    }
                } else {
                    let code = status.as_u16();
                    let err_body = resp.text().await.unwrap_or_default();
                    let truncated: String = err_body.chars().take(300).collect();
                    eprintln!(
                        "    [judge] gemini HTTP {code} (attempt {}/3): {truncated}",
                        attempt + 1
                    );
                    if code == 429 || code >= 500 {
                        continue;
                    }
                    return None;
                }
            }
            Err(e) => {
                eprintln!("    [judge] gemini error (attempt {}/3): {e}", attempt + 1);
            }
        }
    }
    None
}
