const GRID_W = 96;
const GRID_H = 54;

/**
 * Real-time TouchDesigner-style Blob Tracker.
 * Samples the rendered WebGL canvas + dynamic logo mask modulation,
 * runs fast connected-component labeling, matches blob IDs across frames,
 * and draws crisp HUD bounding boxes, corner brackets, plexus lines, and labels.
 */
export class BlobTracker {
    constructor(overlayCanvas) {
        this.overlay = overlayCanvas;
        this.ctx = overlayCanvas.getContext('2d');

        this.sampleCanvas = document.createElement('canvas');
        this.sampleCanvas.width = GRID_W;
        this.sampleCanvas.height = GRID_H;
        this.sampleCtx = this.sampleCanvas.getContext('2d', { willReadFrequently: true });

        this.field = new Float32Array(GRID_W * GRID_H);
        this.visited = new Uint8Array(GRID_W * GRID_H);
        this.queue = new Int32Array(GRID_W * GRID_H);

        this.trackedBlobs = [];
        this.nextBlobId = 1;
        this.logoMaskGrid = null;
        this.lastSampleTime = 0;
    }

    setLogoMask(rgbaData, width, height) {
        if (!rgbaData || !width || !height) {
            this.logoMaskGrid = null;
            return;
        }
        const grid = new Float32Array(GRID_W * GRID_H);
        for (let gy = 0; gy < GRID_H; gy++) {
            const sy = Math.min(height - 1, Math.floor((gy / GRID_H) * height));
            for (let gx = 0; gx < GRID_W; gx++) {
                const sx = Math.min(width - 1, Math.floor((gx / GRID_W) * width));
                const idx = (sy * width + sx) * 4;
                const b = rgbaData[idx + 2] / 255;
                const a = rgbaData[idx + 3] / 255;
                grid[gy * GRID_W + gx] = Math.max(a, b * 0.75);
            }
        }
        this.logoMaskGrid = grid;
    }

