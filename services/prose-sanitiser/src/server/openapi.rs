//! The OpenAPI 3.0.3 document, generated from one declarative table plus live
//! runtime values, so it cannot drift from the endpoints actually served.

use serde_json::{json, Map, Value};

use super::{ALLOWED_CLEAN_OPTIONS, VERSION};

fn error_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "ok": {"type": "boolean", "enum": [false]},
            "error": {"type": "string"},
        },
    })
}

fn common_errors() -> Vec<(&'static str, &'static str)> {
    vec![
        ("400", "Bad request"),
        ("401", "Missing/invalid bearer token"),
        ("404", "Not found"),
        ("413", "Request body too large"),
        ("500", "Internal error"),
    ]
}

/// The shared `{file, name}` request body, optionally extended.
fn file_request(extra: Option<(&str, Value)>) -> Value {
    let mut properties = Map::new();
    properties.insert(
        "file".into(),
        json!({
            "type": "string",
            "description": "Base64-encoded file bytes",
            "example": "SGVsbG8gd29ybGQ=",
        }),
    );
    properties.insert(
        "name".into(),
        json!({
            "type": "string",
            "description": "Original filename (extension drives format routing)",
            "example": "notes.md",
        }),
    );
    if let Some((key, schema)) = extra {
        properties.insert(key.into(), schema);
    }
    json!({
        "type": "object",
        "required": ["file"],
        "properties": Value::Object(properties),
    })
}

fn clean_request_schema() -> Value {
    let mut options = Map::new();
    for (key, is_bool) in ALLOWED_CLEAN_OPTIONS {
        options.insert(
            (*key).into(),
            if *is_bool {
                json!({"type": "boolean"})
            } else {
                json!({"type": "string"})
            },
        );
    }
    file_request(Some((
        "options",
        json!({
            "type": "object",
            "properties": Value::Object(options),
            "additionalProperties": false,
        }),
    )))
}

fn json_content(schema: Value) -> Value {
    json!({"application/json": {"schema": schema}})
}

fn operation(summary: &str, success: Value, request_body: Option<Value>) -> Value {
    let mut responses = Map::new();
    for (status, description) in common_errors() {
        responses.insert(
            status.into(),
            json!({"description": description, "content": json_content(error_schema())}),
        );
    }
    responses.insert(
        "200".into(),
        json!({"description": "Success", "content": json_content(success)}),
    );
    let mut operation = Map::new();
    operation.insert("summary".into(), json!(summary));
    operation.insert("responses".into(), Value::Object(responses));
    if let Some(body) = request_body {
        operation.insert(
            "requestBody".into(),
            json!({"required": true, "content": json_content(body)}),
        );
    }
    Value::Object(operation)
}

fn boolean_map(keys: &[&str]) -> Value {
    let mut map = Map::new();
    for key in keys {
        map.insert((*key).into(), json!({"type": "boolean"}));
    }
    json!({"type": "object", "properties": Value::Object(map)})
}

