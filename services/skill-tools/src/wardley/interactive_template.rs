//! Static HTML/CSS/D3.js template strings for
//! [`super::interactive::InteractiveMapGenerator`], split out of `interactive.rs` to
//! keep that file under the 500-line guideline.
//!
//! Ported from `_generate_d3_html`'s triple-quoted f-string in
//! `interactive_map_generator.py`, split at the `{json.dumps(...)}` interpolation
//! point into a head and tail half. Python f-string `{{`/`}}` escapes for literal CSS
//! braces become plain single braces here since this is a Rust raw string, not an
//! f-string. See [`super::interactive`]'s module docs for the one substantive fix
//! applied at the split point: the Python original wrapped the JSON data in a
//! spurious extra pair of braces (`{{{json.dumps(...)}}}` -> literal `{` + JSON + `}`)
//! producing invalid JavaScript; this template instead expects
//! [`super::interactive::InteractiveMapGenerator`] to insert exactly one JSON object
//! between [`HTML_HEAD`] and [`HTML_TAIL`], with no extra braces on either side.

pub const HTML_HEAD: &str = r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Interactive Wardley Map</title>
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: #f5f5f5;
        }

        #container {
            width: 100%;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }

        #header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        h1 {
            font-size: 24px;
            margin-bottom: 8px;
        }

        #controls {
            padding: 15px 20px;
            background: white;
            border-bottom: 1px solid #e0e0e0;
            display: flex;
            gap: 20px;
            align-items: center;
            flex-wrap: wrap;
        }

        .control-group {
            display: flex;
            gap: 10px;
            align-items: center;
        }

        label {
            font-weight: 600;
            color: #333;
        }

        input, select {
            padding: 8px 12px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
        }

        button {
            padding: 8px 16px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
            transition: background 0.2s;
        }

        button:hover {
            background: #764ba2;
        }

        #canvas {
            flex: 1;
            background: white;
            position: relative;
            overflow: hidden;
        }

        svg {
            width: 100%;
            height: 100%;
        }

        .evolution-stage {
            fill-opacity: 0.05;
            pointer-events: none;
        }

        .stage-label {
            font-size: 14px;
            fill: #999;
            pointer-events: none;
            text-anchor: middle;
        }

        .axis-label {
            font-size: 12px;
            fill: #666;
            pointer-events: none;
        }

        .axis-line {
            stroke: #ccc;
            stroke-width: 2;
            stroke-dasharray: 5,5;
        }

        .component {
            cursor: pointer;
            transition: all 0.2s;
        }

        .component-circle {
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
        }

        .component:hover .component-circle {
            filter: drop-shadow(0 4px 8px rgba(0,0,0,0.2));
            r: 20;
        }

        .component-label {
            font-size: 12px;
            text-anchor: middle;
            pointer-events: none;
            font-weight: 600;
            fill: #333;
        }

        .link {
            stroke: #999;
            stroke-opacity: 0.6;
            stroke-width: 2;
            marker-end: url(#arrowhead);
        }

        .link.strength {
            stroke: #ff6b6b;
            stroke-width: 3;
        }

        .link.weak {
            stroke: #95a5a6;
            stroke-dasharray: 5,5;
        }

        .component.strength .component-circle {
            fill: #51cf66;
            stroke: #2f9e44;
            stroke-width: 3;
        }

        .component.vulnerability .component-circle {
            fill: #ff8787;
            stroke: #d32f2f;
            stroke-width: 3;
        }

        .component.opportunity .component-circle {
            fill: #ffd93d;
            stroke: #f9a825;
            stroke-width: 3;
        }

        .component.threat .component-circle {
            fill: #ff922b;
            stroke: #d9480f;
            stroke-width: 3;
        }

        .component.default .component-circle {
            fill: #667eea;
            stroke: #764ba2;
            stroke-width: 2;
        }

        .tooltip {
            position: absolute;
            background: white;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1000;
            max-width: 300px;
            font-size: 12px;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s;
        }

        .tooltip.show {
            opacity: 1;
        }

        .tooltip-title {
            font-weight: 600;
            color: #333;
            margin-bottom: 6px;
            font-size: 13px;
        }

        .tooltip-item {
            margin-bottom: 4px;
            color: #666;
        }

        .legend {
            position: absolute;
            bottom: 20px;
            right: 20px;
            background: white;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 15px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            font-size: 12px;
        }

        .legend-item {
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .legend-color {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            border: 2px solid;
        }

        #instructions {
            position: absolute;
            top: 20px;
            left: 20px;
            background: white;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 15px;
            font-size: 12px;
            max-width: 250px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            z-index: 999;
        }

        .info-panel {
            position: absolute;
            top: 20px;
            right: 20px;
            background: white;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 15px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            max-width: 350px;
            font-size: 12px;
            z-index: 999;
            max-height: 300px;
            overflow-y: auto;
        }
    </style>
</head>
<body>
    <div id="container">
        <div id="header">
            <h1>Interactive Wardley Map</h1>
            <p>Visualizing organizational evolution and strategic positioning</p>
        </div>

        <div id="controls">
            <div class="control-group">
                <label>Filter by Evolution Stage:</label>
                <select id="stageFilter">
                    <option value="">All Stages</option>
                    <option value="Genesis">Genesis</option>
                    <option value="Custom">Custom</option>
                    <option value="Product">Product</option>
                    <option value="Commodity">Commodity</option>
                </select>
            </div>

            <div class="control-group">
                <label>Filter by Insight Type:</label>
                <select id="insightFilter">
                    <option value="">All Components</option>
                    <option value="strength">Strengths</option>
                    <option value="vulnerability">Vulnerabilities</option>
                    <option value="opportunity">Opportunities</option>
                    <option value="threat">Threats</option>
                </select>
            </div>

            <button id="resetZoom">Reset Zoom</button>
            <button id="toggleGrid">Toggle Grid</button>
        </div>

        <div id="canvas">
            <div id="instructions">
                <strong>Controls:</strong><br>
                • Scroll: Zoom<br>
                • Drag: Pan<br>
                • Click: Select component<br>
                • Hover: Details
            </div>

            <div id="infoPanel" class="info-panel" style="display: none;"></div>

            <svg></svg>

            <div class="tooltip"></div>

            <div class="legend">
                <div class="legend-item">
                    <div class="legend-color" style="background: #667eea; border-color: #764ba2;"></div>
                    <span>Component</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background: #51cf66; border-color: #2f9e44;"></div>
                    <span>Strength</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background: #ff8787; border-color: #d32f2f;"></div>
                    <span>Vulnerability</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background: #ffd93d; border-color: #f9a825;"></div>
                    <span>Opportunity</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background: #ff922b; border-color: #d9480f;"></div>
                    <span>Threat</span>
                </div>
            </div>
        </div>
    </div>

    <script>
        const data = "#;
