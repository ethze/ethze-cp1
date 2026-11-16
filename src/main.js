import { WebGPURenderer } from './webgpuRenderer.js';
import { WebGLRenderer } from './webglRenderer.js';
import { generateLogoFromText } from './logoGenerator.js';
import { BlobTracker } from './blobTracker.js';

const canvas = document.getElementById('canvas');
const blobCanvas = document.getElementById('blob-canvas');
const themeToggleBtn = document.getElementById('theme-toggle');
const blobTracker = new BlobTracker(blobCanvas);

function hexToVec3(hex) {
    const clean = hex.replace('#', '');
    const n = parseInt(clean, 16);
    return [
        ((n >> 16) & 255) / 255,
        ((n >> 8) & 255) / 255,
        (n & 255) / 255,
    ];
}

// Hardcoded default settings (overridden automatically if your saved localStorage preset exists)
const DEFAULT_SETTINGS = {
    text: 'ETHZE',
    blurSigma: 14,
    gradientStrength: 1.0,
    // Colors
    starColor: '#334dcc',
    glowRed: '#803333',
    glowBlue: '#4d4d99',
    glowTint: 3.0,
    chromShift: 0.1,
    // Smoke / Trail Physics
    timeScale: 1.0,
    scrollSpeed: 0.0005,
    distortSpeed: 0.02,
    turbSpeed: 0.5,
    turbFreq: 50.0,
    trailFalloff: 9000.0,
    trailFade: 2.0,
    trailStrength: 0.4,
    logoTwirl: 0.4,
    logoPull: 0.1,
    // Star & Flare
    starIntensity: 5.0,
    flareIntensity: 4.0,
    starSpeed: 0.01,
    starAmp: 0.5,
    starFreq: 8.0,
    // Logo & Glow
    logoScale: 0.4995,
    logoOpacity: 1.0,
    glowStrength: 12.0,
    glowTurbulence: 0.4,
    dither: 0.01,
    showRawLogo: false,
    // Blob Tracking (TouchDesigner)
    blobEnabled: true,
    blobStyle: 'Corner Brackets',
    blobThreshold: 0.34,
    blobMaxCount: 18,
    blobMaxSize: 140,
    blobLogoDynamic: 1.0,
    blobConnectLines: true,
    blobConnectMode: 'All Blobs',
    blobLinkDistance: 220,
    blobShowLabels: true,
    blobShowTrails: true,
    blobColor: '#d8f3ff',
    // Performance
    renderScale: 0.85,
    trailScale: 0.55,
    blobUpdateMs: 33,
    lightTheme: false,
};

const SAVED_PRESETS_KEY = 'grok_shader_saved_presets_v1';
const DEFAULT_PRESET_KEY = 'grok_shader_default_preset_v1';

function loadSavedPresetOverrides() {
    try {
        const raw = localStorage.getItem(SAVED_PRESETS_KEY);
        const savedPresets = raw ? JSON.parse(raw) : {};
        if (!savedPresets || typeof savedPresets !== 'object') return null;

        let targetName = localStorage.getItem(DEFAULT_PRESET_KEY);
        if (!targetName || !savedPresets[targetName]) {
            const keys = Object.keys(savedPresets);
            targetName =
                keys.find((k) => k.trim().toLowerCase() === 'presetcustom') ||
                keys.find((k) => k.trim().toLowerCase() === 'my custom preset') ||
                keys[keys.length - 1] ||
                null;
        }

        if (targetName && savedPresets[targetName]) {
            console.info(`[ETHZE] Loaded saved preset "${targetName}":`, savedPresets[targetName]);
            return savedPresets[targetName];
        }
    } catch {
        // Ignore storage errors
    }
    return null;
}

const state = {
    logoRatio: 2.08,
    ...DEFAULT_SETTINGS,
};

