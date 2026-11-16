const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 576;

/**
 * Separable 1D Gaussian blur on a Float32Array (width x height).
 */
function gaussianBlur(src, width, height, sigma) {
    if (sigma <= 0.1) return new Float32Array(src);

    const radius = Math.min(Math.ceil(sigma * 3), 90);
    const kernel = new Float32Array(radius * 2 + 1);
    let sum = 0;
    const invTwoSigmaSq = 1 / (2 * sigma * sigma);

    for (let i = -radius; i <= radius; i++) {
        const w = Math.exp(-(i * i) * invTwoSigmaSq);
        kernel[i + radius] = w;
        sum += w;
    }
    for (let i = 0; i < kernel.length; i++) {
        kernel[i] /= sum;
    }

    const temp = new Float32Array(width * height);
    const dst = new Float32Array(width * height);

    // Horizontal pass
    for (let y = 0; y < height; y++) {
        const rowOffset = y * width;
        for (let x = 0; x < width; x++) {
            let acc = 0;
            for (let k = -radius; k <= radius; k++) {
                const sx = Math.min(width - 1, Math.max(0, x + k));
                acc += src[rowOffset + sx] * kernel[k + radius];
            }
            temp[rowOffset + x] = acc;
        }
    }

    // Vertical pass
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let acc = 0;
            for (let k = -radius; k <= radius; k++) {
                const sy = Math.min(height - 1, Math.max(0, y + k));
                acc += temp[sy * width + x] * kernel[k + radius];
            }
            dst[y * width + x] = acc;
        }
    }

    return dst;
}

/**
 * Fast 2-pass Euclidean-approximated distance transform (in pixels)
 * from pixels where mask >= 0.5.
 */
function computeDistanceField(mask, width, height) {
    const total = width * height;
    const dist = new Float32Array(total);
    const INF = 1e6;

    for (let i = 0; i < total; i++) {
        dist[i] = mask[i] >= 0.5 ? 0 : INF;
    }

    const SQRT2 = 1.41421356;

    // Forward pass (top-left to bottom-right)
    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
            const i = row + x;
            let d = dist[i];
            if (d === 0) continue;
            if (x > 0) d = Math.min(d, dist[i - 1] + 1);
            if (y > 0) {
                d = Math.min(d, dist[i - width] + 1);
                if (x > 0) d = Math.min(d, dist[i - width - 1] + SQRT2);
                if (x < width - 1) d = Math.min(d, dist[i - width + 1] + SQRT2);
            }
            dist[i] = d;
        }
    }

    // Backward pass (bottom-right to top-left)
    for (let y = height - 1; y >= 0; y--) {
        const row = y * width;
        for (let x = width - 1; x >= 0; x--) {
            const i = row + x;
            let d = dist[i];
            if (d === 0) continue;
            if (x < width - 1) d = Math.min(d, dist[i + 1] + 1);
            if (y < height - 1) {
                d = Math.min(d, dist[i + width] + 1);
                if (x > 0) d = Math.min(d, dist[i + width - 1] + SQRT2);
                if (x < width - 1) d = Math.min(d, dist[i + width + 1] + SQRT2);
            }
            dist[i] = d;
        }
    }

    return dist;
}

/**
 * Converts a 0..1 Float32Array shape mask into the 4-channel RGBA data texture
 * matching original logo.png encoding:
 *   R, G = 0.5 + 0.5 * tanh(K * grad(B))  (un-normalized smooth gradient -> no emboss ridge!)
 *   B    = clean gradient inside letters + smooth Gaussian-like distance halo outside
 *   A    = diagonal gradient mask (or solid if gradientStrength == 0)
 */
export function buildLogoDataTexture(mask, width, height, options = {}) {
    const {
        blurSigma = 14,
        gradientStrength = 1.0,
    } = options;

    const total = width * height;
    const alphaField = new Float32Array(total);
    const gradField = new Float32Array(total);

    for (let y = 0; y < height; y++) {
        const ny = y / height;
        for (let x = 0; x < width; x++) {
            const nx = x / width;
            const i = y * width + x;

            // Matches the diagonal gradient observed in original logo.png
            const diagGrad = Math.min(0.98, Math.max(0.08, 0.92 * nx - 0.74 * ny + 0.46));
            const grad = 1.0 - gradientStrength + gradientStrength * diagGrad;
            gradField[i] = grad;
            alphaField[i] = mask[i] * grad;
        }
    }

    // Distance-based halo for B: flat & clean inside letters (B == A), smooth decay outside
    const dist = computeDistanceField(mask, width, height);
    const blueField = new Float32Array(total);
    const invTwoSigmaSq = 1 / (2 * Math.max(1, blurSigma) * Math.max(1, blurSigma));

    for (let i = 0; i < total; i++) {
        if (mask[i] >= 0.5) {
            blueField[i] = alphaField[i];
        } else {
            const d = dist[i];
            const falloff = Math.exp(-(d * d) * invTwoSigmaSq);
            blueField[i] = Math.max(alphaField[i], falloff * gradField[i]);
        }
    }

    // Smooth blueField before taking un-normalized gradient so R/G have no sharp edges or emboss ridge
    const gradSource = gaussianBlur(blueField, width, height, Math.max(6, blurSigma * 0.8));
    const gradScale = Math.max(10, blurSigma * 1.4);

    const rgba = new Uint8Array(total * 4);
    for (let y = 0; y < height; y++) {
        const ym = Math.max(0, y - 1);
        const yp = Math.min(height - 1, y + 1);
        for (let x = 0; x < width; x++) {
            const xm = Math.max(0, x - 1);
            const xp = Math.min(width - 1, x + 1);
            const i = y * width + x;

            const gx = (gradSource[y * width + xp] - gradSource[y * width + xm]) * 0.5;
            const gy = -(gradSource[yp * width + x] - gradSource[ym * width + x]) * 0.5;

            const nx = Math.tanh(gx * gradScale);
            const ny = Math.tanh(gy * gradScale);

            const p = i * 4;
            rgba[p + 0] = Math.min(255, Math.max(0, Math.round((0.5 + 0.5 * nx) * 255)));
            rgba[p + 1] = Math.min(255, Math.max(0, Math.round((0.5 + 0.5 * ny) * 255)));
            rgba[p + 2] = Math.min(255, Math.max(0, Math.round(blueField[i] * 255)));
            rgba[p + 3] = Math.min(255, Math.max(0, Math.round(alphaField[i] * 255)));
        }
    }

    return { data: rgba, width, height, ratio: width / height };
}

