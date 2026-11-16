const trailWGSL = /* wgsl */ `
struct VertexOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) vUv: vec2<f32>,
};

@vertex
fn vsMain(@builtin(vertex_index) idx: u32) -> VertexOut {
    var positions = array<vec2<f32>, 4>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0,  1.0)
    );
    let p = positions[idx];
    var out: VertexOut;
    out.pos = vec4<f32>(p, 0.0, 1.0);
    out.vUv = 0.5 * p + 0.5;
    return out;
}

struct TrailUniforms {
    uTime: f32,
    uDeltaTime: f32,
    uLogoScale: f32,
    uLogoRatio: f32,
    uLogoTwirl: f32,
    uLogoPull: f32,
    uTrailFalloff: f32,
    uTrailFade: f32,
    uScrollSpeed: f32,
    uDistortSpeed: f32,
    uTurbSpeed: f32,
    uTurbFreq: f32,
    uMouse: vec2<f32>,
    uMouseVelocity: vec2<f32>,
    uResolution: vec2<f32>,
    _pad0: vec2<f32>,
};

@group(0) @binding(0) var<uniform> u: TrailUniforms;
@group(0) @binding(1) var uSamplerRepeat: sampler;
@group(0) @binding(2) var uSamplerClamp: sampler;
@group(0) @binding(3) var uNoiseTexture: texture_2d<f32>;
@group(0) @binding(4) var uPreviousFrame: texture_2d<f32>;
@group(0) @binding(5) var uLogoTexture: texture_2d<f32>;

fn turbulence(p: vec2<f32>) -> vec2<f32> {
    var rot = mat2x2<f32>(0.6, -0.8, 0.8, 0.6);
    var turb = vec2<f32>(0.0, 0.0);
    var freq = u.uTurbFreq;
    for (var i: i32 = 0; i < 8; i = i + 1) {
        let fi = f32(i);
        let pos = p + u.uTurbSpeed * fi * u.uTime * vec2<f32>(0.1, 0.0);
        let phase = freq * (pos * rot).y + u.uTurbSpeed * u.uTime * freq * 0.1;
        turb = turb + rot[0] * sin(phase) / freq;
        rot = rot * mat2x2<f32>(0.6, -0.8, 0.8, 0.6);
        freq = freq * 1.3;
    }
    return turb;
}

@fragment
fn fsMain(in: VertexOut) -> @location(0) vec4<f32> {
    let vUv = in.vUv;
    let ratio = min(u.uResolution.yx / u.uResolution.xy, vec2<f32>(1.0, 1.0));
    let scale = max(u.uLogoScale, 1.0 - (u.uLogoRatio / 4.0)) * ratio * vec2<f32>(u.uLogoRatio, -1.0);
    let logoUV = vec2<f32>(0.5, 0.5) + (vUv - vec2<f32>(0.5, 0.5)) / scale;

    var logo = vec4<f32>(0.0);
    if (logoUV.x >= 0.0 && logoUV.x <= 1.0 && logoUV.y >= 0.0 && logoUV.y <= 1.0) {
        logo = textureSampleLevel(uLogoTexture, uSamplerClamp, logoUV, 0.0);
    }

    let delta = 144.0 * u.uDeltaTime;
    let scroll = u.uScrollSpeed * vec2<f32>(1.0, vUv.y - 0.5) * ratio;
    let turb = turbulence((vUv + scroll) / ratio);
    var distort = u.uDistortSpeed * turb;
    let rot90 = mat2x2<f32>(0.0, -1.0, 1.0, 0.0);
    distort = distort - u.uLogoTwirl * (logo.rg - 0.6) * rot90 * (logo.g - 0.5) * logo.b;
    distort = distort - u.uLogoPull * (logo.rg - 0.6) * logo.b * logo.b;

    let distortedUv = vUv + delta * scroll + delta * distort * ratio;
    let prev = textureSampleLevel(uPreviousFrame, uSamplerClamp, vec2<f32>(distortedUv.x, 1.0 - distortedUv.y), 0.0);

    let trailA = vUv + 0.01 * delta * turb * ratio - u.uMouse;
    let trailB = -u.uMouseVelocity;
    let trailD = dot(trailB, trailB);
    var trailDif = trailA / ratio;

    var falloff = 0.0;
    if (trailD > 0.0) {
        let f = clamp(dot(trailA, trailB) / trailD, 0.0, 1.0);
        trailDif = trailDif - f * trailB / ratio;
        falloff = (1.0 - logo.b) / (1.0 + u.uTrailFalloff * dot(trailDif, trailDif));
        falloff = falloff * min(trailD / (0.001 + trailD), 1.0);
    }

    let suv = (u.uMouse - u.uMouseVelocity) * 2.0 - 1.0;
    var vig = 1.0 - abs(suv.y);
    vig = vig * (0.5 + 0.5 * suv.x);

    let nuv = fract(in.pos.xy / 64.0 + u.uTime * vec2<f32>(7.1, 9.1));
    let noise = textureSampleLevel(uNoiseTexture, uSamplerRepeat, nuv, 0.0).r;

    var fade = pow(vec4<f32>(max(noise, 0.0001)), vec4<f32>(0.02, 0.02, 0.1, 0.1));
    fade = exp(-u.uTrailFade * fade * u.uDeltaTime);
    let decay = mix(vec4<f32>(0.5, 0.5, 0.0, 0.0), prev, fade);

    var col = decay;
    let vel = (-trailB) / (0.01 + length(trailB));
    let rgUpdate = (vec2<f32>(0.5) - abs(decay.rg - vec2<f32>(0.5))) * (falloff * vel);
    col = vec4<f32>(
        col.rg - rgUpdate,
        col.ba + falloff * (vec2<f32>(1.0) - decay.ba) * vec2<f32>(1.0, vig * vig)
    );
    col = col + vec4<f32>((noise - 0.5) / 255.0);
    return clamp(col, vec4<f32>(0.0), vec4<f32>(1.0));
}
`;

