export const vertexShaderSource = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
        precision highp float;
    #else
        precision mediump float;
    #endif
    attribute vec2 aPosition;
    varying vec2 vUv;
    void main() {
        vUv = 0.5 * aPosition + 0.5;
        gl_Position = vec4(aPosition, 0.0, 1.0);
    }
`;

export const trailFragmentSource = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
        precision highp float;
    #else
        precision mediump float;
    #endif
    varying vec2 vUv;
    uniform float uTime;
    uniform float uDeltaTime;
    uniform float uLogoScale;
    uniform float uLogoRatio;
    uniform float uLogoTwirl;
    uniform float uLogoPull;
    uniform float uTrailFalloff;
    uniform float uTrailFade;
    uniform float uScrollSpeed;
    uniform float uDistortSpeed;
    uniform float uTurbSpeed;
    uniform float uTurbFreq;
    uniform vec2 uMouse;
    uniform vec2 uMouseVelocity;
    uniform vec2 uResolution;
    uniform sampler2D uNoiseTexture;
    uniform sampler2D uPreviousFrame;
    uniform sampler2D uLogoTexture;

    #define FADE_EXP vec4(0.02, 0.02, 0.1, 0.1)
    #define TURB_NUM 8.0
    #define TURB_VEL vec2(0.1, 0.0)
    #define TURB_EXP 1.3

    vec2 turbulence(vec2 p) {
        mat2 rot = mat2(0.6, -0.8, 0.8, 0.6);
        vec2 turb = vec2(0.0);
        float freq = uTurbFreq;
        for (float i = 0.0; i < TURB_NUM; i++) {
            vec2 pos = p + uTurbSpeed * i * uTime * TURB_VEL;
            float phase = freq * (pos * rot).y + uTurbSpeed * uTime * freq * 0.1;
            turb += rot[0] * sin(phase) / freq;
            rot *= mat2(0.6, -0.8, 0.8, 0.6);
            freq *= TURB_EXP;
        }
        return turb;
    }

    void main() {
        vec2 ratio = min(uResolution.yx / uResolution.xy, 1.0);
        vec2 scale = max(uLogoScale, 1.0 - (uLogoRatio / 4.0)) * ratio * vec2(uLogoRatio, -1.0);
        vec2 logoUV = 0.5 + (vUv - 0.5) / scale;

        vec4 logo = vec4(0);
        if (logoUV.x >= 0.0 && logoUV.x <= 1.0 && logoUV.y >= 0.0 && logoUV.y <= 1.0) {
            logo = texture2D(uLogoTexture, logoUV);
        }

        float delta = 144.0 * uDeltaTime;
        vec2 scroll = uScrollSpeed * vec2(1.0, vUv.y - 0.5) * ratio;
        vec2 turb = turbulence((vUv + scroll) / ratio);
        vec2 distort = uDistortSpeed * turb;
        distort -= uLogoTwirl * (logo.rg - 0.6) * mat2(0, -1, 1, 0) * (logo.g - 0.5) * logo.b;
        distort -= uLogoPull * (logo.rg - 0.6) * logo.b * logo.b;

        vec2 distortedUv = vUv + delta * scroll + delta * distort * ratio;
        vec4 prev = texture2D(uPreviousFrame, distortedUv);

        vec2 trailA = vUv + 0.01 * delta * turb * ratio - uMouse;
        vec2 trailB = -uMouseVelocity;
        float trailD = dot(trailB, trailB);
        vec2 trailDif = trailA / ratio;

        float falloff = 0.0;
        if (trailD > 0.0) {
            float f = clamp(dot(trailA, trailB) / trailD, 0.0, 1.0);
            trailDif -= f * trailB / ratio;
            falloff = (1.0 - logo.b) / (1.0 + uTrailFalloff * dot(trailDif, trailDif));
            falloff *= min(trailD / (0.001 + trailD), 1.0);
        }

        vec2 suv = (uMouse - uMouseVelocity) * 2.0 - 1.0;
        float vig = 1.0 - abs(suv.y);
        vig *= 0.5 + 0.5 * suv.x;

        vec2 nuv = gl_FragCoord.xy / 64.0 + uTime * vec2(7.1, 9.1);
        float noise = texture2D(uNoiseTexture, nuv).r;

        vec4 fade = pow(vec4(noise), FADE_EXP);
        fade = exp(-uTrailFade * fade * uDeltaTime);
        vec4 decay = mix(vec4(0.5, 0.5, 0.0, 0.0), prev, fade);

        vec4 col = decay;
        vec2 vel = (-trailB) / (0.01 + length(trailB));
        col.rg -= (0.5 - abs(decay.rg - 0.5)) * (falloff * vel);
        col.ba += falloff * (1.0 - decay.ba) * vec2(1.0, vig * vig);
        col += (noise - 0.5) / 255.0;

        gl_FragColor = col;
    }
`;