function applyThemeUI() {
    const isLight = Boolean(state.lightTheme);
    document.body.classList.toggle('light-theme', isLight);
    document.body.style.background = isLight ? '#ffffff' : '#000000';
    if (themeToggleBtn) {
        themeToggleBtn.textContent = isLight ? 'LIGHT' : 'DARK';
    }
}

if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
        state.lightTheme = !state.lightTheme;
        applyThemeUI();
    });
}

let activeCanvas = canvas;
let renderer = null;

function handleResize() {
    const rw = Math.max(1, Math.floor(window.innerWidth * state.renderScale));
    const rh = Math.max(1, Math.floor(window.innerHeight * state.renderScale));
    blobCanvas.width = window.innerWidth;
    blobCanvas.height = window.innerHeight;
    if (renderer) {
        renderer.resize(rw, rh, state.trailScale);
    }
}
window.addEventListener('resize', handleResize);

const mouse = { x: 0.5, y: 0.5 };
const prevMouse = { x: 0.5, y: 0.5 };
const mouseVelocity = { x: 0, y: 0 };

window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX / window.innerWidth;
    mouse.y = 1.0 - e.clientY / window.innerHeight;
});

window.addEventListener(
    'touchmove',
    (e) => {
        if (e.touches && e.touches[0]) {
            mouse.x = e.touches[0].clientX / window.innerWidth;
            mouse.y = 1.0 - e.touches[0].clientY / window.innerHeight;
        }
    },
    { passive: true }
);

let simTime = 0;
let lastTime = performance.now();
let logoResult = null;

function render() {
    const now = performance.now();
    const rawDelta = Math.min((now - lastTime) * 0.001, 0.1);
    lastTime = now;

    const deltaTime = rawDelta * state.timeScale;
    simTime += deltaTime;

    mouseVelocity.x = mouse.x - prevMouse.x;
    mouseVelocity.y = mouse.y - prevMouse.y;
    prevMouse.x = mouse.x;
    prevMouse.y = mouse.y;

    if (renderer) {
        try {
            renderer.render({
                simTime,
                deltaTime,
                mouse,
                mouseVelocity,
                state,
                starColorVec: hexToVec3(state.starColor),
                glowRedVec: hexToVec3(state.glowRed),
                glowBlueVec: hexToVec3(state.glowBlue),
            });
            blobTracker.updateAndDraw(activeCanvas, simTime, state.logoScale, state.logoRatio, {
                ...state,
                blobColor: state.lightTheme ? '#111827' : state.blobColor,
            });
        } catch (err) {
            if (renderer.backendName === 'WebGPU') {
                console.warn('WebGPU runtime error, falling back to WebGL:', err);
                const fresh = activeCanvas.cloneNode(false);
                activeCanvas.replaceWith(fresh);
                activeCanvas = fresh;
                renderer = new WebGLRenderer(activeCanvas);
                handleResize();
                if (logoResult) {
                    renderer.setLogoData(logoResult.data, logoResult.width, logoResult.height);
                }
            } else {
                throw err;
            }
        }
    }

    requestAnimationFrame(render);
}

async function initStartup() {
    const saved = loadSavedPresetOverrides();
    if (saved) {
        Object.assign(state, saved);
    }
    applyThemeUI();

    try {
        renderer = await WebGPURenderer.tryCreate(activeCanvas);
    } catch (err) {
        console.warn('WebGPU init failed, using WebGL fallback:', err);
        renderer = null;
    }

    if (!renderer) {
        const fresh = activeCanvas.cloneNode(false);
        activeCanvas.replaceWith(fresh);
        activeCanvas = fresh;
        renderer = new WebGLRenderer(activeCanvas);
    }

    handleResize();

    logoResult = await generateLogoFromText(state.text, {
        blurSigma: state.blurSigma,
        gradientStrength: state.gradientStrength,
    });
    state.logoRatio = logoResult.ratio;
    blobTracker.setLogoMask(logoResult.data, logoResult.width, logoResult.height);
    renderer.setLogoData(logoResult.data, logoResult.width, logoResult.height);

    requestAnimationFrame(render);
}

initStartup();