const finalWGSL = /* wgsl */ `
struct VertexOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) vUv: vec2<f32>,
};

@vertex
fn vsMain(@builtin(vertex_index) idx: u32) -> VertexOut {
    var positions = array<vec2<f32>, 4>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0,  1.0)
    );
    let p = positions[idx];
    var out: VertexOut;
    out.pos = vec4<f32>(p, 0.0, 1.0);
    out.vUv = 0.5 * p + 0.5;
    return out;
}

struct FinalUniforms {
    uTime: f32,
    uLogoScale: f32,
    uLogoRatio: f32,
    uLogoOpacity: f32,
    uGlowStrength: f32,
    uGlowTurbulence: f32,
    uGlowTint: f32,
    uTrailStrength: f32,
    uStarIntensity: f32,
    uFlareIntensity: f32,
    uStarSpeed: f32,
    uStarAmp: f32,
    uStarFreq: f32,
    uChromShift: f32,
    uDither: f32,
    uShowRawLogo: f32,
    uStarColor: vec3<f32>,
    _pad0: f32,
    uGlowRed: vec3<f32>,
    _pad1: f32,
    uGlowBlue: vec3<f32>,
    uLightTheme: f32,
    uResolution: vec2<f32>,
    uOffset: vec2<f32>,
};

@group(0) @binding(0) var<uniform> u: FinalUniforms;
@group(0) @binding(1) var uSamplerRepeat: sampler;
@group(0) @binding(2) var uSamplerClamp: sampler;
@group(0) @binding(3) var uNoiseTexture: texture_2d<f32>;
@group(0) @binding(4) var uLogoTexture: texture_2d<f32>;
@group(0) @binding(5) var uTrailTexture: texture_2d<f32>;

fn turbulence(p: vec2<f32>, freqIn: f32, num: i32) -> vec2<f32> {
    var rot = mat2x2<f32>(0.6, -0.8, 0.8, 0.6);
    var turb = vec2<f32>(0.0, 0.0);
    var freq = freqIn;
    for (var i: i32 = 0; i < 12; i = i + 1) {
        if (i >= num) { break; }
        let fi = f32(i);
        let pos = p + turb + u.uStarSpeed * fi * u.uTime * vec2<f32>(1.0, 0.0);
        let phase = freq * (pos * rot).y + u.uStarSpeed * u.uTime * freq;
        turb = turb + rot[0] * sin(phase) / freq;
        rot = rot * mat2x2<f32>(0.6, -0.8, 0.8, 0.6);
        freq = freq * 1.5;
    }
    return turb;
}

fn star(p: vec2<f32>) -> vec3<f32> {
    let suv = p * 2.0 - 1.0;
    var right = suv - vec2<f32>(1.0, 0.0);
    right.x = right.x * (0.7 * u.uResolution.x / u.uResolution.y);

    let factor = 1.0 + 0.4 * sin(9.0 * suv.y) * sin(5.0 * (suv.x + 5.0 * u.uTime * u.uStarSpeed));
    var turb = right + factor * u.uStarAmp * turbulence(right, u.uStarFreq, 12);
    turb.x = turb.x - 0.5 * suv.y * suv.y;

    let fade = max(4.0 * suv.y * suv.y - suv.x + 1.2, 0.001);
    let atten = fade * max(0.5 * turb.x, -turb.x);

    let ft = 0.4 * u.uTime;
    var fp = 8.0 * (turb + 0.5 * vec2<f32>(1.0, 0.0) * ft);
    fp = fp * mat2x2<f32>(0.4, -0.3, 0.3, 0.4);

    let f = cos(fp.x) * sin(fp.y) - 0.5;
    let flare = f * f + 0.5 * suv.y * suv.y - 1.5 * turb.x + 0.6 * cos(0.42 * ft + 1.6 * turb.y) * cos(0.31 * ft - turb.y);

    var col = 0.1 * u.uStarColor * (u.uStarIntensity / (atten * atten) + u.uFlareIntensity / (flare * flare));
    let chrom = vec3<f32>(0.0, u.uChromShift, u.uChromShift * 2.0);
    col = col * exp(p.x *
        cos(turb.y * 5.0 + 0.4 * (u.uTime + turb.x * 1.0) + chrom) *
        cos(turb.y * 7.0 - 0.5 * (u.uTime - turb.x * 1.5) + chrom) *
        cos(turb.y * 9.0 + 0.6 * (u.uTime + turb.x * 2.0) + chrom)
    );
    return col;
}

@fragment
fn fsMain(in: VertexOut) -> @location(0) vec4<f32> {
    let vUv = in.vUv;
    let duv = fract((0.9 * in.pos.xy / 64.0) * mat2x2<f32>(0.8, -0.6, 0.6, 0.8));
    let dither = textureSampleLevel(uNoiseTexture, uSamplerRepeat, duv, 0.0).r - 0.5;

    let ratio = min(u.uResolution.yx / u.uResolution.xy, vec2<f32>(1.0, 1.0));
    let trailTex = textureSampleLevel(uTrailTexture, uSamplerClamp, vec2<f32>(vUv.x, 1.0 - vUv.y), 0.0);
    let suv = vUv * 2.0 - 1.0;

    let scale = max(u.uLogoScale, 1.0 - (u.uLogoRatio / 4.0)) * ratio * vec2<f32>(u.uLogoRatio, -1.0);
    var logoUv = vec2<f32>(0.5, 0.5) + (vUv - vec2<f32>(0.5, 0.5)) / scale;

    if (u.uShowRawLogo > 0.5) {
        var raw = vec4<f32>(0.5, 0.5, 0.0, 0.0);
        if (logoUv.x >= 0.0 && logoUv.x <= 1.0 && logoUv.y >= 0.0 && logoUv.y <= 1.0) {
            raw = textureSampleLevel(uLogoTexture, uSamplerClamp, logoUv, 0.0);
        }
        return vec4<f32>(raw.rgb, 1.0);
    }

    var logo = vec4<f32>(0.0);
    var logoTurb = vec4<f32>(0.0);
    var dir = vec2<f32>(0.0);
    var glow = 0.0;
    var distort = u.uOffset;

    if (logoUv.x >= 0.0 && logoUv.x <= 1.0 && logoUv.y >= 0.0 && logoUv.y <= 1.0) {
        logo = textureSampleLevel(uLogoTexture, uSamplerClamp, logoUv, 0.0);
        dir = logo.rg - 0.6;
        dir.x = -dir.x;

        var shift = -2.0 * vec2<f32>(dir.y, -dir.x) * dir.y * logo.b;
        shift = shift + 0.1 * (1.0 - logo.b) * (trailTex.rg - 0.5) * trailTex.b * ratio;

        var logoT = logoUv * vec2<f32>(u.uLogoRatio, 1.0) + shift;
        logoT = logoT + (1.0 - logo.b) * turbulence(logoT, 40.0, 6);
        logoUv = (logoT - shift) / vec2<f32>(u.uLogoRatio, 1.0);

        logoTurb = textureSampleLevel(uLogoTexture, uSamplerClamp, logoUv, 0.0);
        let mixedB = mix(logo.b, logoTurb.b, u.uGlowTurbulence);

        let xx = logoUv.x;
        let yy = logoUv.y - 0.5;
        glow = max(mixedB - (xx * xx + 8.0 * yy * yy) * mixedB, 0.0);
        distort = distort + dir * logo.b * (1.0 - logo.b);
    }

    var starUv = vUv + distort;
    starUv = starUv + 0.3 * (trailTex.rg - 0.5) * trailTex.b * ratio;
    var col = star(starUv);

    var vig = 1.0 - abs(suv.y);
    vig = vig * (0.5 + 0.5 * suv.x);
    col = col * (vig * vig);

    col = col / (1.0 + col);
    col = clamp(col, vec3<f32>(0.0), vec3<f32>(1.0));
    col = sqrt(col);

    var yy = suv.y + 0.03;
    yy = max(1.0 - 10.0 * yy * yy / max(0.5 + 1.5 * starUv.x, 0.1), 0.0);
    var light = max(0.5 + 0.5 * starUv.x, 0.0) * yy;
    light = light + 2.0 * (1.0 - light) * glow;

    let tint = u.uGlowTint * dir.x * glow;
    let hue = mix(u.uGlowRed, u.uGlowBlue, 1.0 + suv.x + tint);
    let alpha = 1.0 - (1.0 - pow(yy, 30.0)) * glow;
    var rim = u.uGlowStrength * light * light * light * light * alpha * (0.5 + 0.5 * suv.x) * hue;

    rim = rim / (1.0 + rim);
    col = col + (1.0 - col) * rim * rim;
    col = col + u.uTrailStrength * hue * pow(max(trailTex.aaa, vec3<f32>(0.0)), vec3<f32>(1.4, 1.2, 1.0));

    let a = smoothstep(1.0, 0.2, logo.a * u.uLogoOpacity);
    col = a * col + vec3<f32>(1.0 - a);

    col = mix(col, vec3<f32>(1.0) - col, u.uLightTheme);

    col = col + vec3<f32>(u.uDither * dither);
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`;

