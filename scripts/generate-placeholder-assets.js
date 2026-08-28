/**
 * Generate placeholder character art assets (pure Node.js, no external deps)
 * Creates simple colored PNGs for each body part
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { deflateSync } from "zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PARTS = [
  // Main body (pink)
  { name: "body", width: 80, height: 120, r: 255, g: 182, b: 193 },
  { name: "head", width: 70, height: 70, r: 255, g: 192, b: 203 },
  
  // Limbs (pink)
  { name: "arm_left", width: 30, height: 80, r: 255, g: 182, b: 193 },
  { name: "arm_right", width: 30, height: 80, r: 255, g: 182, b: 193 },
  { name: "leg_left", width: 36, height: 90, r: 255, g: 182, b: 193 },
  { name: "leg_right", width: 36, height: 90, r: 255, g: 182, b: 193 },
  
  // Features (hot pink)
  { name: "ear_left", width: 20, height: 30, r: 255, g: 105, b: 180 },
  { name: "ear_right", width: 20, height: 30, r: 255, g: 105, b: 180 },
  { name: "tail", width: 16, height: 60, r: 255, g: 105, b: 180 },
  
  // Face
  { name: "eye_left", width: 12, height: 12, r: 65, g: 105, b: 225 },
  { name: "eye_right", width: 12, height: 12, r: 65, g: 105, b: 225 },
  { name: "mouth", width: 20, height: 8, r: 220, g: 20, b: 60 },
];

function createPNG(config) {
  const { width, height, r, g, b } = config;
  
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type (RGB)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = createChunk("IHDR", ihdrData);
  
  // IDAT chunk (image data)
  const rawData = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const offset = y * (1 + width * 3);
    rawData[offset] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const px = offset + 1 + x * 3;
      rawData[px] = r;
      rawData[px + 1] = g;
      rawData[px + 2] = b;
    }
  }
  const compressed = deflateSync(rawData);
  const idat = createChunk("IDAT", compressed);
  
  // IEND chunk
  const iend = createChunk("IEND", Buffer.alloc(0));
  
  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  
  const typeBuffer = Buffer.from(type, "ascii");
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);
  
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function main() {
  const outputDir = join(__dirname, "..", "src", "assets", "skeleton-parts");
  
  try {
    mkdirSync(outputDir, { recursive: true });
  } catch {
    // Directory exists
  }
  
  console.log(`Generating ${PARTS.length} placeholder assets...`);
  
  for (const part of PARTS) {
    const buffer = createPNG(part);
    const filename = `${part.name}.png`;
    const filepath = join(outputDir, filename);
    writeFileSync(filepath, buffer);
    console.log(`  ✓ ${filename} (${part.width}x${part.height})`);
  }
  
  console.log(`\nAssets saved to: ${outputDir}`);
}

main();
