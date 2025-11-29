import { DSPNode } from '../core/dsp-node.js';

export class PitchShiftNodeUI extends DSPNode {
    constructor(x, y, app) {
        super(x, y, 'Pitch Shifter', app);
        this.type = 'pitch-shifter';
        this.width = 200;

        this.semitones = 0;
        this.cents = 0;
        this.mix = 1;
        this.pitchRatio = 1;

        this.context = null;
        this.inputGain = null;
        this.outputGain = null;
        this.dryDelay = null;
        this.dryGain = null;
        this.wetGain = null;
        this.bypassGain = null;
        this.workletNode = null;
        this.deferredInit = false;
        this.latencySamples = 0;
        this._bypassCleanupTimer = null;

        this.fftSize = PitchShiftNodeUI.defaultFFTSize;
        this.overlap = PitchShiftNodeUI.defaultOverlap;
    }

    initAudio(ctx) {
        this.context = ctx;

        this.inputGain = ctx.createGain();
        this.outputGain = ctx.createGain();
        this.dryDelay = ctx.createDelay(1.0);
        this.dryGain = ctx.createGain();
        this.wetGain = ctx.createGain();
        this.bypassGain = ctx.createGain();
        this.bypassGain.gain.value = 1;

        this.inputGain.connect(this.dryDelay);
        this.dryDelay.connect(this.dryGain);
        this.dryGain.connect(this.outputGain);

        this.inputGain.connect(this.bypassGain);
        this.bypassGain.connect(this.wetGain);
        this.wetGain.connect(this.outputGain);

        this.inputs = [{ name: 'In', id: 0, node: this.inputGain }];
        this.outputs = [{ name: 'Out', id: 0, node: this.outputGain }];

        this.params = [
            {
                label: 'Semitones',
                type: 'range',
                value: this.semitones,
                min: -24,
                max: 24,
                scale: 'linear',
                onChange: (v) => this.setSemitones(v, ctx)
            },
            {
                label: 'Fine (cents)',
                type: 'range',
                value: this.cents,
                min: -100,
                max: 100,
                scale: 'linear',
                onChange: (v) => this.setFine(v, ctx)
            },
            {
                label: 'Mix',
                type: 'range',
                value: this.mix,
                min: 0,
                max: 1,
                scale: 'linear',
                onChange: (v) => this.setMix(v, ctx)
            }
        ];

        this.initializeParams();
        this.computeHeight();

        this.latencySamples = this.estimateLatency(this.fftSize, this.overlap);
        this.updateDryDelay(ctx);
        this.updateMix(ctx);

        this.prepareWorklet(ctx);
    }

    estimateLatency(fftSize, overlap) {
        const slices = Math.max(2, Math.floor(overlap));
        const hop = Math.max(1, Math.floor(fftSize / slices));
        return Math.max(0, fftSize - hop);
    }

    setSemitones(value, ctx) {
        this.semitones = typeof value === 'number' ? value : 0;
        this.updatePitchParam(ctx);
    }

    setFine(value, ctx) {
        this.cents = typeof value === 'number' ? value : 0;
        this.updatePitchParam(ctx);
    }

    setMix(value, ctx) {
        this.mix = Math.max(0, Math.min(1, value));
        this.updateMix(ctx);
    }

    updateMix(ctx) {
        if (!this.dryGain || !this.wetGain) return;
        const context = ctx || this.context;
        if (context) {
            const now = context.currentTime;
            this.dryGain.gain.setTargetAtTime(1 - this.mix, now, 0.02);
            this.wetGain.gain.setTargetAtTime(this.mix, now, 0.02);
        } else {
            this.dryGain.gain.value = 1 - this.mix;
            this.wetGain.gain.value = this.mix;
        }
    }

    computePitchRatio() {
        const total = this.semitones + (this.cents / 100);
        const ratio = Math.pow(2, total / 12);
        return Math.min(4, Math.max(0.25, ratio));
    }