export class WebGPURenderer {
    constructor(canvas, device, context, format) {
        this.canvas = canvas;
        this.device = device;
        this.context = context;
        this.format = format;
        this.backendName = 'WebGPU';

        this.samplerRepeat = device.createSampler({
            addressModeU: 'repeat',
            addressModeV: 'repeat',
            magFilter: 'linear',
            minFilter: 'linear',
        });
        this.samplerClamp = device.createSampler({
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            magFilter: 'linear',
            minFilter: 'linear',
        });

        this.trailUniformData = new Float32Array(20); // 80 bytes
        this.trailUniformBuffer = device.createBuffer({
            size: this.trailUniformData.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.finalUniformData = new Float32Array(32); // 128 bytes
        this.finalUniformBuffer = device.createBuffer({
            size: this.finalUniformData.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.noiseTexture = this._createNoiseTexture(256);
        this.logoTexture = this._createTextureFromData(new Uint8Array([127, 127, 0, 0]), 1, 1);

        const trailModule = device.createShaderModule({ code: trailWGSL });
        const finalModule = device.createShaderModule({ code: finalWGSL });

        this.trailPipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: trailModule, entryPoint: 'vsMain' },
            fragment: {
                module: trailModule,
                entryPoint: 'fsMain',
                targets: [{ format: 'rgba8unorm' }],
            },
            primitive: { topology: 'triangle-strip' },
        });

        this.finalPipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: finalModule, entryPoint: 'vsMain' },
            fragment: {
                module: finalModule,
                entryPoint: 'fsMain',
                targets: [{ format }],
            },
            primitive: { topology: 'triangle-strip' },
        });

        this.fbWidth = 640;
        this.fbHeight = 360;
        this.fbTextures = [null, null];
        this.fbViews = [null, null];
        this.currentFB = 0;
        this._allocFramebuffers();
        this._rebuildBindGroups();
    }

    static async tryCreate(canvas) {
        if (!navigator.gpu) return null;
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) return null;
        const device = await adapter.requestDevice();
        const context = canvas.getContext('webgpu');
        if (!context) return null;
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({
            device,
            format,
            alphaMode: 'opaque',
        });
        return new WebGPURenderer(canvas, device, context, format);
    }

    _createNoiseTexture(size) {
        const data = new Uint8Array(size * size * 4);
        for (let i = 0; i < size * size; i++) {
            const v = (Math.random() * 256) | 0;
            const p = i * 4;
            data[p] = v;
            data[p + 1] = v;
            data[p + 2] = v;
            data[p + 3] = 255;
        }
        return this._createTextureFromData(data, size, size);
    }

    _createTextureFromData(data, width, height) {
        const tex = this.device.createTexture({
            size: [width, height, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.device.queue.writeTexture(
            { texture: tex },
            data,
            { bytesPerRow: width * 4 },
            [width, height, 1]
        );
        return tex;
    }

    _allocFramebuffers() {
        for (let i = 0; i < 2; i++) {
            if (this.fbTextures[i]) this.fbTextures[i].destroy();
            const tex = this.device.createTexture({
                size: [this.fbWidth, this.fbHeight, 1],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            });
            this.fbTextures[i] = tex;
            this.fbViews[i] = tex.createView();
        }
    }

    _rebuildBindGroups() {
        const noiseView = this.noiseTexture.createView();
        const logoView = this.logoTexture.createView();

        this.trailBindGroups = [0, 1].map((i) =>
            this.device.createBindGroup({
                layout: this.trailPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.trailUniformBuffer } },
                    { binding: 1, resource: this.samplerRepeat },
                    { binding: 2, resource: this.samplerClamp },
                    { binding: 3, resource: noiseView },
                    { binding: 4, resource: this.fbViews[1 - i] },
                    { binding: 5, resource: logoView },
                ],
            })
        );

        this.finalBindGroups = [0, 1].map((i) =>
            this.device.createBindGroup({
                layout: this.finalPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.finalUniformBuffer } },
                    { binding: 1, resource: this.samplerRepeat },
                    { binding: 2, resource: this.samplerClamp },
                    { binding: 3, resource: noiseView },
                    { binding: 4, resource: logoView },
                    { binding: 5, resource: this.fbViews[i] },
                ],
            })
        );
    }

    resize(renderWidth, renderHeight, trailScale = 0.6) {
        this.canvas.width = Math.max(1, renderWidth);
        this.canvas.height = Math.max(1, renderHeight);
        this.fbWidth = Math.max(1, Math.floor(renderWidth * trailScale));
        this.fbHeight = Math.max(1, Math.floor(renderHeight * trailScale));
        this._allocFramebuffers();
        this._rebuildBindGroups();
    }

    setLogoData(rgbaData, width, height) {
        if (this.logoTexture) this.logoTexture.destroy();
        this.logoTexture = this._createTextureFromData(rgbaData, width, height);
        this._rebuildBindGroups();
    }

    setLogoImage(image) {
        if (this.logoTexture) this.logoTexture.destroy();
        const w = image.naturalWidth || image.width;
        const h = image.naturalHeight || image.height;
        const tex = this.device.createTexture({
            size: [w, h, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.device.queue.copyExternalImageToTexture({ source: image }, { texture: tex }, [w, h]);
        this.logoTexture = tex;
        this._rebuildBindGroups();
    }

    render(params) {
        const { simTime, deltaTime, mouse, mouseVelocity, state, starColorVec, glowRedVec, glowBlueVec } = params;

        const tu = this.trailUniformData;
        tu[0] = simTime;
        tu[1] = deltaTime;
        tu[2] = state.logoScale;
        tu[3] = state.logoRatio;
        tu[4] = state.logoTwirl;
        tu[5] = state.logoPull;
        tu[6] = state.trailFalloff;
        tu[7] = state.trailFade;
        tu[8] = state.scrollSpeed;
        tu[9] = state.distortSpeed;
        tu[10] = state.turbSpeed;
        tu[11] = state.turbFreq;
        tu[12] = mouse.x;
        tu[13] = mouse.y;
        tu[14] = mouseVelocity.x;
        tu[15] = mouseVelocity.y;
        tu[16] = this.fbWidth;
        tu[17] = this.fbHeight;
        this.device.queue.writeBuffer(this.trailUniformBuffer, 0, tu);

        const fu = this.finalUniformData;
        fu[0] = simTime;
        fu[1] = state.logoScale;
        fu[2] = state.logoRatio;
        fu[3] = state.logoOpacity;
        fu[4] = state.glowStrength;
        fu[5] = state.glowTurbulence;
        fu[6] = state.glowTint;
        fu[7] = state.trailStrength;
        fu[8] = state.starIntensity;
        fu[9] = state.flareIntensity;
        fu[10] = state.starSpeed;
        fu[11] = state.starAmp;
        fu[12] = state.starFreq;
        fu[13] = state.chromShift;
        fu[14] = state.dither;
        fu[15] = state.showRawLogo ? 1.0 : 0.0;
        fu[16] = starColorVec[0];
        fu[17] = starColorVec[1];
        fu[18] = starColorVec[2];
        fu[20] = glowRedVec[0];
        fu[21] = glowRedVec[1];
        fu[22] = glowRedVec[2];
        fu[24] = glowBlueVec[0];
        fu[25] = glowBlueVec[1];
        fu[26] = glowBlueVec[2];
        fu[27] = state.lightTheme ? 1.0 : 0.0;
        fu[28] = this.canvas.width;
        fu[29] = this.canvas.height;
        fu[30] = 0;
        fu[31] = 0;
        this.device.queue.writeBuffer(this.finalUniformBuffer, 0, fu);

        const encoder = this.device.createCommandEncoder();

        // PASS 1: Trail
        const pass1 = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: this.fbViews[this.currentFB],
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0.5, g: 0.5, b: 0, a: 0 },
                },
            ],
        });
        pass1.setPipeline(this.trailPipeline);
        pass1.setBindGroup(0, this.trailBindGroups[this.currentFB]);
        pass1.draw(4);
        pass1.end();

        // PASS 2: Final
        const swapView = this.context.getCurrentTexture().createView();
        const pass2 = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: swapView,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                },
            ],
        });
        pass2.setPipeline(this.finalPipeline);
        pass2.setBindGroup(0, this.finalBindGroups[this.currentFB]);
        pass2.draw(4);
        pass2.end();

        this.device.queue.submit([encoder.finish()]);
        this.currentFB = 1 - this.currentFB;
    }
}
