import type { Page } from '@playwright/test';

/**
 * How much the pixels of the map canvas vary: the variance of the luminance (0..255 squared) of a
 * screenshot of the canvas. A map that is drawn (terrain, roads, cities) is far above 100; a canvas
 * that draws nothing is its flat background colour, near 0 (#617: the map turned black after the
 * replay's "View as" rebuilt the scene). The PNG is decoded by the page itself (no PNG package).
 */
export async function mapVariance(page: Page): Promise<number> {
  const png = (await page.locator('.game-canvas canvas').screenshot()).toString('base64');
  // A string: the spec has no DOM types (as replay.spec.ts does it).
  const variance = await page.evaluate(`(async () => {
    const image = new Image();
    image.src = 'data:image/png;base64,${png}';
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    let squares = 0;
    let count = 0;
    // Every 16th pixel is plenty for a picture against a flat colour.
    for (let i = 0; i < data.length; i += 64) {
      const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      count += 1;
      sum += y;
      squares += y * y;
    }
    const mean = sum / count;
    return squares / count - mean * mean;
  })()`);
  return Number(variance);
}

/** A drawn map is well above this; a blank canvas is near 0. */
export const DRAWN_MAP_VARIANCE = 100;

/**
 * The mean luminance (0..255) of each pixel column of a screenshot clip, over its rows from 30 % to
 * 70 % of its height (the middle of a frame's sides, away from its corners). For a frame drawn in
 * the clip, its left and right rules are the bright columns at its edges (#869: the tip's left rule
 * was masked away). Device pixels: at a device pixel ratio of 2 a css px is two columns.
 */
export async function columnLuminance(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
): Promise<number[]> {
  const png = (await page.screenshot({ clip })).toString('base64');
  const columns = await page.evaluate(`(async () => {
    const image = new Image();
    image.src = 'data:image/png;base64,${png}';
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const top = Math.floor(canvas.height * 0.3);
    const bottom = Math.ceil(canvas.height * 0.7);
    const out = [];
    for (let x = 0; x < canvas.width; x++) {
      let sum = 0;
      for (let y = top; y < bottom; y++) {
        const i = (y * canvas.width + x) * 4;
        sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
      out.push(sum / (bottom - top));
    }
    return out;
  })()`);
  return (columns as unknown[]).map(Number);
}