/// Build the spec. `api_key_required` toggles the bearer security scheme.
pub fn openapi_spec(api_key_required: bool) -> Value {
    let mut paths = Map::new();

    paths.insert(
        "/health".into(),
        json!({"get": operation(
            "Liveness and version",
            json!({"type": "object", "properties": {
                "ok": {"type": "boolean"}, "version": {"type": "string"}
            }}),
            None,
        )}),
    );

    paths.insert(
        "/capabilities".into(),
        json!({"get": operation(
            "Which optional tools and heavy backends are available",
            json!({"type": "object", "properties": {
                "ok": {"type": "boolean"},
                "version": {"type": "string"},
                "tools": boolean_map(&["c2patool", "exiftool", "qpdf"]),
                "pixel_backends": boolean_map(&["ctrlregen", "diffusion"]),
                "scorers": boolean_map(&["synthid"]),
                "harnesses": boolean_map(&["markllm"]),
            }}),
            None,
        )}),
    );

    paths.insert(
        "/openapi.json".into(),
        json!({"get": operation(
            "This OpenAPI 3.0.3 document, generated dynamically",
            json!({"type": "object", "description": "An OpenAPI 3.0.3 document"}),
            None,
        )}),
    );

    paths.insert(
        "/inspect".into(),
        json!({"post": operation(
            "Inspect a file for AI provenance marks (text / image / container auto-routed)",
            json!({"type": "object", "properties": {
                "ok": {"type": "boolean"},
                "kind": {"type": "string", "enum": ["text", "image", "container"]},
                "suspicious": {"type": "boolean"},
                "report": {"type": "object"},
            }}),
            Some(file_request(None)),
        )}),
    );

    paths.insert(
        "/clean".into(),
        json!({"post": operation(
            "Clean a file; returns the cleaned bytes and an actions/stats report",
            json!({"type": "object", "properties": {
                "ok": {"type": "boolean"},
                "kind": {"type": "string", "enum": ["text", "image", "container"]},
                "cleaned": {"type": "string", "description": "Base64-encoded cleaned file bytes"},
                "report": {"type": "object"},
            }}),
            Some(clean_request_schema()),
        )}),
    );

    let mut spec = Map::new();
    spec.insert("openapi".into(), json!("3.0.3"));
    spec.insert(
        "info".into(),
        json!({
            "title": "watermarks-remover service",
            "version": VERSION.as_str(),
            "description": "Strip multi-vendor AI provenance marks (Unicode, C2PA/EXIF/XMP, containers). Files are passed base64-encoded in JSON; cleaned bytes come back base64-encoded.",
        }),
    );
    spec.insert("paths".into(), Value::Object(paths));
    if api_key_required {
        spec.insert(
            "components".into(),
            json!({"securitySchemes": {"bearerAuth": {"type": "http", "scheme": "bearer"}}}),
        );
        spec.insert("security".into(), json!([{"bearerAuth": []}]));
    }
    Value::Object(spec)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_spec_documents_every_served_route() {
        let spec = openapi_spec(false);
        let paths = spec["paths"].as_object().unwrap();
        for route in [
            "/health",
            "/capabilities",
            "/openapi.json",
            "/inspect",
            "/clean",
        ] {
            assert!(paths.contains_key(route), "missing {route}");
        }
        assert_eq!(spec["openapi"], "3.0.3");
    }

    #[test]
    fn post_routes_declare_a_request_body_and_get_routes_do_not() {
        let spec = openapi_spec(false);
        assert!(spec["paths"]["/inspect"]["post"]["requestBody"].is_object());
        assert!(spec["paths"]["/clean"]["post"]["requestBody"].is_object());
        assert!(spec["paths"]["/health"]["get"].get("requestBody").is_none());
    }

    #[test]
    fn every_operation_documents_the_common_errors() {
        let spec = openapi_spec(false);
        for (route, method) in [("/health", "get"), ("/inspect", "post"), ("/clean", "post")] {
            let responses = &spec["paths"][route][method]["responses"];
            for status in ["200", "400", "401", "404", "413", "500"] {
                assert!(responses.get(status).is_some(), "{route} lacks {status}");
            }
        }
    }

    #[test]
    fn the_clean_options_schema_tracks_the_allowlist() {
        let spec = openapi_spec(false);
        let options = &spec["paths"]["/clean"]["post"]["requestBody"]["content"]
            ["application/json"]["schema"]["properties"]["options"]["properties"];
        for (key, _) in ALLOWED_CLEAN_OPTIONS {
            assert!(options.get(key).is_some(), "options missing {key}");
        }
        assert_eq!(options["nfkc"]["type"], "boolean");
        assert_eq!(options["remove_pixel"]["type"], "string");
    }

    #[test]
    fn the_security_scheme_appears_only_when_a_key_is_set() {
        assert!(openapi_spec(false).get("security").is_none());
        let secured = openapi_spec(true);
        assert_eq!(secured["security"][0]["bearerAuth"], json!([]));
        assert_eq!(
            secured["components"]["securitySchemes"]["bearerAuth"]["scheme"],
            "bearer"
        );
    }
}
