import { DSPNode } from '../core/dsp-node.js';

export class AllpassNodeUI extends DSPNode {
    constructor(x, y, app) {
        super(x, y, 'Allpass (Delay)', app);
        this.type = 'allpass-delay';
        this.defaultDelayMs = 50;
        this.defaultGain = 0.5;
        this.maxDelayMs = 150;
        this.delayMsValue = this.defaultDelayMs;
        this.gainValue = this.defaultGain;
        this.workletNode = null;
        this.context = null;
        this.tag = Math.random().toString(36).slice(2, 6);
    }

    initAudio(ctx) {
        this.context = ctx;
        this.inputNode = ctx.createGain();
        this.inputNode._debugLabel = `Allpass In [${this.tag}]`;
        this.outputNode = ctx.createGain();
        this.outputNode._debugLabel = `Allpass Out [${this.tag}]`;
        this.workletNode = null;
        this.legacyGraph = false;

        if (AllpassNodeUI.shouldUseWorklet(ctx) && AllpassNodeUI.isWorkletReady(ctx)) {
            try {
                const defaultDelaySamples = this.msToSamples(this.delayMsValue, ctx);
                const maxDelaySamples = Math.ceil(this.msToSamples(this.maxDelayMs, ctx)) + 8;
                this.workletNode = new AudioWorkletNode(ctx, 'allpass-delay-processor', {
                    numberOfInputs: 1,
                    numberOfOutputs: 1,
                    outputChannelCount: [2],
                    channelCount: 2,
                    channelCountMode: 'explicit',
                    channelInterpretation: 'speakers',
                    parameterData: {
                        delaySamples: defaultDelaySamples,
                        gain: this.gainValue
                    },
                    processorOptions: {
                        maxDelaySamples,
                        defaultDelaySamples
                    }
                });
            } catch (err) {
                console.error('Allpass worklet creation failed', err);
                this.workletNode = null;
            }
        }

        if (this.workletNode) {
            this.inputNode.connect(this.workletNode);
            this.workletNode.connect(this.outputNode);
        } else {
            this.buildLegacyGraph(ctx);
        }

        this.inputs = [{ name: 'In', id: 0, node: this.inputNode }];
        this.outputs = [{ name: 'Out', id: 0, node: this.outputNode }];

        this.params = [
            {
                label: 'Delay (ms)',
                type: 'range',
                value: this.delayMsValue,
                min: 1,
                max: this.maxDelayMs,
                scale: 'log',
                onChange: (v, meta) => this.setDelayMs(v, ctx, meta)
            },
            {
                label: 'Gain',
                type: 'range',
                value: this.gainValue,
                min: 0,
                max: 0.95,
                scale: 'linear',
                onChange: (v, meta) => this.setGain(v, ctx, meta)
            }
        ];

        this.initializeParams();
        this.computeHeight();
    }

    buildLegacyGraph(ctx) {
        this.legacyGraph = true;
        this.sumIn = ctx.createGain();
        this.sumIn._debugLabel = `Allpass Sum In [${this.tag}]`;
        this.sumOut = ctx.createGain();
        this.sumOut._debugLabel = `Allpass Sum Out [${this.tag}]`;
        const maxDelaySeconds = Math.max(0.2, (this.maxDelayMs / 1000) + 0.05);
        this.delay = ctx.createDelay(maxDelaySeconds);
        this.delay._debugLabel = `Allpass Delay [${this.tag}]`;
        this.g_ff = ctx.createGain();
        this.g_ff._debugLabel = `Allpass Gff [${this.tag}]`;
        this.g_fb = ctx.createGain();
        this.g_fb._debugLabel = `Allpass Gfb [${this.tag}]`;

        this.inputNode.connect(this.sumIn);
        this.sumIn.connect(this.delay);
        this.delay.connect(this.sumOut);
        this.sumIn.connect(this.g_ff);
        this.g_ff.connect(this.sumOut);
        this.delay.connect(this.g_fb);
        this.g_fb.connect(this.sumIn);
        this.sumOut.connect(this.outputNode);

        this.delay.delayTime.value = this.defaultDelayMs / 1000;
        this.g_ff.gain.value = this.defaultGain;
        this.g_fb.gain.value = -this.defaultGain;
    }

    msToSamples(ms, ctxOverride) {
        const context = ctxOverride || this.context || (this.app ? this.app.audioCtx : null);
        const sr = context && context.sampleRate ? context.sampleRate : 48000;
        return (ms / 1000) * sr;
    }

    setDelayMs(ms, ctx, meta) {
        const clamped = Math.max(1, Math.min(this.maxDelayMs, ms));
        this.delayMsValue = clamped;
        const context = ctx || this.context;
        if (this.workletNode) {
            const param = this.workletNode.parameters.get('delaySamples');
            if (param && context) {
                const samples = this.msToSamples(clamped, context);
                const now = context.currentTime || 0;
                if (typeof param.cancelScheduledValues === 'function') {
                    param.cancelScheduledValues(now);
                }
                if (meta && meta.immediate) {
                    param.setValueAtTime(samples, now);
                } else if (typeof param.setTargetAtTime === 'function') {
                    param.setTargetAtTime(samples, now, 0.02);
                } else {
                    param.value = samples;
                }
            }
        } else if (this.delay && context) {
            this.delay.delayTime.setTargetAtTime(clamped / 1000, context.currentTime, 0.02);
        } else if (this.delay) {
            this.delay.delayTime.value = clamped / 1000;
        }
    }

