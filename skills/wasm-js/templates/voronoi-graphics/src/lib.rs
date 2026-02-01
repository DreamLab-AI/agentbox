//! Voronoi/Delaunay Graphics WASM Module
//!
//! High-performance computational geometry for web graphics.
//! Uses golden ratio (φ) seed placement with Vogel's model.
//!
//! # Architecture
//! - WASM handles all mathematical computation
//! - Returns Float32Array for JS rendering
//! - Minimizes cross-boundary calls

use wasm_bindgen::prelude::*;
use std::f64::consts::PI;

// Golden ratio constant
const PHI: f64 = 1.618033988749895;
// Golden angle in radians: 2π × (2 - φ) ≈ 2.39996
const GOLDEN_ANGLE: f64 = 2.0 * PI * (2.0 - PHI);

/// Initialize panic hook for better error messages in browser console
#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// Point structure for internal calculations
#[derive(Clone, Copy, Debug)]
struct Point {
    x: f64,
    y: f64,
}

/// Triangle for Delaunay triangulation
#[derive(Clone, Copy, Debug)]
struct Triangle {
    p0: usize,
    p1: usize,
    p2: usize,
}

impl Triangle {
    /// Check if point is inside circumcircle of triangle
    fn circumcircle_contains(&self, points: &[Point], p: Point) -> bool {
        let a = &points[self.p0];
        let b = &points[self.p1];
        let c = &points[self.p2];

        let ax = a.x - p.x;
        let ay = a.y - p.y;
        let bx = b.x - p.x;
        let by = b.y - p.y;
        let cx = c.x - p.x;
        let cy = c.y - p.y;

        let det = (ax * ax + ay * ay) * (bx * cy - cx * by)
                - (bx * bx + by * by) * (ax * cy - cx * ay)
                + (cx * cx + cy * cy) * (ax * by - bx * ay);

        det > 0.0
    }
}

/// Edge for polygon hole detection
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct Edge {
    p0: usize,
    p1: usize,
}

impl Edge {
    fn new(a: usize, b: usize) -> Self {
        // Normalize edge direction for comparison
        if a < b { Edge { p0: a, p1: b } } else { Edge { p0: b, p1: a } }
    }
}

/// Generate seed points using golden ratio spiral (Vogel's model)
///
/// θ = n × golden_angle
/// r = c × √n (Fermat's spiral for uniform density)
#[wasm_bindgen]
pub fn generate_golden_seeds(width: f64, height: f64, count: usize) -> Vec<f64> {
    let mut result = Vec::with_capacity(count * 2);
    let center_x = width / 2.0;
    let center_y = height / 2.0;
    let max_radius = (width.min(height) / 2.0) * 0.85;

    for n in 0..count {
        let theta = (n as f64) * GOLDEN_ANGLE;
        let r = max_radius * ((n as f64) / (count as f64)).sqrt();

        let x = center_x + r * theta.cos();
        let y = center_y + r * theta.sin();

        result.push(x);
        result.push(y);
    }

    result
}