    updateAndDraw(glCanvas, time, logoScale, logoRatio, settings) {
        const {
            blobEnabled = true,
            blobStyle = 'Corner Brackets',
            blobThreshold = 0.34,
            blobMaxCount = 18,
            blobMaxSize = 140,
            blobLogoDynamic = 1.0,
            blobConnectLines = true,
            blobConnectMode = 'All Blobs',
            blobLinkDistance = 220,
            blobShowLabels = true,
            blobShowTrails = true,
            blobColor = '#d8f3ff',
            blobUpdateMs = 33,
            lightTheme = false,
        } = settings;

        const w = this.overlay.width;
        const h = this.overlay.height;
        this.ctx.clearRect(0, 0, w, h);

        if (!blobEnabled || w === 0 || h === 0) {
            this.trackedBlobs = [];
            return;
        }

        const now = performance.now();
        if (now - this.lastSampleTime < blobUpdateMs && this.trackedBlobs.length > 0) {
            this.drawOverlay(w, h, {
                blobStyle,
                blobConnectLines,
                blobConnectMode,
                blobLinkDistance,
                blobShowLabels,
                blobShowTrails,
                blobColor,
            });
            return;
        }
        this.lastSampleTime = now;

        // 1. Downsample WebGL canvas to 96x54
        this.sampleCtx.drawImage(glCanvas, 0, 0, GRID_W, GRID_H);
        const img = this.sampleCtx.getImageData(0, 0, GRID_W, GRID_H).data;

        const ratioX = Math.min(h / w, 1);
        const ratioY = Math.min(w / h, 1);
        const scaleX = Math.max(logoScale, 1 - logoRatio / 4) * ratioX * logoRatio;
        const scaleY = Math.max(logoScale, 1 - logoRatio / 4) * ratioY;

        for (let gy = 0; gy < GRID_H; gy++) {
            const v = 1 - gy / (GRID_H - 1);
            for (let gx = 0; gx < GRID_W; gx++) {
                const u = gx / (GRID_W - 1);
                const i = gy * GRID_W + gx;
                const p = i * 4;

                const r = img[p] / 255;
                const g = img[p + 1] / 255;
                const b = img[p + 2] / 255;
                let lum = 0.299 * r + 0.587 * g + 0.114 * b;
                if (lightTheme) {
                    lum = 1.0 - lum;
                }

                if (blobLogoDynamic > 0) {
                    const lu = 0.5 + (u - 0.5) / Math.max(0.05, scaleX);
                    const lv = 0.5 + (v - 0.5) / Math.max(0.05, scaleY);
                    if (lu >= 0 && lu <= 1 && lv >= 0 && lv <= 1) {
                        let logoVal = 0;
                        if (this.logoMaskGrid) {
                            const lx = Math.min(GRID_W - 1, Math.floor(lu * GRID_W));
                            const ly = Math.min(GRID_H - 1, Math.floor((1 - lv) * GRID_H));
                            logoVal = this.logoMaskGrid[ly * GRID_W + lx];
                        } else {
                            logoVal = Math.max(0, (lum - 0.45) * 1.8);
                        }

                        if (logoVal > 0.1) {
                            const wave =
                                0.5 +
                                0.5 *
                                    Math.sin(lu * 11.0 - time * 2.1 + Math.cos(lv * 7.0 + time * 1.3)) *
                                    Math.cos(lv * 9.0 + time * 1.7);
                            lum = lum * (1 - 0.55 * blobLogoDynamic) + logoVal * wave * blobLogoDynamic * 0.95;
                        }
                    }
                }

                this.field[i] = lum;
            }
        }

        // 2. Connected-component labeling (BFS) with max box size cap so smoke blobs stay medium-sized
        this.visited.fill(0);
        const rawBlobs = [];
        const maxCellsX = Math.max(2, Math.floor((blobMaxSize / w) * GRID_W));
        const maxCellsY = Math.max(2, Math.floor((blobMaxSize / h) * GRID_H));

        for (let gy = 0; gy < GRID_H; gy++) {
            for (let gx = 0; gx < GRID_W; gx++) {
                const startIdx = gy * GRID_W + gx;
                if (this.visited[startIdx] || this.field[startIdx] < blobThreshold) continue;

                let head = 0;
                let tail = 0;
                this.queue[tail++] = startIdx;
                this.visited[startIdx] = 1;

                let minX = gx;
                let maxX = gx;
                let minY = gy;
                let maxY = gy;
                let sumX = 0;
                let sumY = 0;
                let sumWeight = 0;
                let count = 0;

                while (head < tail) {
                    const curr = this.queue[head++];
                    const cy = Math.floor(curr / GRID_W);
                    const cx = curr - cy * GRID_W;
                    const weight = this.field[curr];

                    if (cx < minX) minX = cx;
                    if (cx > maxX) maxX = cx;
                    if (cy < minY) minY = cy;
                    if (cy > maxY) maxY = cy;

                    sumX += cx * weight;
                    sumY += cy * weight;
                    sumWeight += weight;
                    count++;

                    const tryPush = (n, nx, ny) => {
                        if (this.visited[n] || this.field[n] < blobThreshold) return;
                        const nextMinX = Math.min(minX, nx);
                        const nextMaxX = Math.max(maxX, nx);
                        const nextMinY = Math.min(minY, ny);
                        const nextMaxY = Math.max(maxY, ny);
                        if (nextMaxX - nextMinX >= maxCellsX || nextMaxY - nextMinY >= maxCellsY) return;
                        this.visited[n] = 1;
                        this.queue[tail++] = n;
                    };

                    if (cx > 0) tryPush(curr - 1, cx - 1, cy);
                    if (cx < GRID_W - 1) tryPush(curr + 1, cx + 1, cy);
                    if (cy > 0) tryPush(curr - GRID_W, cx, cy - 1);
                    if (cy < GRID_H - 1) tryPush(curr + GRID_W, cx, cy + 1);
                }

                if (count >= 3) {
                    const padX = 0.6;
                    const padY = 0.6;
                    const x0 = ((minX - padX) / GRID_W) * w;
                    const y0 = ((minY - padY) / GRID_H) * h;
                    const x1 = ((maxX + 1 + padX) / GRID_W) * w;
                    const y1 = ((maxY + 1 + padY) / GRID_H) * h;
                    const cx = (sumX / sumWeight / GRID_W) * w;
                    const cy = (sumY / sumWeight / GRID_H) * h;

                    rawBlobs.push({
                        x: Math.max(0, x0),
                        y: Math.max(0, y0),
                        w: Math.min(w, x1) - Math.max(0, x0),
                        h: Math.min(h, y1) - Math.max(0, y0),
                        cx,
                        cy,
                        area: count,
                    });
                }
            }
        }

        rawBlobs.sort((a, b) => b.area - a.area);
        const candidates = rawBlobs.slice(0, blobMaxCount);

        // 3. Temporal ID matching & smooth interpolation
        const nextTracked = [];
        const usedPrev = new Set();
        const maxMatchDist = Math.hypot(w, h) * 0.15;

        for (const blob of candidates) {
            let bestPrev = null;
            let bestDist = maxMatchDist;

            for (const prev of this.trackedBlobs) {
                if (usedPrev.has(prev.id)) continue;
                const d = Math.hypot(blob.cx - prev.cx, blob.cy - prev.cy);
                if (d < bestDist) {
                    bestDist = d;
                    bestPrev = prev;
                }
            }

            if (bestPrev) {
                usedPrev.add(bestPrev.id);
                const vel = Math.hypot(blob.cx - bestPrev.cx, blob.cy - bestPrev.cy);
                const trail = bestPrev.trail
                    ? [...bestPrev.trail, { x: blob.cx, y: blob.cy }].slice(-18)
                    : [{ x: blob.cx, y: blob.cy }];

                nextTracked.push({
                    id: bestPrev.id,
                    x: blob.x,
                    y: blob.y,
                    w: blob.w,
                    h: blob.h,
                    cx: blob.cx,
                    cy: blob.cy,
                    area: blob.area,
                    vel,
                    trail,
                });
            } else {
                nextTracked.push({
                    id: this.nextBlobId++,
                    ...blob,
                    vel: 0,
                    trail: [{ x: blob.cx, y: blob.cy }],
                });
            }
        }

        this.trackedBlobs = nextTracked;

        this.drawOverlay(w, h, {
            blobStyle,
            blobConnectLines,
            blobConnectMode,
            blobLinkDistance,
            blobShowLabels,
            blobShowTrails,
            blobColor,
        });
    }