    updatePitchParam(ctx) {
        this.pitchRatio = this.computePitchRatio();
        const context = ctx || this.context;
        if (this.workletNode) {
            const param = this.workletNode.parameters.get('ratio');
            if (param) {
                if (context) {
                    param.setTargetAtTime(this.pitchRatio, context.currentTime, 0.01);
                } else {
                    param.value = this.pitchRatio;
                }
            }
        }
    }

    updateDryDelay(ctx) {
        if (!this.dryDelay) return;
        const context = ctx || this.context;
        if (!context) return;
        const seconds = Math.min(0.9, Math.max(0, this.latencySamples / context.sampleRate));
        this.dryDelay.delayTime.setTargetAtTime(seconds, context.currentTime, 0.02);
    }

    prepareWorklet(ctx) {
        if (!PitchShiftNodeUI.shouldUseWorklet(ctx)) {
            console.warn('Pitch shifter worklet unavailable; wet signal will remain bypassed.');
            return;
        }

        const attachIfReady = () => {
            if (this.audioCtxActive(ctx) && !this.workletNode) {
                this.attachWorklet(ctx);
            }
        };

        if (PitchShiftNodeUI.isWorkletReady(ctx)) {
            attachIfReady();
            return;
        }

        this.deferredInit = true;
        PitchShiftNodeUI.ensureWorklet(ctx)
            .then(() => {
                this.deferredInit = false;
                attachIfReady();
            })
            .catch((err) => {
                this.deferredInit = false;
                PitchShiftNodeUI.markUnsupported(ctx);
                console.error('Pitch shifter worklet load failed', err);
            });
    }

    audioCtxActive(ctx) {
        return !!this.context && this.context === ctx;
    }

    attachWorklet(ctx) {
        try {
            this.workletNode = new AudioWorkletNode(ctx, 'hq-pitch-shifter', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [2],
                channelCount: 2,
                channelCountMode: 'explicit',
                channelInterpretation: 'speakers',
                parameterData: { ratio: this.pitchRatio },
                processorOptions: {
                    fftSize: this.fftSize,
                    overlap: this.overlap
                }
            });
        } catch (err) {
            console.error('Pitch shifter worklet initialisation failed', err);
            this.workletNode = null;
            return;
        }

        this.inputGain.connect(this.workletNode);
        this.workletNode.connect(this.wetGain);

        if (this.bypassGain) {
            const fadeEnd = ctx.currentTime + 0.05;
            this.bypassGain.gain.setValueAtTime(this.bypassGain.gain.value, ctx.currentTime);
            this.bypassGain.gain.linearRampToValueAtTime(0, fadeEnd);
            if (this._bypassCleanupTimer) {
                clearTimeout(this._bypassCleanupTimer);
            }
            this._bypassCleanupTimer = setTimeout(() => {
                if (!this.audioCtxActive(ctx) || !this.bypassGain) return;
                try { this.inputGain.disconnect(this.bypassGain); } catch (e) { }
                try { this.bypassGain.disconnect(); } catch (e) { }
                this.bypassGain = null;
            }, 80);
        }

        this.updatePitchParam(ctx);
        this.sendConfiguration();