/// Compute Delaunay triangulation using Bowyer-Watson algorithm
/// Returns flat array of triangle vertex indices [t0p0, t0p1, t0p2, t1p0, ...]
#[wasm_bindgen]
pub fn compute_delaunay(points_flat: &[f64], width: f64, height: f64) -> Vec<u32> {
    let point_count = points_flat.len() / 2;
    if point_count < 3 {
        return vec![];
    }

    // Convert flat array to points
    let mut points: Vec<Point> = (0..point_count)
        .map(|i| Point {
            x: points_flat[i * 2],
            y: points_flat[i * 2 + 1],
        })
        .collect();

    // Create super triangle that contains all points
    let margin = (width.max(height)) * 3.0;
    let st0 = points.len();
    let st1 = points.len() + 1;
    let st2 = points.len() + 2;

    points.push(Point { x: -margin, y: -margin });
    points.push(Point { x: width / 2.0, y: height + margin * 2.0 });
    points.push(Point { x: width + margin, y: -margin });

    let mut triangles = vec![Triangle { p0: st0, p1: st1, p2: st2 }];

    // Bowyer-Watson algorithm
    for i in 0..point_count {
        let p = points[i];

        // Find triangles whose circumcircle contains the point
        let mut bad_triangles: Vec<usize> = Vec::new();
        for (ti, tri) in triangles.iter().enumerate() {
            if tri.circumcircle_contains(&points, p) {
                bad_triangles.push(ti);
            }
        }

        // Find polygon hole boundary
        let mut polygon: Vec<Edge> = Vec::new();
        for &ti in &bad_triangles {
            let tri = &triangles[ti];
            let edges = [
                Edge::new(tri.p0, tri.p1),
                Edge::new(tri.p1, tri.p2),
                Edge::new(tri.p2, tri.p0),
            ];

            for edge in edges {
                // Edge is on boundary if it's not shared with another bad triangle
                let shared = bad_triangles.iter().any(|&other_ti| {
                    if other_ti == ti { return false; }
                    let other = &triangles[other_ti];
                    let other_edges = [
                        Edge::new(other.p0, other.p1),
                        Edge::new(other.p1, other.p2),
                        Edge::new(other.p2, other.p0),
                    ];
                    other_edges.contains(&edge)
                });

                if !shared {
                    polygon.push(edge);
                }
            }
        }

        // Remove bad triangles (in reverse order to preserve indices)
        bad_triangles.sort_by(|a, b| b.cmp(a));
        for ti in bad_triangles {
            triangles.swap_remove(ti);
        }

        // Re-triangulate polygon hole
        for edge in polygon {
            triangles.push(Triangle { p0: edge.p0, p1: edge.p1, p2: i });
        }
    }

    // Remove triangles that contain super triangle vertices
    triangles.retain(|tri| {
        tri.p0 < point_count && tri.p1 < point_count && tri.p2 < point_count
    });

    // Convert to flat array
    let mut result = Vec::with_capacity(triangles.len() * 3);
    for tri in triangles {
        result.push(tri.p0 as u32);
        result.push(tri.p1 as u32);
        result.push(tri.p2 as u32);
    }

    result
}

/// Compute edges from Delaunay triangulation (for rendering)
/// Returns flat array of edge endpoint coordinates [x0, y0, x1, y1, ...]
#[wasm_bindgen]
pub fn compute_edges(points_flat: &[f64], triangles: &[u32]) -> Vec<f64> {
    use std::collections::HashSet;

    let mut edges: HashSet<(u32, u32)> = HashSet::new();

    // Extract unique edges from triangles
    for i in (0..triangles.len()).step_by(3) {
        let p0 = triangles[i];
        let p1 = triangles[i + 1];
        let p2 = triangles[i + 2];

        // Normalize edge direction
        edges.insert(if p0 < p1 { (p0, p1) } else { (p1, p0) });
        edges.insert(if p1 < p2 { (p1, p2) } else { (p2, p1) });
        edges.insert(if p2 < p0 { (p2, p0) } else { (p0, p2) });
    }

    // Convert to coordinate pairs
    let mut result = Vec::with_capacity(edges.len() * 4);
    for (p0, p1) in edges {
        let i0 = p0 as usize;
        let i1 = p1 as usize;
        result.push(points_flat[i0 * 2]);
        result.push(points_flat[i0 * 2 + 1]);
        result.push(points_flat[i1 * 2]);
        result.push(points_flat[i1 * 2 + 1]);
    }

    result
}