export const finalFragmentSource = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
        precision highp float;
    #else
        precision mediump float;
    #endif
    varying vec2 vUv;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uLogoScale;
    uniform float uLogoRatio;
    uniform float uLogoOpacity;
    uniform float uGlowStrength;
    uniform float uGlowTurbulence;
    uniform float uGlowTint;
    uniform float uTrailStrength;
    uniform float uStarIntensity;
    uniform float uFlareIntensity;
    uniform float uStarSpeed;
    uniform float uStarAmp;
    uniform float uStarFreq;
    uniform float uChromShift;
    uniform float uDither;
    uniform float uShowRawLogo;
    uniform float uLightTheme;
    uniform vec3 uStarColor;
    uniform vec3 uGlowRed;
    uniform vec3 uGlowBlue;
    uniform vec2 uOffset;
    uniform sampler2D uNoiseTexture;
    uniform sampler2D uLogoTexture;
    uniform sampler2D uTrailTexture;

    #define STAR_NUM 12.0
    #define STAR_VEL vec2(1.0, 0.0)
    #define STAR_EXP 1.5
    #define LIGHT_EXP 30.0
    #define TRAIL_EXP vec3(1.4, 1.2, 1.0)
    #define DITHER_RES 64.0

    vec3 gamma_encode(vec3 lrgb) {
        return sqrt(lrgb);
    }

    vec2 turbulence(vec2 p, float freq, float num) {
        mat2 rot = mat2(0.6, -0.8, 0.8, 0.6);
        vec2 turb = vec2(0.0);
        for (float i = 0.0; i < STAR_NUM; i++) {
            if (i >= num) break;
            vec2 pos = p + turb + uStarSpeed * i * uTime * STAR_VEL;
            float phase = freq * (pos * rot).y + uStarSpeed * uTime * freq;
            turb += rot[0] * sin(phase) / freq;
            rot *= mat2(0.6, -0.8, 0.8, 0.6);
            freq *= STAR_EXP;
        }
        return turb;
    }

    vec3 star(inout vec2 p) {
        #define STAR_STRETCH 0.7
        #define STAR_CURVE 0.5

        vec2 suv = p * 2.0 - 1.0;
        vec2 right = suv - vec2(1.0, 0.0);
        right.x *= STAR_STRETCH * uResolution.x / uResolution.y;

        float factor = 1.0 + 0.4 * sin(9.0 * suv.y) * sin(5.0 * (suv.x + 5.0 * uTime * uStarSpeed));
        vec2 turb = right + factor * uStarAmp * turbulence(right, uStarFreq, STAR_NUM);
        turb.x -= STAR_CURVE * suv.y * suv.y;

        float fade = max(4.0 * suv.y * suv.y - suv.x + 1.2, 0.001);
        float atten = fade * max(0.5 * turb.x, -turb.x);

        float ft = 0.4 * uTime;
        vec2 fp = 8.0 * (turb + 0.5 * STAR_VEL * ft);
        fp *= mat2(0.4, -0.3, 0.3, 0.4);

        float f = cos(fp.x) * sin(fp.y) - 0.5;
        float flare = f * f + 0.5 * suv.y * suv.y - 1.5 * turb.x + 0.6 * cos(0.42 * ft + 1.6 * turb.y) * cos(0.31 * ft - turb.y);

        vec3 col = 0.1 * uStarColor * (uStarIntensity / (atten * atten) + uFlareIntensity / (flare * flare));

        vec3 chrom = vec3(0.0, uChromShift, uChromShift * 2.0);
        col *= exp(p.x *
            cos(turb.y * 5.0 + 0.4 * (uTime + turb.x * 1.0) + chrom) *
            cos(turb.y * 7.0 - 0.5 * (uTime - turb.x * 1.5) + chrom) *
            cos(turb.y * 9.0 + 0.6 * (uTime + turb.x * 2.0) + chrom)
        );
        return col;
    }

    void main() {
        vec2 duv = 0.9 * gl_FragCoord.xy / DITHER_RES * mat2(0.8, -0.6, 0.6, 0.8);
        float dither = texture2D(uNoiseTexture, duv).r - 0.5;

        vec2 ratio = min(uResolution.yx / uResolution.xy, 1.0);
        vec4 trailTex = texture2D(uTrailTexture, vUv);
        vec2 suv = vUv * 2.0 - 1.0;

        vec2 scale = max(uLogoScale, 1.0 - (uLogoRatio / 4.0)) * ratio * vec2(uLogoRatio, -1.0);
        vec2 logoUv = 0.5 + (vUv - 0.5) / scale;

        if (uShowRawLogo > 0.5) {
            vec4 raw = vec4(0.5, 0.5, 0.0, 0.0);
            if (logoUv.x >= 0.0 && logoUv.x <= 1.0 && logoUv.y >= 0.0 && logoUv.y <= 1.0) {
                raw = texture2D(uLogoTexture, logoUv);
            }
            gl_FragColor = vec4(raw.rgb, 1.0);
            return;
        }

        vec4 logo = vec4(0);
        vec4 logoTurb = vec4(0);
        vec2 dir = vec2(0);
        float glow = 0.0;
        vec2 distort = uOffset;

        if (logoUv.x >= 0.0 && logoUv.x <= 1.0 && logoUv.y >= 0.0 && logoUv.y <= 1.0) {
            logo = texture2D(uLogoTexture, logoUv);
            dir = (logo.rg - 0.6);
            dir.x = -dir.x;

            vec2 shift = -2.0 * vec2(dir.y, -dir.x) * dir.y * logo.b;
            shift += 0.1 * (1.0 - logo.b) * (trailTex.rg - 0.5) * trailTex.b * ratio;

            vec2 logoT = (logoUv) * vec2(uLogoRatio, 1.0) + shift;
            logoT += (1.0 - logo.b) * turbulence(logoT, 40.0, 6.0);
            logoUv = (logoT - shift) / vec2(uLogoRatio, 1.0);

            logoTurb = texture2D(uLogoTexture, logoUv);
            logoTurb.b = mix(logo.b, logoTurb.b, uGlowTurbulence);

            float xx = logoUv.x;
            float yy = (logoUv.y - 0.5);
            glow = max(logoTurb.b - (xx * xx + 8.0 * yy * yy) * logoTurb.b, 0.0);
            distort += dir * logo.b * (1.0 - logo.b);
        }

        vec2 starUv = vUv + distort;
        starUv += 0.3 * (trailTex.rg - 0.5) * trailTex.b * ratio;
        vec3 col = star(starUv);

        float vig = 1.0 - abs(suv.y);
        vig *= 0.5 + 0.5 * suv.x;
        col *= vig * vig;

        col /= 1.0 + col;
        col = clamp(col, 0.0, 1.0);
        col = gamma_encode(col);

        float yy = suv.y + 0.03;
        yy = max(1.0 - 1e1 * yy * yy / max(0.5 + 1.5 * starUv.x, 0.1), 0.0);
        float light = max(0.5 + 0.5 * starUv.x, 0.0) * yy;
        light += 2.0 * (1.0 - light) * glow;

        float tint = uGlowTint * dir.x * glow;
        vec3 hue = mix(uGlowRed, uGlowBlue, 1.0 + suv.x + tint);
        float alpha = 1.0 - (1.0 - pow(yy, LIGHT_EXP)) * glow;
        vec3 rim = uGlowStrength * light * light * light * light * alpha * (0.5 + 0.5 * suv.x) * hue;

        rim /= (1.0 + rim);
        col += (1.0 - col) * rim * rim;
        col += uTrailStrength * hue * pow(trailTex.aaa, TRAIL_EXP);

        float a = smoothstep(1.0, 0.2, logo.a * uLogoOpacity);
        col.rgb = a * col.rgb + (1.0 - a);

        col = mix(col, 1.0 - col, uLightTheme);

        col += uDither * dither;
        gl_FragColor = vec4(col, 1.0);
    }
`;