        this.workletNode.port.onmessage = (event) => {
            this.handleWorkletMessage(event.data);
        };
    }

    sendConfiguration() {
        if (!this.workletNode) return;
        this.workletNode.port.postMessage({
            type: 'configure',
            fftSize: this.fftSize,
            overlap: this.overlap
        });
    }

    handleWorkletMessage(data) {
        if (!data || typeof data !== 'object') return;
        if (data.type === 'latency') {
            const samples = Number(data.samples);
            if (Number.isFinite(samples)) {
                this.latencySamples = samples;
                this.updateDryDelay();
            }
        }
    }

    onRemoved() {
        if (this._bypassCleanupTimer) {
            clearTimeout(this._bypassCleanupTimer);
            this._bypassCleanupTimer = null;
        }

        this.deferredInit = false;

        if (this.workletNode) {
            try { this.workletNode.port.postMessage({ type: 'reset' }); } catch (e) { }
            try { this.workletNode.port.onmessage = null; } catch (e) { }
            try { this.workletNode.disconnect(); } catch (e) { }
        }
        this.workletNode = null;

        if (this.bypassGain) {
            try { this.bypassGain.disconnect(); } catch (e) { }
            this.bypassGain = null;
        }

        if (this.inputGain) {
            try { this.inputGain.disconnect(); } catch (e) { }
        }
        if (this.dryDelay) {
            try { this.dryDelay.disconnect(); } catch (e) { }
        }
        if (this.dryGain) {
            try { this.dryGain.disconnect(); } catch (e) { }
        }
        if (this.wetGain) {
            try { this.wetGain.disconnect(); } catch (e) { }
        }
        if (this.outputGain) {
            try { this.outputGain.disconnect(); } catch (e) { }
        }

        this.inputGain = null;
        this.outputGain = null;
        this.dryDelay = null;
        this.dryGain = null;
        this.wetGain = null;
        this.context = null;
    }
}

PitchShiftNodeUI.defaultFFTSize = 2048;
PitchShiftNodeUI.defaultOverlap = 4;
PitchShiftNodeUI.workletModulePath = 'js/worklets/hq-pitch-shifter.js';

PitchShiftNodeUI.shouldUseWorklet = function (ctx) {
    if (!ctx) return false;
    if (PitchShiftNodeUI.isWorkletUnsupported(ctx)) return false;
    if (!ctx.audioWorklet) return false;
    if (typeof AudioWorkletNode === 'undefined') return false;
    if (typeof window !== 'undefined') {
        const protocol = window.location && window.location.protocol ? window.location.protocol.toLowerCase() : '';
        if (protocol && protocol !== 'http:' && protocol !== 'https:') return false;
        if (typeof window.isSecureContext !== 'undefined' && window.isSecureContext === false) return false;
    }
    return true;
};

PitchShiftNodeUI.markUnsupported = function (ctx) {
    if (!ctx) return;
    if (!PitchShiftNodeUI._workletStates) {
        PitchShiftNodeUI._workletStates = new WeakMap();
    }
    PitchShiftNodeUI._workletStates.set(ctx, { ready: false, unsupported: true });
};

PitchShiftNodeUI.ensureWorklet = function (ctx) {
    if (!ctx) return Promise.resolve();

    if (!PitchShiftNodeUI._workletStates) {
        PitchShiftNodeUI._workletStates = new WeakMap();
    }

    const state = PitchShiftNodeUI._workletStates.get(ctx);
    if (state && state.ready) {
        return Promise.resolve();
    }
    if (state && state.promise) {
        return state.promise;
    }

    if (!PitchShiftNodeUI.shouldUseWorklet(ctx)) {
        PitchShiftNodeUI.markUnsupported(ctx);
        return Promise.resolve();
    }

    const modulePath = PitchShiftNodeUI.workletModulePath;
    if (!modulePath) {
        PitchShiftNodeUI.markUnsupported(ctx);
        return Promise.resolve();
    }

    const promise = ctx.audioWorklet.addModule(modulePath)
        .then(() => {
            PitchShiftNodeUI._workletStates.set(ctx, { ready: true });
        })
        .catch((err) => {
            PitchShiftNodeUI.markUnsupported(ctx);
            throw err;
        });

    PitchShiftNodeUI._workletStates.set(ctx, { ready: false, promise });
    return promise;
};

PitchShiftNodeUI.isWorkletReady = function (ctx) {
    if (!ctx || !PitchShiftNodeUI._workletStates) return false;
    const state = PitchShiftNodeUI._workletStates.get(ctx);
    return !!(state && state.ready);
};

PitchShiftNodeUI.isWorkletUnsupported = function (ctx) {
    if (!ctx || !PitchShiftNodeUI._workletStates) return false;
    const state = PitchShiftNodeUI._workletStates.get(ctx);
    return !!(state && state.unsupported);
};