/// Simple 2D simplex noise for organic animation
/// Returns value in range [-1, 1]
#[wasm_bindgen]
pub fn simplex_noise_2d(x: f64, y: f64) -> f64 {
    // Skew and unskew factors for 2D
    const F2: f64 = 0.5 * (1.732050808 - 1.0); // (sqrt(3) - 1) / 2
    const G2: f64 = (3.0 - 1.732050808) / 6.0; // (3 - sqrt(3)) / 6

    // Skew input space
    let s = (x + y) * F2;
    let i = (x + s).floor();
    let j = (y + s).floor();

    // Unskew to get (x, y) distances from cell origin
    let t = (i + j) * G2;
    let x0 = x - (i - t);
    let y0 = y - (j - t);

    // Determine which simplex we're in
    let (i1, j1) = if x0 > y0 { (1.0, 0.0) } else { (0.0, 1.0) };

    let x1 = x0 - i1 + G2;
    let y1 = y0 - j1 + G2;
    let x2 = x0 - 1.0 + 2.0 * G2;
    let y2 = y0 - 1.0 + 2.0 * G2;

    // Hash coordinates to get gradient indices
    let ii = (i as i32) & 255;
    let jj = (j as i32) & 255;

    // Simple hash function
    let hash = |x: i32, y: i32| -> usize {
        let h = ((x.wrapping_mul(374761393) ^ y.wrapping_mul(668265263)) as u32) as usize;
        h % 12
    };

    // Gradient vectors for 2D
    let grad = |h: usize, x: f64, y: f64| -> f64 {
        let gradients: [(f64, f64); 12] = [
            (1.0, 1.0), (-1.0, 1.0), (1.0, -1.0), (-1.0, -1.0),
            (1.0, 0.0), (-1.0, 0.0), (1.0, 0.0), (-1.0, 0.0),
            (0.0, 1.0), (0.0, -1.0), (0.0, 1.0), (0.0, -1.0),
        ];
        let (gx, gy) = gradients[h];
        gx * x + gy * y
    };

    // Calculate contribution from three corners
    let mut n0 = 0.0;
    let mut t0 = 0.5 - x0 * x0 - y0 * y0;
    if t0 >= 0.0 {
        t0 *= t0;
        n0 = t0 * t0 * grad(hash(ii, jj), x0, y0);
    }

    let mut n1 = 0.0;
    let mut t1 = 0.5 - x1 * x1 - y1 * y1;
    if t1 >= 0.0 {
        t1 *= t1;
        n1 = t1 * t1 * grad(hash(ii + i1 as i32, jj + j1 as i32), x1, y1);
    }

    let mut n2 = 0.0;
    let mut t2 = 0.5 - x2 * x2 - y2 * y2;
    if t2 >= 0.0 {
        t2 *= t2;
        n2 = t2 * t2 * grad(hash(ii + 1, jj + 1), x2, y2);
    }

    // Scale to [-1, 1]
    70.0 * (n0 + n1 + n2)
}

/// Batch update mote positions along edges
/// Input: motes [edgeIdx, progress, speed, ...], edges [x0, y0, x1, y1, ...]
/// Output: positions [x, y, brightness, ...]
#[wasm_bindgen]
pub fn update_motes(
    motes: &mut [f64],
    edges: &[f64],
    dt: f64,
    time: f64,
) -> Vec<f64> {
    let mote_count = motes.len() / 3; // [edgeIdx, progress, speed] per mote
    let edge_count = edges.len() / 4; // [x0, y0, x1, y1] per edge
    let mut positions = Vec::with_capacity(mote_count * 3);

    for i in 0..mote_count {
        let base = i * 3;
        let edge_idx = motes[base] as usize;
        let progress = motes[base + 1];
        let speed = motes[base + 2];

        // Update progress
        let new_progress = progress + speed * dt;
        motes[base + 1] = if new_progress > 1.0 {
            // Jump to random edge
            motes[base] = ((edge_idx + 7) % edge_count) as f64; // Simple deterministic "random"
            0.0
        } else {
            new_progress
        };

        // Calculate position on edge
        if edge_idx < edge_count {
            let edge_base = edge_idx * 4;
            let x0 = edges[edge_base];
            let y0 = edges[edge_base + 1];
            let x1 = edges[edge_base + 2];
            let y1 = edges[edge_base + 3];

            let p = motes[base + 1];
            let x = x0 + (x1 - x0) * p;
            let y = y0 + (y1 - y0) * p;

            // Pulsing brightness
            let brightness = 0.5 + 0.5 * (time * 2.0 + (i as f64) * 0.5).sin();

            positions.push(x);
            positions.push(y);
            positions.push(brightness);
        }
    }

    positions
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_golden_seeds() {
        let seeds = generate_golden_seeds(800.0, 600.0, 10);
        assert_eq!(seeds.len(), 20); // 10 points * 2 coordinates
    }

    #[test]
    fn test_delaunay() {
        let points = vec![
            0.0, 0.0,
            100.0, 0.0,
            50.0, 100.0,
        ];
        let triangles = compute_delaunay(&points, 100.0, 100.0);
        assert_eq!(triangles.len(), 3); // One triangle
    }

    #[test]
    fn test_simplex_noise() {
        let n1 = simplex_noise_2d(0.0, 0.0);
        let n2 = simplex_noise_2d(0.5, 0.5);
        assert!(n1 >= -1.0 && n1 <= 1.0);
        assert!(n2 >= -1.0 && n2 <= 1.0);
        assert!((n1 - n2).abs() > 0.0); // Different inputs should produce different outputs
    }
}
