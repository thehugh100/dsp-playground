'use strict';

class FFT {
    constructor(size) {
        this.size = size;
        const levels = Math.log2(size);
        if (Math.floor(levels) !== levels) {
            throw new Error('FFT size must be power of two');
        }
        this.levels = levels;
        this.rev = new Uint32Array(size);
        for (let i = 0; i < size; i++) {
            this.rev[i] = FFT.reverseBits(i, levels);
        }
        this.cos = new Float32Array(size / 2);
        this.sin = new Float32Array(size / 2);
        for (let i = 0; i < size / 2; i++) {
            const angle = -2 * Math.PI * i / size;
            this.cos[i] = Math.cos(angle);
            this.sin[i] = Math.sin(angle);
        }
    }

    static reverseBits(value, bits) {
        let x = value;
        let result = 0;
        for (let i = 0; i < bits; i++) {
            result = (result << 1) | (x & 1);
            x >>= 1;
        }
        return result;
    }

    transform(real, imag, inverse) {
        const size = this.size;
        const rev = this.rev;
        for (let i = 0; i < size; i++) {
            const j = rev[i];
            if (j > i) {
                const tempR = real[i];
                const tempI = imag[i];
                real[i] = real[j];
                imag[i] = imag[j];
                real[j] = tempR;
                imag[j] = tempI;
            }
        }

        for (let len = 2; len <= size; len <<= 1) {
            const halfLen = len >> 1;
            const tableStep = size / len;
            for (let i = 0; i < size; i += len) {
                for (let j = 0; j < halfLen; j++) {
                    const index = j * tableStep;
                    const wr = this.cos[index];
                    const wi = inverse ? -this.sin[index] : this.sin[index];
                    const xr = real[i + j + halfLen];
                    const xi = imag[i + j + halfLen];
                    const tr = wr * xr - wi * xi;
                    const ti = wr * xi + wi * xr;
                    real[i + j + halfLen] = real[i + j] - tr;
                    imag[i + j + halfLen] = imag[i + j] - ti;
                    real[i + j] += tr;
                    imag[i + j] += ti;
                }
            }
        }

        if (inverse) {
            const invSize = 1 / size;
            for (let i = 0; i < size; i++) {
                real[i] *= invSize;
                imag[i] *= invSize;
            }
        }
    }
}

class PitchShiftChannel {
    constructor(sampleRate, fftSize, overlap) {
        this.sampleRate = sampleRate;
        this.pitchRatioState = 1;
        this.configure(fftSize, overlap);
    }

    configure(fftSize, overlap) {
        const size = this._sanitizeFFTSize(fftSize);
        const slices = this._sanitizeOverlap(overlap, size);
        this.fftSize = size;
        this.overlap = slices;
        this.hopSize = Math.max(1, Math.floor(this.fftSize / this.overlap));
        this.halfSize = this.fftSize >> 1;
        this.freqPerBin = this.sampleRate / this.fftSize;

        this.window = new Float32Array(this.fftSize);
        for (let i = 0; i < this.fftSize; i++) {
            this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.fftSize);
        }

        const phaseCount = this.halfSize + 1;
        this.expectedPhase = new Float32Array(phaseCount);
        const base = 2 * Math.PI * this.hopSize / this.fftSize;
        for (let k = 0; k < phaseCount; k++) {
            this.expectedPhase[k] = base * k;
        }

        this.analysisPhase = new Float32Array(phaseCount);
        this.synthPhase = new Float32Array(phaseCount);
        this.synthMag = new Float32Array(phaseCount);
        this.synthPhaseInc = new Float32Array(phaseCount);
        this.synthCount = new Float32Array(phaseCount);

        const capacity = this.fftSize * 4;
        this.inputRing = new Float32Array(capacity);
        this.outputRing = new Float32Array(capacity);
        this.inWrite = 0;
        this.inRead = 0;
        this.inCount = 0;
        this.outWrite = 0;
        this.outRead = 0;
        this.outCount = 0;

