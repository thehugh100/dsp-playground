import { DSPNode } from '../core/dsp-node.js';

export class LFONodeUI extends DSPNode {
    constructor(x, y, app) {
        super(x, y, 'LFO', app);
        this.type = 'lfo';
        this.width = 160;
        this.phase = 0;
        this.steppedPhase = 0;
        this.currentValue = 1;
        this.frequency = 1;
        this.stepFrequency = 1;
        this.depth = 0.5;
        this.center = 1;
        this.waveforms = ['sine', 'triangle', 'sawtooth', 'square', 'random', 'stepped'];
        this.waveformIndex = 0;
        this.randomMode = false;
        this.steppedMode = false;
        this.randomTimer = 0;
        this.randomValue = 0;
        this.steppedValue = 0;
        this.oscillator = null;
        this.amplitude = null;
        this.offsetSource = null;
        this.outputGain = null;
        this.context = null;
        this.startTime = 0;
        this.subscribers = [];
    }

    initAudio(ctx) {
        this.context = ctx;
        this.outputGain = ctx.createGain();
        this.outputGain.gain.value = 1;

        this.oscillator = ctx.createOscillator();
        this.oscillator.type = 'sine';
        this.oscillator.frequency.value = this.frequency;

        this.amplitude = ctx.createGain();
        this.amplitude.gain.value = this.depth;

        this.offsetSource = ctx.createConstantSource();
        this.offsetSource.offset.value = this.center;

        this.oscillator.connect(this.amplitude);
        this.amplitude.connect(this.outputGain);
        this.offsetSource.connect(this.outputGain);

        this.oscillator.start();
        this.offsetSource.start();
        this.startTime = ctx.currentTime;

        this.inputs = [];
        this.outputs = [{ name: 'Out', id: 0, node: this.outputGain }];
        this.params = [
            {
                label: 'Rate (Hz)', type: 'range', value: 1, min: 0.05, max: 30, scale: 'log',
                onChange: (v) => {
                    this.frequency = v;
                    if (this.oscillator) {
                        this.oscillator.frequency.setTargetAtTime(v, ctx.currentTime, 0.02);
                    }
                    if (this.randomMode) {
                        this.randomTimer = 0;
                    }
                }
            },
            {
                label: 'Depth', type: 'range', value: 0.5, min: 0, max: 1, scale: 'linear',
                onChange: (v) => this.setDepth(v, ctx)
            },
            {
                label: 'Center', type: 'range', value: 1, min: 0, max: 2, scale: 'linear',
                onChange: (v) => this.setCenter(v, ctx)
            },
            {
                label: 'Waveform', type: 'range', value: 0, min: 0, max: 5, step: 1, scale: 'linear',
                onChange: (v) => this.setWaveform(v, ctx)
            },
            {
                label: 'Step Rate (Hz)', type: 'range', value: 1, min: 0.05, max: 30, scale: 'log',
                onChange: (v) => {
                    this.stepFrequency = v;
                    if (this.steppedMode) {
                        this.randomTimer = 0;
                    }
                },
                hidden: true
            }
        ];
        this.initializeParams();
        this.currentValue = this.center;
        this.computeHeight();
        this.app.registerDynamicNode(this);
    }