    setGain(v, ctx, meta) {
        const clamped = Math.max(0, Math.min(0.95, v));
        this.gainValue = clamped;
        const context = ctx || this.context;
        if (this.workletNode) {
            const param = this.workletNode.parameters.get('gain');
            if (param && context) {
                const now = context.currentTime || 0;
                if (typeof param.cancelScheduledValues === 'function') {
                    param.cancelScheduledValues(now);
                }
                if (meta && meta.immediate) {
                    param.setValueAtTime(clamped, now);
                } else if (typeof param.setTargetAtTime === 'function') {
                    param.setTargetAtTime(clamped, now, 0.02);
                } else {
                    param.value = clamped;
                }
            }
        } else {
            if (this.g_ff && context) {
                this.g_ff.gain.setTargetAtTime(clamped, context.currentTime, 0.02);
            } else if (this.g_ff) {
                this.g_ff.gain.value = clamped;
            }
            if (this.g_fb && context) {
                this.g_fb.gain.setTargetAtTime(-clamped, context.currentTime, 0.02);
            } else if (this.g_fb) {
                this.g_fb.gain.value = -clamped;
            }
        }
    }

    onRemoved() {
        if (this.workletNode) {
            try { this.inputNode.disconnect(this.workletNode); } catch (e) { }
            try { this.workletNode.disconnect(); } catch (e) { }
            try { this.workletNode.port.postMessage({ type: 'reset' }); } catch (e) { }
            this.workletNode = null;
        }
        if (this.legacyGraph) {
            try { this.delay.disconnect(); } catch (e) { }
            try { this.g_ff.disconnect(); } catch (e) { }
            try { this.g_fb.disconnect(); } catch (e) { }
            try { this.sumIn.disconnect(); } catch (e) { }
            try { this.sumOut.disconnect(); } catch (e) { }
        }
        try { this.inputNode.disconnect(); } catch (e) { }
        try { this.outputNode.disconnect(); } catch (e) { }
    }
}

AllpassNodeUI.workletModulePath = 'js/worklets/allpass-delay-processor.js';

AllpassNodeUI.shouldUseWorklet = function (ctx) {
    if (!ctx || !ctx.audioWorklet) return false;
    if (typeof AudioWorkletNode === 'undefined') return false;
    if (typeof window !== 'undefined') {
        const protocol = (window.location && window.location.protocol) ? window.location.protocol.toLowerCase() : '';
        if (protocol && protocol !== 'http:' && protocol !== 'https:') return false;
        if (typeof window.isSecureContext !== 'undefined' && window.isSecureContext === false) return false;
    }
    return true;
};

AllpassNodeUI.markUnsupported = function (ctx) {
    if (!ctx) return;
    if (!AllpassNodeUI._workletStates) {
        AllpassNodeUI._workletStates = new WeakMap();
    }
    AllpassNodeUI._workletStates.set(ctx, { ready: false, unsupported: true });
};

AllpassNodeUI.ensureWorklet = function (ctx) {
    if (!ctx) return Promise.resolve();

    if (!AllpassNodeUI.shouldUseWorklet(ctx)) {
        AllpassNodeUI.markUnsupported(ctx);
        return Promise.resolve();
    }

    if (!AllpassNodeUI._workletStates) {
        AllpassNodeUI._workletStates = new WeakMap();
    }

    const state = AllpassNodeUI._workletStates.get(ctx);
    if (state) {
        if (state.ready) return Promise.resolve();
        if (state.promise) return state.promise;
        if (state.unsupported) return Promise.resolve();
    }

    const modulePath = AllpassNodeUI.workletModulePath;
    if (!modulePath) {
        AllpassNodeUI.markUnsupported(ctx);
        return Promise.resolve();
    }

    const promise = ctx.audioWorklet.addModule(modulePath)
        .then(() => {
            AllpassNodeUI._workletStates.set(ctx, { ready: true });
        })
        .catch(err => {
            AllpassNodeUI.markUnsupported(ctx);
            throw err;
        });

    AllpassNodeUI._workletStates.set(ctx, { ready: false, promise });
    return promise;
};

AllpassNodeUI.isWorkletReady = function (ctx) {
    if (!ctx || !AllpassNodeUI._workletStates) return false;
    const state = AllpassNodeUI._workletStates.get(ctx);
    return !!(state && state.ready);
};

AllpassNodeUI.isWorkletUnsupported = function (ctx) {
    if (!ctx || !AllpassNodeUI._workletStates) return false;
    const state = AllpassNodeUI._workletStates.get(ctx);
    return !!(state && state.unsupported);
};
