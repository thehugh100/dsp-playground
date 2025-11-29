import { DSPNode } from '../core/dsp-node.js';

export class SampleHoldNodeUI extends DSPNode {
    constructor(x, y, app) {
        super(x, y, 'Sample & Hold', app);
        this.type = 'samplehold';
        this.width = 180;
        this.baseTitle = 'Sample & Hold';
        this.context = null;
        this.signalIn = null;
        this.outputGain = null;
        this.workletNode = null;
        this.bypassGain = null;
        this.fallbackActive = false;
        this.heldValue = 0;
        this.subscribers = [];
        this.deferredInit = false;
        this.frequency = SampleHoldNodeUI.defaultFrequency;
        this.effectiveFrequency = this.frequency;
    }

    initAudio(ctx) {
        if (!ctx) return;
        this.context = ctx;

        this.setupCommonIO(ctx);

        this.inputs = [
            { name: 'In', id: 0, node: this.signalIn }
        ];
        this.outputs = [{ name: 'Out', id: 0, node: this.outputGain }];
        this.params = [
            {
                label: 'Frequency (Hz)',
                type: 'range',
                value: this.frequency,
                min: SampleHoldNodeUI.minFrequency,
                max: SampleHoldNodeUI.maxFrequency,
                scale: 'log',
                onChange: (v, meta) => this.setFrequency(v, ctx, meta)
            }
        ];
        this.initializeParams();
        this.computeHeight();

        this.updateHeldValue(this.heldValue);
        this.prepareWorklet(ctx);
    }

    setupCommonIO(ctx) {
        if (!this.signalIn) {
            this.signalIn = ctx.createGain();
        }
        if (!this.outputGain) {
            this.outputGain = ctx.createGain();
            this.outputGain.gain.value = 1;
        }
        if (!this.bypassGain) {
            this.bypassGain = ctx.createGain();
            this.bypassGain.gain.value = 1;
        }
    }

    prepareWorklet(ctx) {
        if (!SampleHoldNodeUI.shouldUseWorklet(ctx)) {
            SampleHoldNodeUI.markUnsupported(ctx);
            this.activateBypass(ctx);
            console.warn('Sample & Hold worklet unavailable; node will pass the signal through.');
            return;
        }

        this.activateBypass(ctx);

        const attachIfReady = () => {
            if (this.context === ctx && !this.workletNode) {
                this.initWorkletPipeline(ctx);
            }
        };

        if (SampleHoldNodeUI.isWorkletReady(ctx)) {
            attachIfReady();
            return;
        }

        if (this.deferredInit) return;
        this.deferredInit = true;
        SampleHoldNodeUI.ensureWorklet(ctx)
            .then(() => {
                this.deferredInit = false;
                attachIfReady();
            })
            .catch((err) => {
                this.deferredInit = false;
                SampleHoldNodeUI.markUnsupported(ctx);
                console.error('Sample & Hold worklet load failed', err);
                this.activateBypass(ctx);
            });
    }

    initWorkletPipeline(ctx) {
        this.setupCommonIO(ctx);

        if (this.workletNode) {
            try { this.workletNode.port.onmessage = null; } catch (e) { }
            try { this.workletNode.disconnect(); } catch (e) { }
            this.workletNode = null;
        }

        try {
            this.workletNode = new AudioWorkletNode(ctx, 'sample-hold-processor', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [1],
                channelCount: 1,
                channelCountMode: 'explicit',
                channelInterpretation: 'discrete',
                parameterData: {
                    frequency: this.effectiveFrequency
                }
            });
        } catch (err) {
            console.error('Sample & Hold worklet initialisation failed', err);
            this.workletNode = null;
            this.activateBypass(ctx);
            return false;
        }

        this.signalIn.connect(this.workletNode, 0, 0);
        this.workletNode.connect(this.outputGain);

        if (this.fallbackActive) {
            this.deactivateBypass();
        }

        this.updateFrequencyParam(ctx);

        this.workletNode.port.onmessage = (event) => {
            this.handleWorkletMessage(event.data);
        };

        try {
            this.workletNode.port.postMessage({ type: 'reset' });
        } catch (e) { }

