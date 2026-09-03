//! Tool parameter types for the `imagemagick` MCP server.
//!
//! Each struct mirrors a `pydantic.BaseModel` from the Python source
//! (`skills/imagemagick/mcp-server/server.py`): same field names, same
//! defaults, same optionality. Pydantic's declarative range/validator
//! constraints (`ge`, `le`, `field_validator`) have no deserialize-time
//! equivalent in `serde`, so each type carries a `validate()` method that
//! the tool body calls before doing any work — reproducing the same
//! rejection behaviour a pydantic `ValidationError` would give FastMCP.

use schemars::JsonSchema;
use serde::Deserialize;

fn default_100() -> i64 {
    100
}

fn default_color() -> String {
    "white".to_string()
}

fn default_true() -> bool {
    true
}

fn default_90() -> i64 {
    90
}

fn default_0() -> i64 {
    0
}

fn default_center() -> String {
    "center".to_string()
}

fn default_false() -> bool {
    false
}

/// Parameters for creating a new image.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreateImageParams {
    /// Output file path
    pub output: String,
    /// Image width in pixels
    #[serde(default = "default_100")]
    pub width: i64,
    /// Image height in pixels
    #[serde(default = "default_100")]
    pub height: i64,
    /// Background color (name, hex, or rgb)
    #[serde(default = "default_color")]
    pub color: String,
}

impl CreateImageParams {
    pub fn validate(&self) -> Result<(), String> {
        in_range("width", self.width, 1, 10000)?;
        in_range("height", self.height, 1, 10000)?;
        Ok(())
    }
}

/// Parameters for image conversion/transformation.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct ConvertParams {
    /// ImageMagick convert command arguments
    pub args: Vec<String>,
}

const DANGEROUS_CHARS: [&str; 8] = [";", "&&", "||", "|", "`", "$", ">", "<"];

impl ConvertParams {
    pub fn validate(&self) -> Result<(), String> {
        if self.args.is_empty() {
            return Err("args cannot be empty".to_string());
        }
        for arg in &self.args {
            for ch in DANGEROUS_CHARS {
                if arg.contains(ch) {
                    return Err(format!("Invalid character '{ch}' in arguments"));
                }
            }
        }
        Ok(())
    }
}

/// Parameters for resizing an image.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct ResizeParams {
    /// Input image file path
    pub input_path: String,
    /// Output image file path
    pub output_path: String,
    /// Target width in pixels
    pub width: i64,
    /// Target height in pixels
    pub height: i64,
    /// Maintain aspect ratio
    #[serde(default = "default_true")]
    pub maintain_aspect: bool,
    /// Output quality (1-100)
    #[serde(default = "default_90")]
    pub quality: i64,
}

impl ResizeParams {
    pub fn validate(&self) -> Result<(), String> {
        in_range("width", self.width, 1, 10000)?;
        in_range("height", self.height, 1, 10000)?;
        in_range("quality", self.quality, 1, 100)?;
        Ok(())
    }
}

/// Parameters for cropping an image.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct CropParams {
    /// Input image file path
    pub input_path: String,
    /// Output image file path
    pub output_path: String,
    /// Crop width in pixels
    pub width: i64,
    /// Crop height in pixels
    pub height: i64,
    /// X offset from left
    #[serde(default = "default_0")]
    pub x_offset: i64,
    /// Y offset from top
    #[serde(default = "default_0")]
    pub y_offset: i64,
}

impl CropParams {
    pub fn validate(&self) -> Result<(), String> {
        at_least("width", self.width, 1)?;
        at_least("height", self.height, 1)?;
        at_least("x_offset", self.x_offset, 0)?;
        at_least("y_offset", self.y_offset, 0)?;
        Ok(())
    }
}

/// Parameters for compositing images.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct CompositeParams {
    /// Background image path
    pub background: String,
    /// Overlay image path
    pub overlay: String,
    /// Output image file path
    pub output_path: String,
    /// Position (center, northwest, etc.)
    #[serde(default = "default_center")]
    pub gravity: String,
    /// Blend percentage
    #[serde(default)]
    pub blend: Option<i64>,
}