/**
 * Extracts a 0..1 mask from a 2D canvas.
 * If the image is mostly opaque (no transparent background), uses luminance contrast against corners.
 */
function extractMaskFromCanvas(ctx, width, height) {
    const imgData = ctx.getImageData(0, 0, width, height).data;
    const total = width * height;
    const mask = new Float32Array(total);

    let minAlpha = 255;
    for (let i = 0; i < total; i++) {
        const a = imgData[i * 4 + 3];
        if (a < minAlpha) minAlpha = a;
    }

    if (minAlpha < 250) {
        for (let i = 0; i < total; i++) {
            mask[i] = imgData[i * 4 + 3] / 255;
        }
        return mask;
    }

    // Fallback for opaque images (e.g. white text on black or black text on white)
    const bgR = imgData[0];
    const bgG = imgData[1];
    const bgB = imgData[2];
    const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;

    for (let i = 0; i < total; i++) {
        const p = i * 4;
        const lum = 0.299 * imgData[p] + 0.587 * imgData[p + 1] + 0.114 * imgData[p + 2];
        const diff = Math.abs(lum - bgLum) / 255;
        mask[i] = Math.min(1, Math.max(0, (diff - 0.05) / 0.85));
    }
    return mask;
}

/**
 * Generates a logo data texture from text using NouvelleGrotesquerie font.
 */
export async function generateLogoFromText(text, options = {}) {
    const width = DEFAULT_WIDTH;
    const height = DEFAULT_HEIGHT;
    const cleanText = (text || 'Grok').trim() || 'Grok';

    try {
        await document.fonts.load('400 200px "NouvelleGrotesquerie"');
        await document.fonts.ready;
    } catch {
        // Proceed even if font check throws
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Auto-fit font size inside safe padded bounds
    const maxTextWidth = width * 0.82;
    const maxTextHeight = height * 0.62;
    let fontSize = 360;
    ctx.font = `${fontSize}px "NouvelleGrotesquerie", sans-serif`;
    const metrics = ctx.measureText(cleanText);
    if (metrics.width > maxTextWidth) {
        fontSize = Math.floor(fontSize * (maxTextWidth / metrics.width));
    }
    fontSize = Math.min(fontSize, Math.floor(maxTextHeight));
    fontSize = Math.max(fontSize, 24);

    ctx.font = `${fontSize}px "NouvelleGrotesquerie", sans-serif`;
    ctx.fillText(cleanText, width / 2, height / 2);

    const mask = extractMaskFromCanvas(ctx, width, height);
    return buildLogoDataTexture(mask, width, height, options);
}

/**
 * Generates a logo data texture from an uploaded SVG or PNG/Image File.
 */
export async function generateLogoFromFile(file, options = {}) {
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('Failed to load image file'));
            image.src = url;
        });

        const width = DEFAULT_WIDTH;
        const height = DEFAULT_HEIGHT;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, width, height);

        const padX = width * 0.1;
        const padY = height * 0.14;
        const availW = width - padX * 2;
        const availH = height - padY * 2;
        const imgW = img.naturalWidth || img.width || availW;
        const imgH = img.naturalHeight || img.height || availH;
        const fitScale = Math.min(availW / imgW, availH / imgH);
        const drawW = imgW * fitScale;
        const drawH = imgH * fitScale;
        const drawX = (width - drawW) / 2;
        const drawY = (height - drawH) / 2;

        ctx.drawImage(img, drawX, drawY, drawW, drawH);

        const mask = extractMaskFromCanvas(ctx, width, height);
        return buildLogoDataTexture(mask, width, height, options);
    } finally {
        URL.revokeObjectURL(url);
    }
}

/**
 * Triggers a PNG download of the generated 4-channel RGBA data texture.
 */
export function downloadLogoPng(rgbaData, width, height, filename = 'logo.png') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = new ImageData(new Uint8ClampedArray(rgbaData), width, height);
    ctx.putImageData(imageData, 0, 0);

    canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }, 'image/png');
}
