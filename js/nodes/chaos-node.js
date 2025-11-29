import { DSPNode } from '../core/dsp-node.js';

export class ChaosNodeUI extends DSPNode {
    constructor(x, y, app) {
        super(x, y, 'Chaos', app);
        this.type = 'chaos';
        this.width = 190;
        this.baseRate = 0.2;
        this.octaveCount = 4;
        this.depth = 1;
        this.seed = Math.random();
        this.context = null;
        this.sumGain = null;
        this.outputGain = null;
        this.voices = [];
        this.voiceStates = [];
        this.currentValue = 0;
        this.subscribers = [];
    }

    initAudio(ctx) {
        this.context = ctx;
        this.cleanupVoices();

        this.sumGain = ctx.createGain();
        this.sumGain.gain.value = 1;
        this.outputGain = ctx.createGain();
        this.outputGain.gain.value = this.depth;
        this.sumGain.connect(this.outputGain);

        this.inputs = [];
        this.outputs = [{ name: 'Out', id: 0, node: this.outputGain }];
        this.params = [
            {
                label: 'Base Rate (Hz)', type: 'range', value: this.baseRate, min: 0.02, max: 5, scale: 'log',
                defaultValue: this.baseRate,
                onChange: (v) => this.setBaseRate(v, ctx)
            },
            {
                label: 'Octaves', type: 'range', value: this.octaveCount, min: 1, max: 8, step: 1,
                defaultValue: this.octaveCount,
                onChange: (v) => this.setOctaves(v, ctx)
            },
            {
                label: 'Depth', type: 'range', value: this.depth, min: 0, max: 1, scale: 'linear',
                defaultValue: this.depth,
                onChange: (v) => this.setDepth(v, ctx)
            },
            {
                label: 'Seed', type: 'range', value: this.seed, min: 0, max: 1, scale: 'linear',
                defaultValue: this.seed,
                onChange: (v) => this.setSeed(v, ctx)
            }
        ];
        this.initializeParams();
        this.computeHeight();
        this.app.registerDynamicNode(this);
        if (!this.voices.length) {
            this.rebuildChaosVoices(ctx);
        }
    }

    setBaseRate(value, ctx) {
        const next = Math.max(0.02, Number.isFinite(value) ? value : this.baseRate);
        this.baseRate = next;
        if (this.params && this.params[0]) {
            this.params[0].value = next;
            this.params[0].effectiveValue = next;
        }
        if (this.context && this.sumGain) {
            this.rebuildChaosVoices(ctx || this.context);
        }
    }

    setOctaves(value, ctx) {
        const next = Math.max(1, Math.round(Number.isFinite(value) ? value : this.octaveCount));
        this.octaveCount = next;
        if (this.params && this.params[1]) {
            this.params[1].value = next;
            this.params[1].effectiveValue = next;
        }
        if (this.context && this.sumGain) {
            this.rebuildChaosVoices(ctx || this.context);
        }
    }

    setDepth(value, ctx) {
        const next = Math.max(0, Math.min(1, Number.isFinite(value) ? value : this.depth));
        this.depth = next;
        const context = ctx || this.context;
        if (this.outputGain && context) {
            this.outputGain.gain.setTargetAtTime(next, context.currentTime, 0.02);
        } else if (this.outputGain) {
            this.outputGain.gain.value = next;
        }
        if (this.params && this.params[2]) {
            this.params[2].effectiveValue = next;
        }
        this.updateCurrentValue(this.computeValueFromStates());
    }

    setSeed(value, ctx) {
        let next = Number.isFinite(value) ? value : this.seed;
        next = ((next % 1) + 1) % 1;
        this.seed = next;
        if (this.params && this.params[3]) {
            this.params[3].value = next;
            this.params[3].effectiveValue = next;
        }
        if (this.context && this.sumGain) {
            this.rebuildChaosVoices(ctx || this.context);
        }
    }

