import { DSPNode } from '../core/dsp-node.js';

export class ValueNodeUI extends DSPNode {
    constructor(x, y, app) {
        super(x, y, 'Value', app);
        this.type = 'value';
        this.width = 120;
        this.constant = null;
        this.subscribers = [];
        this.valueTransform = null;
    }

    initAudio(ctx) {
        this.constant = ctx.createConstantSource();
        this.constant.offset.value = 1;
        this.constant.start();

        this.outputGain = ctx.createGain();
        this.constant.connect(this.outputGain);

        this.inputs = [];
        this.outputs = [{ name: 'Out', id: 0, node: this.outputGain }];
        this.params = [{
            label: 'Value', type: 'range', value: 1, min: 0, max: 2, scale: 'linear',
            onChange: (v) => {
                if (this.constant) this.constant.offset.setTargetAtTime(v, ctx.currentTime, 0.01);
                this.notifySubscribers();
            }
        }];
        this.initializeParams();
        this.computeHeight();
    }

    getValue() {
        const param = this.params && this.params[0];
        if (!param) return 1;
        let base;
        if (typeof param.effectiveValue === 'number') base = param.effectiveValue;
        else if (typeof param.value === 'number') base = param.value;
        else base = 1;
        return this.applyValueTransform(base);
    }

    applyValueTransform(value) {
        if (!this.valueTransform || !this.valueTransform.type) return value;
        const transform = this.valueTransform.type;
        if (transform === 'samplesToMs') {
            const sampleRate = (this.app && this.app.audioCtx && this.app.audioCtx.sampleRate) || 44100;
            return (value / sampleRate) * 1000;
        }
        return value;
    }

    setValueTransform(transform) {
        if (!transform) {
            this.valueTransform = null;
        } else if (typeof transform === 'string') {
            this.valueTransform = { type: transform };
        } else {
            this.valueTransform = { ...transform };
        }
        this.notifySubscribers();
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

    getExtraData() {
        const base = super.getExtraData();
        const extra = base ? { ...base } : {};
        if (this.title !== 'Value') extra.title = this.title;
        const param = this.params && this.params[0];
        if (param) {
            const overrides = {};
            if (param.label !== 'Value') overrides.label = param.label;
            if (param.min !== 0) overrides.min = param.min;
            if (param.max !== 2) overrides.max = param.max;
            if (param.step !== undefined) overrides.step = param.step;
            if (param.scale && param.scale !== 'linear') overrides.scale = param.scale;
            if (Object.keys(overrides).length) {
                extra.paramOverrides = { 0: overrides };
            }
        }
        if (this.valueTransform) extra.valueTransform = { ...this.valueTransform };
        return Object.keys(extra).length ? extra : null;
    }

    restoreExtraData(data) {
        super.restoreExtraData(data);
        if (!data) return;
        if (data.title) this.title = data.title;
        if (data.paramOverrides && this.params) {
            const overrides = data.paramOverrides[0];
            if (overrides && this.params[0]) {
                Object.assign(this.params[0], overrides);
            }
        }
        if (data.valueTransform) {
            this.valueTransform = { ...data.valueTransform };
        }
    }

    onRemoved() {
        if (this.constant) {
            try { this.constant.stop(); } catch (e) { }
            this.constant.disconnect();
            this.constant = null;
        }
        if (this.outputGain) {
            try { this.outputGain.disconnect(); } catch (e) { }
            this.outputGain = null;
        }
        this.context = null;
    }
}