    tick(delta, now) {
        if (!this.context) return;
        const freq = this.frequency;
        
        if (this.steppedMode) {
            // Sample the oscillator's current value at step rate intervals
            const stepPeriod = 1 / Math.max(0.0001, this.stepFrequency);
            this.randomTimer += delta;
            while (this.randomTimer >= stepPeriod) {
                this.randomTimer -= stepPeriod;
                // Sample the current oscillator phase
                const elapsed = this.context.currentTime - this.startTime;
                const oscillatorPhase = (elapsed * freq) % 1;
                this.steppedValue = Math.sin(oscillatorPhase * Math.PI * 2);
            }
            // Hold the last sampled value
            const value = this.center + this.depth * this.steppedValue;
            if (this.offsetSource && this.context) {
                this.offsetSource.offset.setValueAtTime(value, this.context.currentTime);
            }
            this.updateCurrentValue(value);
            return;
        }
        
        if (this.randomMode) {
            const period = 1 / Math.max(0.0001, freq);
            this.randomTimer += delta;
            let sampled = false;
            while (this.randomTimer >= period) {
                this.randomTimer -= period;
                this.triggerRandomSample(this.context);
                sampled = true;
            }
            if (!sampled) {
                const value = this.center + this.depth * this.randomValue;
                this.updateCurrentValue(value);
            }
            return;
        }

        const depth = this.depth;
        const center = this.center;
        this.phase = (this.phase + delta * Math.max(0.0001, freq)) % 1;
        const p = this.phase;
        let shape;
        switch (this.waveformIndex) {
            case 0:
                shape = Math.sin(p * Math.PI * 2);
                break;
            case 1:
                if (p < 0.25) shape = p * 4;
                else if (p < 0.75) shape = 2 - p * 4;
                else shape = p * 4 - 4;
                break;
            case 2:
                shape = (2 * p) - 1;
                break;
            case 3:
                shape = p < 0.5 ? 1 : -1;
                break;
            default:
                shape = Math.sin(p * Math.PI * 2);
                break;
        }
        const value = center + depth * shape;
        this.updateCurrentValue(value);
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

    setDepth(value, ctx) {
        this.depth = value;
        this.updateDepthGain(ctx || this.context);
        if (this.steppedMode) {
            const context = ctx || this.context;
            if (this.offsetSource && context) {
                const target = this.center + this.depth * this.steppedValue;
                this.offsetSource.offset.setTargetAtTime(target, context.currentTime, 0.02);
                this.updateCurrentValue(target);
            }
        } else if (this.randomMode) {
            const context = ctx || this.context;
            if (this.offsetSource && context) {
                const target = this.center + this.depth * this.randomValue;
                this.offsetSource.offset.setTargetAtTime(target, context.currentTime, 0.02);
                this.updateCurrentValue(target);
            }
        }
    }

    setCenter(value, ctx) {
        this.center = value;
        const context = ctx || this.context;
        if (!this.offsetSource || !context) return;
        let target;
        if (this.steppedMode) {
            target = value + this.depth * this.steppedValue;
        } else if (this.randomMode) {
            target = value + this.depth * this.randomValue;
        } else {
            target = value;
        }
        this.offsetSource.offset.setTargetAtTime(target, context.currentTime, 0.02);
        this.updateCurrentValue(target);
    }

    setWaveform(value, ctx) {
        const context = ctx || this.context;
        const idx = Math.max(0, Math.min(this.waveforms.length - 1, Math.round(value)));
        this.waveformIndex = idx;
        this.steppedMode = this.waveforms[idx] === 'stepped';
        this.randomMode = this.waveforms[idx] === 'random';
        if (this.params && this.params[3]) {
            this.params[3].effectiveValue = idx;
        }
        
        if (this.steppedMode) {
            this.randomTimer = 0;
            this.steppedPhase = 0;
            this.steppedValue = 0;
            this.updateDepthGain(context);
            if (this.offsetSource && context) {
                this.offsetSource.offset.setTargetAtTime(this.center, context.currentTime, 0.02);
            }
            if (this.params && this.params[4]) {
                this.params[4].hidden = false;
                this.computeHeight();
            }
            this.triggerSteppedSample(context);
        } else if (this.randomMode) {
            this.randomTimer = 0;
            this.randomValue = 0;
            this.updateDepthGain(context);
            if (this.offsetSource && context) {
                this.offsetSource.offset.setTargetAtTime(this.center, context.currentTime, 0.02);
            }
            this.triggerRandomSample(context);
        } else {
            if (this.params && this.params[4]) {
                this.params[4].hidden = true;
                this.computeHeight();
            }
            if (this.oscillator) {
                this.oscillator.type = this.waveforms[idx];
            }
            this.updateDepthGain(context);
            if (this.offsetSource && context) {
                this.offsetSource.offset.setTargetAtTime(this.center, context.currentTime, 0.02);
            }
            this.updateCurrentValue(this.center);
        }
    }

    updateDepthGain(ctx) {
        const context = ctx || this.context;
        if (!this.amplitude || !context) return;
        const now = context.currentTime;
        const target = (this.randomMode || this.steppedMode) ? 0 : this.depth;
        this.amplitude.gain.setTargetAtTime(target, now, 0.02);
    }

    triggerSteppedSample(ctx) {
        this.steppedPhase = 0;
        this.steppedValue = 0;
        const target = this.center;
        const context = ctx || this.context;
        if (this.offsetSource && context) {
            this.offsetSource.offset.setTargetAtTime(target, context.currentTime, 0.02);
        }
        this.updateCurrentValue(target);
    }

    triggerRandomSample(ctx) {
        const context = ctx || this.context;
        this.randomValue = Math.random() * 2 - 1;
        const target = this.center + this.depth * this.randomValue;
        if (this.offsetSource && context) {
            this.offsetSource.offset.setTargetAtTime(target, context.currentTime, 0.02);
        }
        this.updateCurrentValue(target);
    }

    updateCurrentValue(value) {
        if (Math.abs(value - this.currentValue) < 1e-4) return;
        this.currentValue = value;
        this.notifySubscribers();
    }

    onRemoved() {
        if (this.oscillator) {
            try { this.oscillator.stop(); } catch (e) { }
            this.oscillator.disconnect();
            this.oscillator = null;
        }
        if (this.offsetSource) {
            try { this.offsetSource.stop(); } catch (e) { }
            this.offsetSource.disconnect();
            this.offsetSource = null;
        }
        if (this.amplitude) {
            this.amplitude.disconnect();
            this.amplitude = null;
        }
        if (this.outputGain) {
            try { this.outputGain.disconnect(); } catch (e) { }
            this.outputGain = null;
        }
        this.app.unregisterDynamicNode(this);
    }
}