impl CompositeParams {
    pub fn validate(&self) -> Result<(), String> {
        if let Some(blend) = self.blend {
            in_range("blend", blend, 0, 100)?;
        }
        Ok(())
    }
}

/// Parameters for identifying image metadata.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct IdentifyParams {
    /// Image file path to analyze
    pub input_path: String,
    /// Include detailed metadata
    #[serde(default = "default_false")]
    pub verbose: bool,
}

/// Parameters for batch processing.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct BatchParams {
    /// Input file glob pattern (e.g., '*.png')
    pub input_pattern: String,
    /// Output directory for processed files
    pub output_dir: String,
    /// Operation: resize, convert, thumbnail
    pub operation: String,
    /// Output format (jpg, png, webp)
    #[serde(default)]
    pub format: Option<String>,
    /// Target width for resize
    #[serde(default)]
    pub width: Option<i64>,
    /// Target height for resize
    #[serde(default)]
    pub height: Option<i64>,
}

impl BatchParams {
    pub fn validate(&self) -> Result<(), String> {
        if let Some(width) = self.width {
            at_least("width", width, 1)?;
        }
        if let Some(height) = self.height {
            at_least("height", height, 1)?;
        }
        Ok(())
    }
}

fn in_range(field: &str, value: i64, min: i64, max: i64) -> Result<(), String> {
    if value < min || value > max {
        return Err(format!(
            "{field} must be between {min} and {max} (got {value})"
        ));
    }
    Ok(())
}

fn at_least(field: &str, value: i64, min: i64) -> Result<(), String> {
    if value < min {
        return Err(format!("{field} must be >= {min} (got {value})"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_image_params_rejects_out_of_range_dimensions() {
        let params = CreateImageParams {
            output: "out.png".to_string(),
            width: 0,
            height: 100,
            color: "white".to_string(),
        };
        assert!(params.validate().is_err());

        let params = CreateImageParams {
            output: "out.png".to_string(),
            width: 100,
            height: 10001,
            color: "white".to_string(),
        };
        assert!(params.validate().is_err());
    }

    #[test]
    fn create_image_params_accepts_boundary_values() {
        let params = CreateImageParams {
            output: "out.png".to_string(),
            width: 1,
            height: 10000,
            color: "white".to_string(),
        };
        assert!(params.validate().is_ok());
    }

    #[test]
    fn convert_params_rejects_empty_args() {
        let params = ConvertParams { args: vec![] };
        assert_eq!(params.validate(), Err("args cannot be empty".to_string()));
    }

    #[test]
    fn convert_params_rejects_shell_metacharacters() {
        for dangerous in [";", "&&", "||", "|", "`", "$", ">", "<"] {
            let params = ConvertParams {
                args: vec![format!("input.png{dangerous}rm -rf /")],
            };
            assert!(
                params.validate().is_err(),
                "expected '{dangerous}' to be rejected"
            );
        }
    }

    #[test]
    fn convert_params_accepts_safe_args() {
        let params = ConvertParams {
            args: vec![
                "input.png".to_string(),
                "-resize".to_string(),
                "50%".to_string(),
            ],
        };
        assert!(params.validate().is_ok());
    }

    #[test]
    fn composite_params_validates_blend_range_only_when_present() {
        let mut params = CompositeParams {
            background: "bg.png".to_string(),
            overlay: "ov.png".to_string(),
            output_path: "out.png".to_string(),
            gravity: "center".to_string(),
            blend: None,
        };
        assert!(params.validate().is_ok());

        params.blend = Some(150);
        assert!(params.validate().is_err());

        params.blend = Some(50);
        assert!(params.validate().is_ok());
    }

    #[test]
    fn batch_params_validates_optional_dimensions() {
        let mut params = BatchParams {
            input_pattern: "*.png".to_string(),
            output_dir: "out".to_string(),
            operation: "resize".to_string(),
            format: None,
            width: Some(0),
            height: None,
        };
        assert!(params.validate().is_err());

        params.width = Some(10);
        assert!(params.validate().is_ok());
    }
}