        this.fftReal = new Float32Array(this.fftSize);
        this.fftImag = new Float32Array(this.fftSize);
        this.synthesisBuffer = new Float32Array(this.fftSize);
        this.fft = new FFT(this.fftSize);
        this.windowScale = this._computeWindowScale();
        this.latencySamples = Math.max(0, this.fftSize - this.hopSize);
        this.pitchRatioState = 1;
        this.reset();
    }

    reset() {
        this.inWrite = 0;
        this.inRead = 0;
        this.inCount = 0;
        this.outWrite = 0;
        this.outRead = 0;
        this.outCount = 0;
        this.analysisPhase.fill(0);
        this.synthPhase.fill(0);
        this.synthMag.fill(0);
        this.synthPhaseInc.fill(0);
        this.synthCount.fill(0);
        this.synthesisBuffer.fill(0);
        this.fftReal.fill(0);
        this.fftImag.fill(0);
        this.pitchRatioState = 1;
    }

    processBlock(input, output, ratio) {
        const frames = output.length;
        const effectiveRatio = this._smoothRatio(ratio);
        for (let i = 0; i < frames; i++) {
            const sample = input ? input[i] : 0;
            this._pushInput(sample);
        }

        while (this.inCount >= this.fftSize) {
            this._processFrame(effectiveRatio);
        }

        for (let i = 0; i < frames; i++) {
            output[i] = this.outCount > 0 ? this._popOutput() : 0;
        }
    }

    _smoothRatio(target) {
        const desired = target > 0 ? target : 1;
        const alpha = 0.02;
        this.pitchRatioState += (desired - this.pitchRatioState) * alpha;
        if (this.pitchRatioState < 0.25) this.pitchRatioState = 0.25;
        if (this.pitchRatioState > 4) this.pitchRatioState = 4;
        return this.pitchRatioState;
    }

    _pushInput(sample) {
        if (this.inCount >= this.inputRing.length) {
            this.inRead = (this.inRead + 1) % this.inputRing.length;
            this.inCount--;
        }
        this.inputRing[this.inWrite] = sample;
        this.inWrite = (this.inWrite + 1) % this.inputRing.length;
        this.inCount++;
    }

    _popOutput() {
        if (this.outCount === 0) return 0;
        const value = this.outputRing[this.outRead];
        this.outRead = (this.outRead + 1) % this.outputRing.length;
        this.outCount--;
        return value;
    }

    _pushOutput(value) {
        if (this.outCount >= this.outputRing.length) {
            this.outRead = (this.outRead + 1) % this.outputRing.length;
            this.outCount--;
        }
        this.outputRing[this.outWrite] = value;
        this.outWrite = (this.outWrite + 1) % this.outputRing.length;
        this.outCount++;
    }

    _processFrame(ratio) {
        const N = this.fftSize;
        const hop = this.hopSize;
        const half = this.halfSize;
        const freqPerBin = this.freqPerBin;
        const twoPi = 2 * Math.PI;

        let index = this.inRead;
        for (let i = 0; i < N; i++) {
            this.fftReal[i] = this.inputRing[index] * this.window[i];
            this.fftImag[i] = 0;
            index = (index + 1) % this.inputRing.length;
        }

        this.fft.transform(this.fftReal, this.fftImag, false);

        for (let k = 0; k <= half; k++) {
            const real = this.fftReal[k];
            const imag = this.fftImag[k];
            const mag = Math.hypot(real, imag);
            const phase = Math.atan2(imag, real);

            const prev = this.analysisPhase[k];
            this.analysisPhase[k] = phase;

            let delta = phase - prev - this.expectedPhase[k];
            delta -= twoPi * Math.round(delta / twoPi);

            const trueFreqBin = k + (delta * N) / (twoPi * hop);
            const trueFreqHz = trueFreqBin * freqPerBin;
            const shiftedHz = trueFreqHz * ratio;
            const targetBin = Math.round(shiftedHz / freqPerBin);

            if (targetBin >= 0 && targetBin <= half) {
                this.synthMag[targetBin] += mag;
                const phaseInc = twoPi * shiftedHz * hop / this.sampleRate;
                this.synthPhaseInc[targetBin] += phaseInc;
                this.synthCount[targetBin] += 1;
            }
        }

        for (let k = 0; k <= half; k++) {
            const count = this.synthCount[k];
            if (count > 0) {
                const mag = this.synthMag[k] / count;
                const inc = this.synthPhaseInc[k] / count;
                this.synthPhase[k] += inc;
                if (this.synthPhase[k] > twoPi || this.synthPhase[k] < -twoPi) {
                    this.synthPhase[k] = this.synthPhase[k] % twoPi;
                }
                this.fftReal[k] = mag * Math.cos(this.synthPhase[k]);
                this.fftImag[k] = mag * Math.sin(this.synthPhase[k]);
            } else {
                this.fftReal[k] = 0;
                this.fftImag[k] = 0;
            }
            this.synthMag[k] = 0;
            this.synthPhaseInc[k] = 0;
            this.synthCount[k] = 0;
        }

        for (let k = 1; k < half; k++) {
            const mirror = N - k;
            this.fftReal[mirror] = this.fftReal[k];
            this.fftImag[mirror] = -this.fftImag[k];
        }
        this.fftImag[0] = 0;
        this.fftImag[half] = 0;

        this.fft.transform(this.fftReal, this.fftImag, true);

        const scale = this.windowScale;
        for (let i = 0; i < N; i++) {
            const value = this.fftReal[i] * this.window[i] * scale;
            this.synthesisBuffer[i] += value;
        }

        for (let i = 0; i < hop; i++) {
            this._pushOutput(this.synthesisBuffer[i]);
        }

        this.synthesisBuffer.copyWithin(0, hop);
        this.synthesisBuffer.fill(0, N - hop);

        this.inRead = (this.inRead + hop) % this.inputRing.length;
        this.inCount = Math.max(0, this.inCount - hop);
    }

    _computeWindowScale() {
        let energy = 0;
        for (let i = 0; i < this.fftSize; i++) {
            const w = this.window[i];
            energy += w * w;
        }
        if (energy === 0) {
            return 1;
        }
        return this.hopSize / energy;
    }

    _sanitizeFFTSize(size) {
        let power = 512;
        while (power < size) {
            power <<= 1;
        }
        if (power > 8192) power = 8192;
        return power;
    }

    _sanitizeOverlap(overlap, size) {
        let value = Math.max(2, Math.floor(overlap));
        if (value > size) value = size;
        while (size % value !== 0 && value > 2) {
            value--;
        }
        if (size % value !== 0) {
            value = 2;
        }
        return value;
    }
}

class HQPitchShiftProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            {
                name: 'ratio',
                defaultValue: 1,
                minValue: 0.25,
                maxValue: 4,
                automationRate: 'k-rate'
            }
        ];
    }

    constructor(options = {}) {
        super();
        const opts = options.processorOptions || {};
        this.sampleRateHz = sampleRate;
        this.fftSize = this._sanitizeFFTSize(opts.fftSize || 2048);
        this.overlap = this._sanitizeOverlap(opts.overlap || 4, this.fftSize);
        this.channels = [];
        this.port.onmessage = this._handleMessage.bind(this);
        this._ensureChannels(opts.maxChannels || 2);
        this._notifyLatency();
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        if (!output) {
            return true;
        }

        const channelCount = output.length;
        this._ensureChannels(channelCount);

        const ratioParam = parameters.ratio;
        const ratioValue = ratioParam && ratioParam.length ? ratioParam[ratioParam.length - 1] : 1;
        const ratio = Math.min(4, Math.max(0.25, ratioValue));

        if (!input || input.length === 0) {
            for (let ch = 0; ch < channelCount; ch++) {
                this.channels[ch].processBlock(null, output[ch], ratio);
            }
            return true;
        }

        const inChannels = input.length;
        for (let ch = 0; ch < channelCount; ch++) {
            const src = input[ch < inChannels ? ch : inChannels - 1];
            this.channels[ch].processBlock(src, output[ch], ratio);
        }

        return true;
    }

    _ensureChannels(count) {
        for (let i = this.channels.length; i < count; i++) {
            this.channels.push(new PitchShiftChannel(this.sampleRateHz, this.fftSize, this.overlap));
        }
    }

    _handleMessage(event) {
        const data = event.data;
        if (!data || typeof data !== 'object') return;
        if (data.type === 'configure') {
            if (typeof data.fftSize === 'number') {
                this.fftSize = this._sanitizeFFTSize(data.fftSize);
            }
            if (typeof data.overlap === 'number') {
                this.overlap = this._sanitizeOverlap(data.overlap, this.fftSize);
            }
            for (let i = 0; i < this.channels.length; i++) {
                this.channels[i].configure(this.fftSize, this.overlap);
            }
            this._notifyLatency();
        } else if (data.type === 'reset') {
            for (let i = 0; i < this.channels.length; i++) {
                this.channels[i].reset();
            }
            this._notifyLatency();
        }
    }

    _notifyLatency() {
        const channel = this.channels[0];
        const samples = channel ? channel.latencySamples : 0;
        this.port.postMessage({ type: 'latency', samples });
    }

    _sanitizeFFTSize(size) {
        let value = 512;
        while (value < size) {
            value <<= 1;
        }
        if (value > 8192) value = 8192;
        return value;
    }

    _sanitizeOverlap(overlap, fftSize) {
        let value = Math.max(2, Math.floor(overlap));
        if (value > fftSize) value = fftSize;
        while (fftSize % value !== 0 && value > 2) {
            value--;
        }
        if (fftSize % value !== 0) {
            value = 2;
        }
        return value;
    }
}

registerProcessor('hq-pitch-shifter', HQPitchShiftProcessor);
