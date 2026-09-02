//! `imagemagick` MCP server — a faithful port of
//! `skills/imagemagick/mcp-server/server.py`. Same seven tools, same
//! parameter names/defaults, same JSON response shapes, same
//! `imagemagick://capabilities` resource.

mod args;
mod exec;
mod types;

use std::path::Path;
use std::time::Duration;

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

use crate::common::{env_or_u64, invalid_params, json_result};
use exec::{run_identify, run_imagemagick};
use types::{
    BatchParams, CompositeParams, ConvertParams, CreateImageParams, CropParams, IdentifyParams,
    ResizeParams,
};

const RESOURCE_URI: &str = "imagemagick://capabilities";
const SERVER_VERSION: &str = "2.1.0";
const TOOL_NAMES: [&str; 7] = [
    "create_image",
    "convert_image",
    "resize_image",
    "crop_image",
    "composite_images",
    "identify_image",
    "batch_process",
];
const FORMATS_SUPPORTED: [&str; 9] = [
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "svg", "pdf",
];

#[derive(Debug, Clone)]
pub struct ImageMagickServer {
    tool_router: ToolRouter<Self>,
    timeout: Duration,
}

impl ImageMagickServer {
    pub fn new() -> Self {
        let timeout_secs = env_or_u64("IMAGEMAGICK_TIMEOUT", 300);
        Self {
            tool_router: Self::tool_router(),
            timeout: Duration::from_secs(timeout_secs),
        }
    }
}

impl Default for ImageMagickServer {
    fn default() -> Self {
        Self::new()
    }
}

