import { DSPNode } from '../core/dsp-node.js';

export class MultiplyNodeUI extends DSPNode {
    constructor(x, y, app) {
        super(x, y, 'Multiply', app);
        this.type = 'multiply';
        this.width = 150;
        this.context = null;
        this.constant = null;
        this.outputGain = null;
        this.signalValue = 0;
        this.factorValue = 1;
        this.currentValue = 0;
        this.subscribers = [];
    }

    initAudio(ctx) {
        this.context = ctx;
        this.constant = ctx.createConstantSource();
        this.constant.offset.value = 0;
        this.constant.start();

        this.outputGain = ctx.createGain();
        this.outputGain.gain.value = 1;
        this.constant.connect(this.outputGain);

        this.inputs = [];
        this.outputs = [{ name: 'Out', id: 0, node: this.outputGain }];

        this.params = [
            {
                label: 'Input', type: 'range', value: 0, min: -1, max: 1, scale: 'linear',
                modulationStrategy: 'override',
                onChange: (v) => {
                    this.signalValue = Number.isFinite(v) ? v : 0;
                    this.updateOutput(ctx);
                }
            },
            {
                label: 'Factor', type: 'range', value: 1, min: -10000, max: 10000, scale: 'signedPow', power: 3,
                modulationStrategy: 'override',
                onChange: (v, meta) => {
                    const limit = 10000;
                    const safe = Math.max(-limit, Math.min(limit, Number.isFinite(v) ? v : 0));
                    this.factorValue = safe;
                    const paramRef = this.params && this.params[1];
                    if (paramRef) {
                        if (!meta || meta.fromAutomation !== true) {
                            paramRef.value = safe;
                        }
                        paramRef.effectiveValue = safe;
                    }
                    this.updateOutput(ctx);
                }
            }
        ];

        this.initializeParams();
        this.computeHeight();
        this.updateOutput(ctx);
    }

    updateOutput(ctxOverride) {
        const next = this.signalValue * this.factorValue;
        if (!Number.isFinite(next)) return;
        const changed = Math.abs(next - this.currentValue) > 1e-6;
        this.currentValue = next;
        const ctx = ctxOverride || this.context;
        if (this.constant) {
            if (ctx) {
                this.constant.offset.setTargetAtTime(next, ctx.currentTime, 0.01);
            } else {
                this.constant.offset.value = next;
            }
        }
        if (changed) {
            this.notifySubscribers();
        }
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
        if (this.constant) {
            try { this.constant.stop(); } catch (e) { }
            try { this.constant.disconnect(); } catch (e) { }
            this.constant = null;
        }
        if (this.outputGain) {
            try { this.outputGain.disconnect(); } catch (e) { }
            this.outputGain = null;
        }
        this.subscribers = [];
        this.context = null;
        this.currentValue = 0;
    }
}
