'use strict';

const fs = require('fs');
const path = require('path');
const { reverseGeocode } = require('./coords');

/**
 * Enrich OSM building data with LLM-generated architectural metadata.
 * If no LLM key is provided, this step is skipped entirely.
 *
 * Modifies the OSM JSON file in place, adding building:levels, building:material,
 * roof:shape, and roof:material tags to buildings that lack them.
 */
async function enrichBuildings(osmFile, bbox, options = {}, onProgress) {
  const { llmKey, llmProvider } = options;

  if (!llmKey) {
    if (onProgress) onProgress('No LLM key provided, skipping building enrichment');
    return { enriched: 0 };
  }

  if (onProgress) onProgress('Reading OSM data for building enrichment...');

  const raw = fs.readFileSync(osmFile, 'utf-8');
  const osm = JSON.parse(raw);

  // Extract buildings that need enrichment
  const buildings = (osm.elements || []).filter(
    (el) => el.tags && el.tags.building && !el.tags['building:levels']
  );

  if (buildings.length === 0) {
    if (onProgress) onProgress('No buildings need enrichment');
    return { enriched: 0 };
  }

  // Get regional context via reverse geocoding
  const centLat = (bbox[0] + bbox[2]) / 2;
  const centLng = (bbox[1] + bbox[3]) / 2;
  const region = await reverseGeocode(centLat, centLng);

  if (onProgress) onProgress(`Enriching ${buildings.length} buildings for region: ${region}`);

  // Prepare building summaries for the LLM (batch in groups of 50)
  const batchSize = 50;
  let totalEnriched = 0;

  for (let i = 0; i < buildings.length; i += batchSize) {
    const batch = buildings.slice(i, i + batchSize);
    const summaries = batch.map((b) => ({
      id: b.id,
      type: b.tags.building,
      name: b.tags.name || null,
      amenity: b.tags.amenity || null,
      shop: b.tags.shop || null,
    }));

    try {
      const enriched = await callLlm(summaries, region, llmKey, llmProvider);

      // Apply enrichments back to OSM data
      const enrichMap = new Map();
      for (const e of enriched) {
        enrichMap.set(e.id, e);
      }

      for (const building of batch) {
        const enrichment = enrichMap.get(building.id);
        if (enrichment) {
          if (enrichment.levels) building.tags['building:levels'] = String(enrichment.levels);
          if (enrichment.material) building.tags['building:material'] = enrichment.material;
          if (enrichment.roofShape) building.tags['roof:shape'] = enrichment.roofShape;
          if (enrichment.roofMaterial) building.tags['roof:material'] = enrichment.roofMaterial;
          totalEnriched++;
        }
      }
    } catch (err) {
      if (onProgress) onProgress(`LLM enrichment batch failed: ${err.message}. Continuing without.`);
    }
  }

  // Write enriched data back
  fs.writeFileSync(osmFile, JSON.stringify(osm, null, 2), 'utf-8');
  if (onProgress) onProgress(`Enriched ${totalEnriched} buildings with architectural metadata`);

  return { enriched: totalEnriched };
}

/**
 * Call the LLM API to get building enrichment data.
 */
async function callLlm(buildings, region, apiKey, provider) {
  const prompt = `You are enriching OpenStreetMap building data for Minecraft world generation.
For each building, add realistic building:levels, building:material, roof:shape, and roof:material tags based on the building type and geographic region.
Regional context: ${region}

Buildings to enrich:
${JSON.stringify(buildings, null, 2)}

Return a JSON array where each object has:
- id: the OSM element id
- levels: integer number of floors (1-50)
- material: one of brick, concrete, wood, stone, metal, glass
- roofShape: one of flat, gabled, hipped, pyramidal, dome, mansard, gambrel
- roofMaterial: one of tiles, slate, metal, thatch, concrete, asphalt

Return ONLY the JSON array, no explanation.`;

  const detectedProvider = provider || detectProvider(apiKey);

  if (detectedProvider === 'zai') {
    return callZai(prompt);
  } else if (detectedProvider === 'openai') {
    return callOpenAI(prompt, apiKey);
  } else if (detectedProvider === 'gemini') {
    return callGemini(prompt, apiKey);
  } else {
    throw new Error(`Unknown LLM provider: ${detectedProvider}`);
  }
}

function detectProvider(key) {
  if (key === 'zai-internal') return 'zai';
  if (key.startsWith('sk-')) return 'openai';
  if (key.startsWith('AI')) return 'gemini';
  return 'openai';
}

async function callZai(prompt) {
  const ZAI_URL = process.env.ZAI_URL || 'http://localhost:9600';
  const resp = await fetch(`${ZAI_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, timeout: 30000 }),
  });

  if (!resp.ok) throw new Error(`Z.AI API error: ${resp.status}`);
  const data = await resp.json();
  const text = (data.response || data.text || '').trim();
  return parseJsonResponse(text);
}

async function callOpenAI(prompt, apiKey) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 4096,
    }),
  });

  if (!resp.ok) throw new Error(`OpenAI API error: ${resp.status}`);
  const data = await resp.json();
  const text = data.choices[0].message.content.trim();
  return parseJsonResponse(text);
}

async function callGemini(prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
    }),
  });

  if (!resp.ok) throw new Error(`Gemini API error: ${resp.status}`);
  const data = await resp.json();
  const text = data.candidates[0].content.parts[0].text.trim();
  return parseJsonResponse(text);
}

function parseJsonResponse(text) {
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  return JSON.parse(cleaned);
}

module.exports = { enrichBuildings };