#[tool_router]
impl ImageMagickServer {
    #[tool(
        description = "Create a new image with specified dimensions and color.\n\nUse for generating blank canvases, solid color backgrounds, or placeholder images."
    )]
    async fn create_image(
        &self,
        Parameters(params): Parameters<CreateImageParams>,
    ) -> Result<CallToolResult, McpError> {
        params.validate().map_err(invalid_params)?;
        if let Some(parent) = Path::new(&params.output).parent() {
            if !parent.as_os_str().is_empty() && !parent.exists() {
                std::fs::create_dir_all(parent).map_err(|e| invalid_params(e.to_string()))?;
            }
        }
        let mut result = run_imagemagick(&args::create_image_args(&params), self.timeout).await;
        if result.get("success").and_then(|v| v.as_bool()) == Some(true) {
            result["message"] = json!(format!(
                "Created {}x{} {} image at {}",
                params.width, params.height, params.color, params.output
            ));
        }
        json_result(result)
    }

    #[tool(
        description = "Execute an ImageMagick convert command with custom arguments.\n\nUse for advanced transformations: format conversion, filters, effects, annotations.\nExample args: [\"input.png\", \"-resize\", \"50%\", \"output.jpg\"]"
    )]
    async fn convert_image(
        &self,
        Parameters(params): Parameters<ConvertParams>,
    ) -> Result<CallToolResult, McpError> {
        params.validate().map_err(invalid_params)?;
        let result = run_imagemagick(&params.args, self.timeout).await;
        json_result(result)
    }

    #[tool(
        description = "Resize an image to specified dimensions.\n\nUse when you need to change image size for thumbnails, web optimization, or scaling.\nMaintains aspect ratio by default (fits within bounding box)."
    )]
    async fn resize_image(
        &self,
        Parameters(params): Parameters<ResizeParams>,
    ) -> Result<CallToolResult, McpError> {
        params.validate().map_err(invalid_params)?;
        if !Path::new(&params.input_path).exists() {
            return json_result(json!({
                "success": false,
                "error": format!("Input file not found: {}", params.input_path),
            }));
        }

        let (args, geometry) = args::resize_image_args(&params);
        let mut result = run_imagemagick(&args, self.timeout).await;
        if result.get("success").and_then(|v| v.as_bool()) == Some(true) {
            result["message"] = json!(format!(
                "Resized to {geometry} with quality {}",
                params.quality
            ));
        }
        json_result(result)
    }

    #[tool(
        description = "Crop an image to specified region.\n\nUse when you need to extract a portion of an image or remove edges."
    )]
    async fn crop_image(
        &self,
        Parameters(params): Parameters<CropParams>,
    ) -> Result<CallToolResult, McpError> {
        params.validate().map_err(invalid_params)?;
        if !Path::new(&params.input_path).exists() {
            return json_result(json!({
                "success": false,
                "error": format!("Input file not found: {}", params.input_path),
            }));
        }

        let (args, geometry) = args::crop_image_args(&params);
        let mut result = run_imagemagick(&args, self.timeout).await;
        if result.get("success").and_then(|v| v.as_bool()) == Some(true) {
            result["message"] = json!(format!("Cropped region: {geometry}"));
        }
        json_result(result)
    }

    #[tool(
        description = "Composite (overlay) one image onto another.\n\nUse for watermarks, image overlays, or combining multiple images."
    )]
    async fn composite_images(
        &self,
        Parameters(params): Parameters<CompositeParams>,
    ) -> Result<CallToolResult, McpError> {
        params.validate().map_err(invalid_params)?;
        if !Path::new(&params.background).exists() {
            return json_result(json!({
                "success": false,
                "error": format!("Background file not found: {}", params.background),
            }));
        }
        if !Path::new(&params.overlay).exists() {
            return json_result(json!({
                "success": false,
                "error": format!("Overlay file not found: {}", params.overlay),
            }));
        }

        let mut result = run_imagemagick(&args::composite_images_args(&params), self.timeout).await;
        if result.get("success").and_then(|v| v.as_bool()) == Some(true) {
            result["message"] = json!(format!("Composited images with gravity={}", params.gravity));
        }
        json_result(result)
    }

    #[tool(
        description = "Get image metadata and properties.\n\nUse to inspect image format, dimensions, color depth, and other properties."
    )]
    async fn identify_image(
        &self,
        Parameters(params): Parameters<IdentifyParams>,
    ) -> Result<CallToolResult, McpError> {
        if !Path::new(&params.input_path).exists() {
            return json_result(json!({
                "success": false,
                "error": format!("File not found: {}", params.input_path),
            }));
        }
        let result = run_identify(&params.input_path, params.verbose).await;
        json_result(result)
    }

    #[tool(
        description = "Batch process multiple images matching a pattern.\n\nUse for bulk operations like converting all PNGs to JPG, generating thumbnails,\nor resizing an entire directory of images."
    )]
    async fn batch_process(
        &self,
        Parameters(params): Parameters<BatchParams>,
    ) -> Result<CallToolResult, McpError> {
        params.validate().map_err(invalid_params)?;

        std::fs::create_dir_all(&params.output_dir).map_err(|e| invalid_params(e.to_string()))?;

        let files: Vec<String> = glob::glob(&params.input_pattern)
            .map_err(|e| invalid_params(e.to_string()))?
            .filter_map(Result::ok)
            .map(|p| p.to_string_lossy().to_string())
            .collect();

        if files.is_empty() {
            return json_result(json!({
                "success": false,
                "error": format!("No files match pattern: {}", params.input_pattern),
            }));
        }

        let mut results = Vec::new();
        let mut success_count: i64 = 0;

        for input_file in &files {
            let input_path = Path::new(input_file);
            let output_name = match &params.format {
                Some(fmt) => format!(
                    "{}.{fmt}",
                    input_path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or_default()
                ),
                None => input_path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or_default()
                    .to_string(),
            };
            let output_path = Path::new(&params.output_dir).join(&output_name);
            let output_path_str = output_path.to_string_lossy().to_string();

            let args = args::batch_operation_args(&params, input_file, &output_path_str);

            let Some(args) = args else {
                results.push(json!({"file": input_file, "error": "Invalid operation parameters"}));
                continue;
            };

            let result = run_imagemagick(&args, self.timeout).await;
            if result.get("success").and_then(|v| v.as_bool()) == Some(true) {
                success_count += 1;
                results
                    .push(json!({"file": input_file, "output": output_path_str, "success": true}));
            } else {
                results.push(json!({
                    "file": input_file,
                    "error": result.get("error").cloned().unwrap_or(json!(null)),
                    "success": false,
                }));
            }
        }

        json_result(json!({
            "success": success_count as usize == files.len(),
            "processed": success_count,
            "total": files.len(),
            "results": results,
        }))
    }
}

fn capabilities_json() -> serde_json::Value {
    json!({
        "name": "imagemagick",
        "version": SERVER_VERSION,
        "protocol": "rmcp",
        "tools": TOOL_NAMES,
        "formats_supported": FORMATS_SUPPORTED,
        "visionclaw_compatible": true,
    })
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for ImageMagickServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .build(),
        )
        .with_server_info(Implementation::new("imagemagick", SERVER_VERSION))
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, McpError> {
        Ok(ListResourcesResult::with_all_items(vec![Resource::new(
            RESOURCE_URI,
            "imagemagick capabilities",
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
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn timeout_defaults_to_300_seconds_when_unset() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        unsafe {
            std::env::remove_var("IMAGEMAGICK_TIMEOUT");
        }
        let server = ImageMagickServer::new();
        assert_eq!(server.timeout, Duration::from_secs(300));
    }

    #[test]
    fn timeout_honours_imagemagick_timeout_env_var() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        unsafe {
            std::env::set_var("IMAGEMAGICK_TIMEOUT", "42");
        }
        let server = ImageMagickServer::new();
        assert_eq!(server.timeout, Duration::from_secs(42));
        unsafe {
            std::env::remove_var("IMAGEMAGICK_TIMEOUT");
        }
    }

    #[test]
    fn capabilities_json_lists_all_seven_tools() {
        let caps = capabilities_json();
        let tools = caps["tools"].as_array().expect("tools array");
        assert_eq!(tools.len(), 7);
        assert_eq!(caps["protocol"], "rmcp");
    }
}
