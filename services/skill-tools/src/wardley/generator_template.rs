//! Static HTML/CSS/JS wrapper strings for [`super::generator::WardleyMapGenerator`],
//! split out of `generator.rs` to keep that file under the 500-line guideline.
//!
//! Ported verbatim (content-identical; not byte-identical on whitespace — see the
//! module docs on [`super::generator`]) from `_wrap_in_html`'s triple-quoted f-string
//! in `generate_wardley_map.py`, split at the `{svg}` interpolation point into a head
//! and tail half that [`super::generator::WardleyMapGenerator::wrap_in_html`]
//! concatenates around the generated `<svg>...</svg>` markup.

pub const HTML_HEAD: &str = r#"<!DOCTYPE html>
<html>
<head>
    <title>Wardley Map</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
        }
        .map-container {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            padding: 20px;
            display: inline-block;
        }
        h1 {
            color: #333;
            margin-top: 0;
        }
        .component {
            cursor: pointer;
        }
        .component:hover circle {
            r: 10;
            transition: r 0.2s;
        }
        .controls {
            margin-top: 20px;
            padding: 15px;
            background: #f9f9f9;
            border-radius: 5px;
        }
        button {
            padding: 8px 15px;
            margin-right: 10px;
            background: #4a90e2;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        button:hover {
            background: #357abd;
        }
    </style>
</head>
<body>
    <div class="map-container">
        <h1>Wardley Map</h1>
        "#;

pub const HTML_TAIL: &str = r#"
        <div class="controls">
            <button onclick="exportSVG()">Export SVG</button>
            <button onclick="exportPNG()">Export PNG</button>
            <button onclick="toggleGrid()">Toggle Grid</button>
        </div>
    </div>

    <script>
        function exportSVG() {
            const svg = document.querySelector('svg');
            const svgData = new XMLSerializer().serializeToString(svg);
            const blob = new Blob([svgData], {type: 'image/svg+xml'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'wardley-map.svg';
            a.click();
        }

        function exportPNG() {
            const svg = document.querySelector('svg');
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();

            canvas.width = svg.getAttribute('width');
            canvas.height = svg.getAttribute('height');

            const svgData = new XMLSerializer().serializeToString(svg);
            const blob = new Blob([svgData], {type: 'image/svg+xml'});
            const url = URL.createObjectURL(blob);

            img.onload = function() {
                ctx.drawImage(img, 0, 0);
                canvas.toBlob(function(blob) {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'wardley-map.png';
                    a.click();
                });
            };
            img.src = url;
        }

        function toggleGrid() {
            // Implementation for grid toggle
            console.log('Grid toggle not yet implemented');
        }
    </script>
</body>
</html>"#;
