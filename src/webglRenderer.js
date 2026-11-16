import { vertexShaderSource, trailFragmentSource, finalFragmentSource } from './shaders.js';

export class WebGLRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.backendName = 'WebGL';
        this.gl =
            canvas.getContext('webgl2', {
                alpha: false,
                antialias: false,
                depth: false,
                stencil: false,
                powerPreference: 'high-performance',
            }) ||
            canvas.getContext('webgl', {
                alpha: false,
                antialias: false,
                depth: false,
                stencil: false,
                powerPreference: 'high-performance',
            });

        if (!this.gl) {
            throw new Error('WebGL not supported');
        }

        if (typeof WebGL2RenderingContext !== 'undefined' && this.gl instanceof WebGL2RenderingContext) {
            this.backendName = 'WebGL2';
        }

        const gl = this.gl;
        const vs = this._compileShader(gl.VERTEX_SHADER, vertexShaderSource);
        const trailFs = this._compileShader(gl.FRAGMENT_SHADER, trailFragmentSource);
        const finalFs = this._compileShader(gl.FRAGMENT_SHADER, finalFragmentSource);

        this.trailProgram = this._createProgram(vs, trailFs);
        this.finalProgram = this._createProgram(vs, finalFs);

        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

        this.noiseTexture = this._createNoiseTexture(256);
        this.logoTexture = this._createEmptyLogoTexture();

        this.fbWidth = 640;
        this.fbHeight = 360;
        this.framebuffers = [gl.createFramebuffer(), gl.createFramebuffer()];
        this.fbTextures = [this._createFBTexture(0), this._createFBTexture(1)];
        this.currentFB = 0;

        // Cache uniform & attribute locations for zero-overhead render loop
        this.trailLocs = this._getLocations(this.trailProgram, [
            'uTime', 'uDeltaTime', 'uLogoScale', 'uLogoRatio', 'uLogoTwirl', 'uLogoPull',
            'uTrailFalloff', 'uTrailFade', 'uScrollSpeed', 'uDistortSpeed', 'uTurbSpeed',
            'uTurbFreq', 'uMouse', 'uMouseVelocity', 'uResolution',
            'uNoiseTexture', 'uPreviousFrame', 'uLogoTexture',
        ]);
        this.trailPosLoc = gl.getAttribLocation(this.trailProgram, 'aPosition');

        this.finalLocs = this._getLocations(this.finalProgram, [
            'uTime', 'uResolution', 'uLogoScale', 'uLogoRatio', 'uLogoOpacity',
            'uGlowStrength', 'uGlowTurbulence', 'uGlowTint', 'uTrailStrength',
            'uStarIntensity', 'uFlareIntensity', 'uStarSpeed', 'uStarAmp', 'uStarFreq',
            'uChromShift', 'uDither', 'uShowRawLogo', 'uLightTheme', 'uStarColor', 'uGlowRed',
            'uGlowBlue', 'uOffset', 'uNoiseTexture', 'uLogoTexture', 'uTrailTexture',
        ]);
        this.finalPosLoc = gl.getAttribLocation(this.finalProgram, 'aPosition');
    }

    _compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(`Shader compile error: ${log}`);
        }
        return shader;
    }

    _createProgram(vs, fs) {
        const gl = this.gl;
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(`Program link error: ${gl.getProgramInfoLog(program)}`);
        }
        return program;
    }

    _getLocations(program, names) {
        const locs = {};
        for (const name of names) {
            locs[name] = this.gl.getUniformLocation(program, name);
        }
        return locs;
    }

    _createNoiseTexture(size) {
        const gl = this.gl;
        const data = new Uint8Array(size * size * 4);
        for (let i = 0; i < size * size; i++) {
            const v = (Math.random() * 256) | 0;
            const p = i * 4;
            data[p] = v;
            data[p + 1] = v;
            data[p + 2] = v;
            data[p + 3] = 255;
        }
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        return tex;
    }

    _createEmptyLogoTexture() {
        const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([127, 127, 0, 0]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        return tex;
    }

    _createFBTexture(index) {
        const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.fbWidth, this.fbHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[index]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        return tex;
    }

    resize(renderWidth, renderHeight, trailScale = 0.6) {
        const gl = this.gl;
        this.canvas.width = Math.max(1, renderWidth);
        this.canvas.height = Math.max(1, renderHeight);
        this.fbWidth = Math.max(1, Math.floor(renderWidth * trailScale));
        this.fbHeight = Math.max(1, Math.floor(renderHeight * trailScale));

        for (let i = 0; i < 2; i++) {
            gl.bindTexture(gl.TEXTURE_2D, this.fbTextures[i]);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.fbWidth, this.fbHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }
    }

    setLogoData(rgbaData, width, height) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.logoTexture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgbaData);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    setLogoImage(image) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.logoTexture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    render(params) {
        const gl = this.gl;
        const { simTime, deltaTime, mouse, mouseVelocity, state, starColorVec, glowRedVec, glowBlueVec } = params;

        // PASS 1: Trail simulation
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[this.currentFB]);
        gl.viewport(0, 0, this.fbWidth, this.fbHeight);
        gl.useProgram(this.trailProgram);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(this.trailPosLoc);
        gl.vertexAttribPointer(this.trailPosLoc, 2, gl.FLOAT, false, 0, 0);

        const tl = this.trailLocs;
        gl.uniform1f(tl.uTime, simTime);
        gl.uniform1f(tl.uDeltaTime, deltaTime);
        gl.uniform1f(tl.uLogoScale, state.logoScale);
        gl.uniform1f(tl.uLogoRatio, state.logoRatio);
        gl.uniform1f(tl.uLogoTwirl, state.logoTwirl);
        gl.uniform1f(tl.uLogoPull, state.logoPull);
        gl.uniform1f(tl.uTrailFalloff, state.trailFalloff);
        gl.uniform1f(tl.uTrailFade, state.trailFade);
        gl.uniform1f(tl.uScrollSpeed, state.scrollSpeed);
        gl.uniform1f(tl.uDistortSpeed, state.distortSpeed);
        gl.uniform1f(tl.uTurbSpeed, state.turbSpeed);
        gl.uniform1f(tl.uTurbFreq, state.turbFreq);
        gl.uniform2f(tl.uMouse, mouse.x, mouse.y);
        gl.uniform2f(tl.uMouseVelocity, mouseVelocity.x, mouseVelocity.y);
        gl.uniform2f(tl.uResolution, this.fbWidth, this.fbHeight);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.noiseTexture);
        gl.uniform1i(tl.uNoiseTexture, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.fbTextures[1 - this.currentFB]);
        gl.uniform1i(tl.uPreviousFrame, 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.logoTexture);
        gl.uniform1i(tl.uLogoTexture, 2);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // PASS 2: Final composite
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.useProgram(this.finalProgram);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(this.finalPosLoc);
        gl.vertexAttribPointer(this.finalPosLoc, 2, gl.FLOAT, false, 0, 0);

        const fl = this.finalLocs;
        gl.uniform1f(fl.uTime, simTime);
        gl.uniform2f(fl.uResolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(fl.uLogoScale, state.logoScale);
        gl.uniform1f(fl.uLogoRatio, state.logoRatio);
        gl.uniform1f(fl.uLogoOpacity, state.logoOpacity);
        gl.uniform1f(fl.uGlowStrength, state.glowStrength);
        gl.uniform1f(fl.uGlowTurbulence, state.glowTurbulence);
        gl.uniform1f(fl.uGlowTint, state.glowTint);
        gl.uniform1f(fl.uTrailStrength, state.trailStrength);
        gl.uniform1f(fl.uStarIntensity, state.starIntensity);
        gl.uniform1f(fl.uFlareIntensity, state.flareIntensity);
        gl.uniform1f(fl.uStarSpeed, state.starSpeed);
        gl.uniform1f(fl.uStarAmp, state.starAmp);
        gl.uniform1f(fl.uStarFreq, state.starFreq);
        gl.uniform1f(fl.uChromShift, state.chromShift);
        gl.uniform1f(fl.uDither, state.dither);
        gl.uniform1f(fl.uShowRawLogo, state.showRawLogo ? 1.0 : 0.0);
        gl.uniform1f(fl.uLightTheme, state.lightTheme ? 1.0 : 0.0);
        gl.uniform3fv(fl.uStarColor, starColorVec);
        gl.uniform3fv(fl.uGlowRed, glowRedVec);
        gl.uniform3fv(fl.uGlowBlue, glowBlueVec);
        gl.uniform2f(fl.uOffset, 0, 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.noiseTexture);
        gl.uniform1i(fl.uNoiseTexture, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.logoTexture);
        gl.uniform1i(fl.uLogoTexture, 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.fbTextures[this.currentFB]);
        gl.uniform1i(fl.uTrailTexture, 2);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        this.currentFB = 1 - this.currentFB;
    }
}
