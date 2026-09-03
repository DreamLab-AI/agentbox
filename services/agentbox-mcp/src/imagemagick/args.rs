//! Pure ImageMagick CLI argument builders, factored out of the tool bodies
//! in `mod.rs` so the exact argument vectors sent to the ImageMagick CLI
//! can be unit tested without spawning a subprocess.

use super::types::{BatchParams, CompositeParams, CreateImageParams, CropParams, ResizeParams};

pub fn create_image_args(params: &CreateImageParams) -> Vec<String> {
    vec![
        "-size".to_string(),
        format!("{}x{}", params.width, params.height),
        format!("xc:{}", params.color),
        params.output.clone(),
    ]
}

/// Returns `(args, geometry)` — the geometry is also needed for the
/// success message.
pub fn resize_image_args(params: &ResizeParams) -> (Vec<String>, String) {
    let mut geometry = format!("{}x{}", params.width, params.height);
    if !params.maintain_aspect {
        geometry.push('!');
    }
    let args = vec![
        params.input_path.clone(),
        "-resize".to_string(),
        geometry.clone(),
        "-quality".to_string(),
        params.quality.to_string(),
        params.output_path.clone(),
    ];
    (args, geometry)
}

/// Returns `(args, geometry)`.
pub fn crop_image_args(params: &CropParams) -> (Vec<String>, String) {
    let geometry = format!(
        "{}x{}+{}+{}",
        params.width, params.height, params.x_offset, params.y_offset
    );
    let args = vec![
        params.input_path.clone(),
        "-crop".to_string(),
        geometry.clone(),
        "+repage".to_string(),
        params.output_path.clone(),
    ];
    (args, geometry)
}

pub fn composite_images_args(params: &CompositeParams) -> Vec<String> {
    let mut args = vec![
        params.background.clone(),
        params.overlay.clone(),
        "-gravity".to_string(),
        params.gravity.clone(),
        "-composite".to_string(),
        params.output_path.clone(),
    ];
    if let Some(blend) = params.blend {
        args.insert(4, "-blend".to_string());
        args.insert(5, format!("{blend}%"));
    }
    args
}

/// Matches the per-file operation dispatch inside `batch_process()`.
/// Returns `None` for "Invalid operation parameters" (unknown operation, or
/// missing width/height for an operation that requires them).
pub fn batch_operation_args(
    params: &BatchParams,
    input_file: &str,
    output_path: &str,
) -> Option<Vec<String>> {
    match params.operation.as_str() {
        "resize" if params.width.is_some() && params.height.is_some() => Some(vec![
            input_file.to_string(),
            "-resize".to_string(),
            format!("{}x{}", params.width.unwrap(), params.height.unwrap()),
            output_path.to_string(),
        ]),
        "thumbnail" if params.width.is_some() => {
            let width = params.width.unwrap();
            Some(vec![
                input_file.to_string(),
                "-thumbnail".to_string(),
                format!("{width}x{width}"),
                output_path.to_string(),
            ])
        }
        "convert" => Some(vec![input_file.to_string(), output_path.to_string()]),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn batch_params(operation: &str, width: Option<i64>, height: Option<i64>) -> BatchParams {
        BatchParams {
            input_pattern: "*.png".to_string(),
            output_dir: "/tmp/out".to_string(),
            operation: operation.to_string(),
            format: None,
            width,
            height,
        }
    }

    #[test]
    fn create_image_args_matches_python_order() {
        let params = CreateImageParams {
            output: "/tmp/out.png".to_string(),
            width: 200,
            height: 100,
            color: "red".to_string(),
        };
        assert_eq!(
            create_image_args(&params),
            vec!["-size", "200x100", "xc:red", "/tmp/out.png"]
        );
    }

    #[test]
    fn resize_image_args_appends_bang_when_aspect_not_maintained() {
        let params = ResizeParams {
            input_path: "in.png".to_string(),
            output_path: "out.png".to_string(),
            width: 50,
            height: 60,
            maintain_aspect: false,
            quality: 80,
        };
        let (args, geometry) = resize_image_args(&params);
        assert_eq!(geometry, "50x60!");
        assert_eq!(
            args,
            vec!["in.png", "-resize", "50x60!", "-quality", "80", "out.png"]
        );
    }

    #[test]
    fn resize_image_args_omits_bang_when_aspect_maintained() {
        let params = ResizeParams {
            input_path: "in.png".to_string(),
            output_path: "out.png".to_string(),
            width: 50,
            height: 60,
            maintain_aspect: true,
            quality: 90,
        };
        let (_, geometry) = resize_image_args(&params);
        assert_eq!(geometry, "50x60");
    }

    #[test]
    fn crop_image_args_builds_imagemagick_geometry() {
        let params = CropParams {
            input_path: "in.png".to_string(),
            output_path: "out.png".to_string(),
            width: 10,
            height: 20,
            x_offset: 3,
            y_offset: 4,
        };
        let (args, geometry) = crop_image_args(&params);
        assert_eq!(geometry, "10x20+3+4");
        assert_eq!(
            args,
            vec!["in.png", "-crop", "10x20+3+4", "+repage", "out.png"]
        );
    }

    #[test]
    fn composite_images_args_without_blend() {
        let params = CompositeParams {
            background: "bg.png".to_string(),
            overlay: "ov.png".to_string(),
            output_path: "out.png".to_string(),
            gravity: "center".to_string(),
            blend: None,
        };
        assert_eq!(
            composite_images_args(&params),
            vec![
                "bg.png",
                "ov.png",
                "-gravity",
                "center",
                "-composite",
                "out.png"
            ]
        );
    }

    #[test]
    fn composite_images_args_inserts_blend_before_composite() {
        let params = CompositeParams {
            background: "bg.png".to_string(),
            overlay: "ov.png".to_string(),
            output_path: "out.png".to_string(),
            gravity: "north".to_string(),
            blend: Some(40),
        };
        assert_eq!(
            composite_images_args(&params),
            vec![
                "bg.png",
                "ov.png",
                "-gravity",
                "north",
                "-blend",
                "40%",
                "-composite",
                "out.png"
            ]
        );
    }

    #[test]
    fn batch_operation_args_resize_requires_both_dimensions() {
        let params = batch_params("resize", Some(100), Some(50));
        assert_eq!(
            batch_operation_args(&params, "a.png", "out/a.png"),
            Some(vec![
                "a.png".to_string(),
                "-resize".to_string(),
                "100x50".to_string(),
                "out/a.png".to_string(),
            ])
        );

        let missing_height = batch_params("resize", Some(100), None);
        assert_eq!(
            batch_operation_args(&missing_height, "a.png", "out/a.png"),
            None
        );
    }

    #[test]
    fn batch_operation_args_thumbnail_is_square() {
        let params = batch_params("thumbnail", Some(64), None);
        assert_eq!(
            batch_operation_args(&params, "a.png", "out/a.png"),
            Some(vec![
                "a.png".to_string(),
                "-thumbnail".to_string(),
                "64x64".to_string(),
                "out/a.png".to_string(),
            ])
        );
    }

    #[test]
    fn batch_operation_args_convert_ignores_dimensions() {
        let params = batch_params("convert", None, None);
        assert_eq!(
            batch_operation_args(&params, "a.png", "out/a.jpg"),
            Some(vec!["a.png".to_string(), "out/a.jpg".to_string()])
        );
    }

    #[test]
    fn batch_operation_args_unknown_operation_is_none() {
        let params = batch_params("rotate", Some(1), Some(1));
        assert_eq!(batch_operation_args(&params, "a.png", "out/a.png"), None);
    }
}