    rebuildChaosVoices(ctx) {
        const context = ctx || this.context;
        if (!context || !this.sumGain) return;
        this.cleanupVoices();

        const count = Math.max(1, Math.round(this.octaveCount));
        const base = Math.max(0.002, this.baseRate);
        const rand = ChaosNodeUI.createRandom(this.seed);
        const now = context.currentTime;
        const voices = [];
        const states = [];

        for (let i = 0; i < count; i++) {
            const minFreq = base * Math.pow(2, i);
            const maxFreq = minFreq * 2;
            const freq = minFreq + (maxFreq - minFreq) * rand();
            const phase = rand() * Math.PI * 2;

            const osc = context.createOscillator();
            osc.type = 'sine';
            const real = new Float32Array(2);
            const imag = new Float32Array(2);
            real[1] = Math.cos(phase);
            imag[1] = Math.sin(phase);
            osc.setPeriodicWave(context.createPeriodicWave(real, imag, { disableNormalization: true }));
            osc.frequency.setValueAtTime(freq, now);

            const gain = context.createGain();
            gain.gain.setValueAtTime(1 / count, now);
            osc.connect(gain).connect(this.sumGain);
            osc.start(now);

            voices.push({ osc, gain });
            states.push({ frequency: freq, phase });
        }

        this.voices = voices;
        this.voiceStates = states;
        this.updateCurrentValue(this.computeValueFromStates());
    }

    cleanupVoices() {
        if (!this.voices || !this.voices.length) {
            this.voices = [];
            this.voiceStates = [];
            return;
        }
        const context = this.context;
        const now = context ? context.currentTime : 0;
        this.voices.forEach(({ osc, gain }) => {
            if (context) {
                if (gain) {
                    try { gain.gain.setTargetAtTime(0, now, 0.05); } catch (e) { }
                }
                if (osc) {
                    try { osc.stop(now + 0.1); } catch (e) { }
                }
                const localOsc = osc;
                const localGain = gain;
                setTimeout(() => {
                    if (localOsc) {
                        try { localOsc.disconnect(); } catch (e) { }
                    }
                    if (localGain) {
                        try { localGain.disconnect(); } catch (e) { }
                    }
                }, 150);
            } else {
                if (osc) {
                    try { osc.stop(); } catch (e) { }
                    try { osc.disconnect(); } catch (e) { }
                }
                if (gain) {
                    try { gain.disconnect(); } catch (e) { }
                }
            }
        });
        this.voices = [];
        this.voiceStates = [];
    }

    tick(delta, now) {
        if (!this.voiceStates || !this.voiceStates.length) return;
        const twoPi = Math.PI * 2;
        let sum = 0;
        const invCount = 1 / this.voiceStates.length;
        for (let i = 0; i < this.voiceStates.length; i++) {
            const state = this.voiceStates[i];
            state.phase = (state.phase + state.frequency * delta * twoPi) % twoPi;
            sum += Math.sin(state.phase);
        }
        const value = sum * invCount * this.depth;
        this.updateCurrentValue(value);
    }

    computeValueFromStates() {
        if (!this.voiceStates || !this.voiceStates.length) return 0;
        let sum = 0;
        for (let i = 0; i < this.voiceStates.length; i++) {
            sum += Math.sin(this.voiceStates[i].phase);
        }
        return (sum / this.voiceStates.length) * this.depth;
    }

    updateCurrentValue(value) {
        if (!Number.isFinite(value)) return;
        if (Math.abs(value - this.currentValue) < 1e-4) return;
        this.currentValue = value;
        this.notifySubscribers();
    }

    getValue() {
        return this.currentValue;
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
        this.app.unregisterDynamicNode(this);
        this.cleanupVoices();
        if (this.sumGain) {
            try { this.sumGain.disconnect(); } catch (e) { }
            this.sumGain = null;
        }
        if (this.outputGain) {
            try { this.outputGain.disconnect(); } catch (e) { }
            this.outputGain = null;
        }
        this.context = null;
        this.subscribers = [];
        this.currentValue = 0;
    }

    static createRandom(seed) {
        let normalized = Number.isFinite(seed) ? seed : Math.random();
        normalized = ((normalized % 1) + 1) % 1;
        let state = Math.floor(normalized * 2147483646) + 1;
        return () => {
            state = (state * 16807) % 2147483647;
            return state / 2147483647;
        };
    }
}