    drawOverlay(w, h, opts) {
        const ctx = this.ctx;
        const blobs = this.trackedBlobs;
        if (blobs.length === 0) return;

        ctx.save();
        ctx.strokeStyle = opts.blobColor;
        ctx.fillStyle = opts.blobColor;
        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textBaseline = 'bottom';

        if (opts.blobConnectLines && blobs.length > 1) {
            ctx.lineWidth = 0.85;
            if (opts.blobConnectMode === 'Chain') {
                ctx.globalAlpha = 0.6;
                ctx.beginPath();
                ctx.moveTo(blobs[0].cx, blobs[0].cy);
                for (let i = 1; i < blobs.length; i++) {
                    ctx.lineTo(blobs[i].cx, blobs[i].cy);
                }
                ctx.stroke();
            } else if (opts.blobConnectMode === 'All Blobs') {
                ctx.globalAlpha = 0.35;
                ctx.beginPath();
                for (let i = 0; i < blobs.length; i++) {
                    for (let j = i + 1; j < blobs.length; j++) {
                        ctx.moveTo(blobs[i].cx, blobs[i].cy);
                        ctx.lineTo(blobs[j].cx, blobs[j].cy);
                    }
                }
                ctx.stroke();
            } else {
                for (let i = 0; i < blobs.length; i++) {
                    for (let j = i + 1; j < blobs.length; j++) {
                        const a = blobs[i];
                        const b = blobs[j];
                        const dist = Math.hypot(a.cx - b.cx, a.cy - b.cy);
                        if (dist < opts.blobLinkDistance) {
                            const alpha = (1 - dist / opts.blobLinkDistance) * 0.45;
                            ctx.globalAlpha = alpha;
                            ctx.beginPath();
                            ctx.moveTo(a.cx, a.cy);
                            ctx.lineTo(b.cx, b.cy);
                            ctx.stroke();
                        }
                    }
                }
            }
        }

        if (opts.blobShowTrails) {
            ctx.lineWidth = 1;
            for (const b of blobs) {
                if (!b.trail || b.trail.length < 2) continue;
                for (let i = 1; i < b.trail.length; i++) {
                    ctx.globalAlpha = (i / b.trail.length) * 0.5;
                    ctx.beginPath();
                    ctx.moveTo(b.trail[i - 1].x, b.trail[i - 1].y);
                    ctx.lineTo(b.trail[i].x, b.trail[i].y);
                    ctx.stroke();
                }
            }
        }

        for (const b of blobs) {
            ctx.globalAlpha = 0.82;
            ctx.lineWidth = 1;

            if (opts.blobStyle === 'Full Box') {
                ctx.strokeRect(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5, Math.round(b.w), Math.round(b.h));
            } else if (opts.blobStyle === 'Corner Brackets') {
                const bx = Math.round(b.x) + 0.5;
                const by = Math.round(b.y) + 0.5;
                const bw = Math.round(b.w);
                const bh = Math.round(b.h);
                const cl = Math.max(5, Math.min(14, Math.min(bw, bh) * 0.28));

                ctx.beginPath();
                ctx.moveTo(bx, by + cl);
                ctx.lineTo(bx, by);
                ctx.lineTo(bx + cl, by);

                ctx.moveTo(bx + bw - cl, by);
                ctx.lineTo(bx + bw, by);
                ctx.lineTo(bx + bw, by + cl);

                ctx.moveTo(bx + bw, by + bh - cl);
                ctx.lineTo(bx + bw, by + bh);
                ctx.lineTo(bx + bw - cl, by + bh);

                ctx.moveTo(bx + cl, by + bh);
                ctx.lineTo(bx, by + bh);
                ctx.lineTo(bx, by + bh - cl);
                ctx.stroke();
            }

            const cx = Math.round(b.cx) + 0.5;
            const cy = Math.round(b.cy) + 0.5;
            ctx.globalAlpha = 0.9;
            ctx.beginPath();
            ctx.moveTo(cx - 4, cy);
            ctx.lineTo(cx + 4, cy);
            ctx.moveTo(cx, cy - 4);
            ctx.lineTo(cx, cy + 4);
            ctx.stroke();

            if (opts.blobShowLabels) {
                ctx.globalAlpha = 0.85;
                const idStr = String(b.id).padStart(2, '0');
                const nx = (b.cx / w).toFixed(2);
                const ny = (b.cy / h).toFixed(2);
                const label = `ID_${idStr} [${nx},${ny}] A:${b.area}`;
                const ly = b.y > 16 ? b.y - 3 : b.y + b.h + 12;
                ctx.fillText(label, b.x, ly);
            }
        }

        ctx.restore();
    }
}
