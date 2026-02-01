/**
 * React Integration Example for WASM Voronoi Graphics
 *
 * This template demonstrates the hybrid JS/WASM architecture:
 * - JS handles: DOM, Canvas context, requestAnimationFrame, React lifecycle
 * - WASM handles: Computational geometry, noise generation, mote physics
 */

import { useEffect, useRef, useState, useCallback } from 'react';

// Types for WASM module exports
interface VoronoiWasm {
  generate_golden_seeds(width: number, height: number, count: number): Float64Array;
  compute_delaunay(points: Float64Array, width: number, height: number): Uint32Array;
  compute_edges(points: Float64Array, triangles: Uint32Array): Float64Array;
  simplex_noise_2d(x: number, y: number): number;
  update_motes(motes: Float64Array, edges: Float64Array, dt: number, time: number): Float64Array;
}

interface VoronoiProps {
  seedCount?: number;
  width?: number;
  height?: number;
  className?: string;
}

export const VoronoiGraphics: React.FC<VoronoiProps> = ({
  seedCount = 80,
  width,
  height,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wasmRef = useRef<VoronoiWasm | null>(null);
  const animationRef = useRef<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cached computed data
  const dataRef = useRef<{
    points: Float64Array | null;
    edges: Float64Array | null;
    motes: Float64Array | null;
  }>({
    points: null,
    edges: null,
    motes: null,
  });

  // Load WASM module
  useEffect(() => {
    let mounted = true;

    const loadWasm = async () => {
      try {
        // Dynamic import of WASM module
        const wasm = await import('./pkg/voronoi_graphics');
        await wasm.default(); // Initialize WASM

        if (mounted) {
          wasmRef.current = wasm;
          setIsLoading(false);
        }
      } catch (err) {
        if (mounted) {
          console.error('Failed to load WASM module:', err);
          setError('Failed to load graphics module');
          setIsLoading(false);
        }
      }
    };

    loadWasm();

    return () => {
      mounted = false;
    };
  }, []);

  // Initialize geometry when WASM is ready
  const initializeGeometry = useCallback((w: number, h: number) => {
    const wasm = wasmRef.current;
    if (!wasm) return;

    // Generate golden ratio seeds
    const points = wasm.generate_golden_seeds(w, h, seedCount);

    // Compute Delaunay triangulation
    const triangles = wasm.compute_delaunay(points, w, h);

    // Extract edges for rendering
    const edges = wasm.compute_edges(points, triangles);

    // Initialize motes (edgeIdx, progress, speed)
    const moteCount = Math.floor(edges.length / 16); // One mote per ~4 edges
    const motes = new Float64Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      const base = i * 3;
      motes[base] = Math.floor(Math.random() * (edges.length / 4)); // Random edge
      motes[base + 1] = Math.random(); // Random progress
      motes[base + 2] = 0.1 + Math.random() * 0.2; // Speed variation
    }

    dataRef.current = { points, edges, motes };
  }, [seedCount]);

  // Render loop
  const render = useCallback((time: number) => {
    const canvas = canvasRef.current;
    const wasm = wasmRef.current;
    const data = dataRef.current;

    if (!canvas || !wasm || !data.edges || !data.motes) {
      animationRef.current = requestAnimationFrame(render);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { edges, motes, points } = data;
    const w = canvas.width;
    const h = canvas.height;

    // Clear
    ctx.fillStyle = '#0e0e11';
    ctx.fillRect(0, 0, w, h);

    // Draw Delaunay edges
    ctx.strokeStyle = 'rgba(205, 127, 50, 0.3)'; // Bronze
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < edges.length; i += 4) {
      ctx.moveTo(edges[i], edges[i + 1]);
      ctx.lineTo(edges[i + 2], edges[i + 3]);
    }
    ctx.stroke();

    // Draw seed points
    if (points) {
      ctx.fillStyle = 'rgba(212, 165, 116, 0.4)'; // Gold
      for (let i = 0; i < points.length; i += 2) {
        ctx.beginPath();
        ctx.arc(points[i], points[i + 1], 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Update and draw motes (WASM computation)
    const dt = 0.016; // ~60fps
    const positions = wasm.update_motes(motes, edges, dt, time / 1000);

    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const brightness = positions[i + 2];

      // Draw mote with glow
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, 8);
      gradient.addColorStop(0, `rgba(255, 215, 0, ${brightness})`);
      gradient.addColorStop(0.5, `rgba(255, 215, 0, ${brightness * 0.3})`);
      gradient.addColorStop(1, 'rgba(255, 215, 0, 0)');

      ctx.fillStyle = gradient;
      ctx.fillRect(x - 8, y - 8, 16, 16);
    }

    // Mist fade effect (outer 30%)
    const mistGradient = ctx.createRadialGradient(
      w / 2, h / 2, Math.min(w, h) * 0.35,
      w / 2, h / 2, Math.min(w, h) * 0.55
    );
    mistGradient.addColorStop(0, 'rgba(14, 14, 17, 0)');
    mistGradient.addColorStop(0.5, 'rgba(14, 14, 17, 0.4)');
    mistGradient.addColorStop(0.8, 'rgba(14, 14, 17, 0.75)');
    mistGradient.addColorStop(1, 'rgba(14, 14, 17, 0.95)');
    ctx.fillStyle = mistGradient;
    ctx.fillRect(0, 0, w, h);

    animationRef.current = requestAnimationFrame(render);
  }, []);

  // Setup canvas and start animation
  useEffect(() => {
    if (isLoading || error) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Handle resize
    const resizeObserver = new ResizeObserver((entries) => {
      const { width: w, height: h } = entries[0].contentRect;
      canvas.width = w;
      canvas.height = h;
      initializeGeometry(w, h);
    });

    resizeObserver.observe(canvas.parentElement || canvas);

    // Initial setup
    const rect = canvas.getBoundingClientRect();
    canvas.width = width || rect.width || 800;
    canvas.height = height || rect.height || 600;
    initializeGeometry(canvas.width, canvas.height);

    // Start animation
    animationRef.current = requestAnimationFrame(render);

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(animationRef.current);
    };
  }, [isLoading, error, width, height, initializeGeometry, render]);

  if (error) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-full ${className}`}
      style={{ display: isLoading ? 'none' : 'block' }}
    />
  );
};

export default VoronoiGraphics;