        return true;
    }

    activateBypass(ctx) {
        if (this.fallbackActive) return;
        const context = ctx || this.context;
        if (!context) return;
        this.setupCommonIO(context);
        if (this.bypassGain) {
            try { this.signalIn.connect(this.bypassGain); } catch (e) { }
            try { this.bypassGain.connect(this.outputGain); } catch (e) { }
        } else if (this.signalIn && this.outputGain) {
            try { this.signalIn.connect(this.outputGain); } catch (e) { }
        }
        this.fallbackActive = true;
    }

    deactivateBypass() {
        if (!this.fallbackActive) return;
        if (this.bypassGain) {
            try { this.signalIn.disconnect(this.bypassGain); } catch (e) { }
            try { this.bypassGain.disconnect(); } catch (e) { }
        } else if (this.signalIn && this.outputGain) {
            try { this.signalIn.disconnect(this.outputGain); } catch (e) { }
        }
        this.fallbackActive = false;
    }

    setFrequency(value, ctx, meta) {
        const next = SampleHoldNodeUI.sanitizeFrequency(value);
        const param = this.params && this.params[0];
        const baseValue = param ? param.value : this.frequency;
        const metaFlag = meta && meta.fromAutomation === true;
        const inferredAutomation = !metaFlag && param ? Math.abs(next - baseValue) > 1e-6 : false;
        const isAutomation = metaFlag || inferredAutomation;

        if (isAutomation) {
            if (Math.abs(next - this.effectiveFrequency) < 1e-6) return;
            this.effectiveFrequency = next;
            if (param) {
                param.effectiveValue = next;
            }
            this.updateFrequencyParam(ctx, next);
            return;
        }

        if (Math.abs(next - this.frequency) < 1e-6) {
            this.effectiveFrequency = next;
            if (param) {
                param.effectiveValue = next;
            }
            this.updateFrequencyParam(ctx, next);
            return;
        }

        this.frequency = next;
        this.effectiveFrequency = next;
        if (param) {
            param.value = next > 0 ? next : SampleHoldNodeUI.minFrequency;
            param.effectiveValue = next;
        }
        this.updateFrequencyParam(ctx, next);
    }

    updateFrequencyParam(ctx, overrideValue) {
        if (!this.workletNode) return;
        const context = ctx || this.context;
        const param = this.workletNode.parameters.get('frequency');
        if (!param) return;
        const target = typeof overrideValue === 'number' ? overrideValue : this.effectiveFrequency;
        if (context) {
            param.setTargetAtTime(target, context.currentTime, 0.005);
        } else {
            param.value = target;
        }
    }

    handleWorkletMessage(data) {
        if (typeof data === 'number') {
            this.updateHeldValue(data);
            return;
        }
        if (data && typeof data.value === 'number') {
            this.updateHeldValue(data.value);
        }
    }

    initProcessorPipeline(ctx) {
        this.activateBypass(ctx);
        return false;
    }

    getValue() {
        return this.heldValue;
    }

    addSubscriber(node, paramIndex) {
        this.subscribers.push({ node, paramIndex });
    }

    removeSubscriber(node, paramIndex) {
        this.subscribers = this.subscribers.filter(s => !(s.node === node && s.paramIndex === paramIndex));
    }

    notifySubscribers() {
        this.subscribers.forEach(({ node, paramIndex }) => {
            if (node && typeof node.updateParam === 'function') {
                node.updateParam(paramIndex);
            }
        });
    }

    onRemoved() {
        this.deferredInit = false;

        if (this.workletNode) {
            try { this.workletNode.port.postMessage({ type: 'reset' }); } catch (e) { }
            try { this.workletNode.port.onmessage = null; } catch (e) { }
            try { this.workletNode.disconnect(); } catch (e) { }
        }
        this.workletNode = null;

        this.deactivateBypass();

        if (this.signalIn) {
            try { this.signalIn.disconnect(); } catch (e) { }
        }
        this.signalIn = null;

        if (this.outputGain) {
            try { this.outputGain.disconnect(); } catch (e) { }
        }
        this.outputGain = null;

        if (this.bypassGain) {
            try { this.bypassGain.disconnect(); } catch (e) { }
        }
        this.bypassGain = null;

        this.heldValue = 0;
        this.context = null;
        this.subscribers = [];
        this.title = this.baseTitle;
    }

    updateHeldValue(value) {
        if (!Number.isFinite(value)) return;
        if (Math.abs(value - this.heldValue) < 1e-6) return;
        this.heldValue = value;
        this.notifySubscribers();
    }

    static shouldUseWorklet(ctx) {
        if (!ctx) return false;
        if (typeof window !== 'undefined') {
            const protocol = window.location && typeof window.location.protocol === 'string'
                ? window.location.protocol.toLowerCase()
                : '';
            if (protocol && protocol !== 'http:' && protocol !== 'https:') return false;
            if (typeof window.isSecureContext !== 'undefined' && window.isSecureContext === false) return false;
            if (!window.AudioWorkletNode) return false;
        }
        if (typeof AudioWorkletNode === 'undefined') return false;
        if (!ctx.audioWorklet) return false;
        if (SampleHoldNodeUI.isWorkletUnsupported(ctx)) return false;
        return true;
    }

    static markUnsupported(ctx) {
        if (!ctx) return;
        if (!SampleHoldNodeUI._workletStates) {
            SampleHoldNodeUI._workletStates = new WeakMap();
        }
        SampleHoldNodeUI._workletStates.set(ctx, { ready: false, unsupported: true });
    }

    static ensureWorklet(ctx) {
        if (!ctx) return Promise.resolve();

        if (!SampleHoldNodeUI._workletStates) {
            SampleHoldNodeUI._workletStates = new WeakMap();
        }

        const currentState = SampleHoldNodeUI._workletStates.get(ctx);
        const secure = (typeof window === 'undefined') || (typeof window.isSecureContext === 'undefined') || window.isSecureContext;
        const hasAPI = !!(ctx.audioWorklet && (typeof window === 'undefined' || window.AudioWorkletNode));

        if (!secure || !hasAPI) {
            if (!currentState || !currentState.unsupported) {
                SampleHoldNodeUI.markUnsupported(ctx);
                console.warn('Sample & Hold node running in bypass; AudioWorklet requires a secure context.');
            }
            return Promise.resolve();
        }

        if (currentState && currentState.ready) return Promise.resolve();
        if (currentState && currentState.promise) return currentState.promise;

        const modulePath = SampleHoldNodeUI.workletModulePath;
        if (!modulePath) return Promise.resolve();

        const promise = ctx.audioWorklet.addModule(modulePath)
            .then(() => {
                SampleHoldNodeUI._workletStates.set(ctx, { ready: true });
            })
            .catch((err) => {
                SampleHoldNodeUI.markUnsupported(ctx);
                throw err;
            });

        SampleHoldNodeUI._workletStates.set(ctx, { ready: false, promise });
        return promise;
    }

    static isWorkletReady(ctx) {
        if (!ctx || !SampleHoldNodeUI._workletStates) return false;
        const state = SampleHoldNodeUI._workletStates.get(ctx);
        return !!(state && state.ready);
    }

    static isWorkletUnsupported(ctx) {
        if (!ctx || !SampleHoldNodeUI._workletStates) return false;
        const state = SampleHoldNodeUI._workletStates.get(ctx);
        return !!(state && state.unsupported);
    }
}

SampleHoldNodeUI.defaultFrequency = 1000;
SampleHoldNodeUI.minFrequency = 0.1;
SampleHoldNodeUI.maxFrequency = 20000;
SampleHoldNodeUI.workletModulePath = 'js/worklets/sample-hold-processor.js';
SampleHoldNodeUI.sanitizeFrequency = function (value) {
    if (!Number.isFinite(value)) {
        return SampleHoldNodeUI.defaultFrequency;
    }
    if (value <= 0) {
        return 0;
    }
    if (value < SampleHoldNodeUI.minFrequency) {
        return SampleHoldNodeUI.minFrequency;
    }
    if (value > SampleHoldNodeUI.maxFrequency) {
        return SampleHoldNodeUI.maxFrequency;
    }
    return value;
};
