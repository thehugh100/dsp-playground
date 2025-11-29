import { DSPNode } from '../core/dsp-node.js';

export class RingModNodeUI extends DSPNode {
    constructor(x, y, app) {
        super(x, y, 'Ring Mod', app);
        this.type = 'ringmod';
        this.width = 180;
        this.frequencyValue = 30;
        this.depthValue = 1;
        this.mixValue = 0.5;
        this.context = null;
        this.carrierOsc = null;
        this.carrierGain = null;
        this.inputNode = null;
        this.outputNode = null;
        this.dryGain = null;
        this.wetGain = null;
        this.ringGain = null;
    }

    initAudio(ctx) {
        this.context = ctx;

        this.inputNode = ctx.createGain();
        this.outputNode = ctx.createGain();
        this.dryGain = ctx.createGain();
        this.wetGain = ctx.createGain();
        this.ringGain = ctx.createGain();
        this.ringGain.gain.setValueAtTime(0, ctx.currentTime);

        this.inputs = [{ name: 'In', id: 0, node: this.inputNode }];
        this.outputs = [{ name: 'Out', id: 0, node: this.outputNode }];

        this.inputNode.connect(this.dryGain);
        this.dryGain.connect(this.outputNode);
        this.inputNode.connect(this.ringGain);
        this.ringGain.connect(this.wetGain);
        this.wetGain.connect(this.outputNode);

        this.carrierOsc = ctx.createOscillator();
        this.carrierOsc.type = 'sine';
        this.carrierOsc.frequency.value = this.frequencyValue;
        this.carrierGain = ctx.createGain();
        this.carrierGain.gain.setValueAtTime(this.depthValue, ctx.currentTime);
        this.carrierOsc.connect(this.carrierGain);
        this.carrierGain.connect(this.ringGain.gain);
        this.carrierOsc.start();

        this.params = [
            {
                label: 'Freq (Hz)', type: 'range', value: this.frequencyValue,
                min: 0.5, max: 16000, scale: 'log',
                onChange: (v) => this.setFrequency(v, ctx)
            },
            {
                label: 'Depth', type: 'range', value: this.depthValue,
                min: 0, max: 1, scale: 'linear',
                onChange: (v) => this.setDepth(v, ctx)
            },
            {
                label: 'Mix', type: 'range', value: this.mixValue,
                min: 0, max: 1, scale: 'linear',
                onChange: (v) => this.setMix(v, ctx)
            }
        ];

        this.initializeParams();
        this.computeHeight();
    }

    setFrequency(value, ctx) {
        this.frequencyValue = value;
        const context = ctx || this.context;
        if (this.carrierOsc && context) {
            this.carrierOsc.frequency.setTargetAtTime(value, context.currentTime, 0.01);
        }
    }

    setDepth(value, ctx) {
        this.depthValue = value;
        const context = ctx || this.context;
        if (this.carrierGain && context) {
            this.carrierGain.gain.setTargetAtTime(value, context.currentTime, 0.01);
        }
    }

    setMix(value, ctx) {
        this.mixValue = value;
        const context = ctx || this.context;
        if (!context) return;
        const now = context.currentTime;
        if (this.dryGain) this.dryGain.gain.setTargetAtTime(1 - value, now, 0.01);
        if (this.wetGain) this.wetGain.gain.setTargetAtTime(value, now, 0.01);
    }

    onRemoved() {
        if (this.carrierOsc) {
            try { this.carrierOsc.stop(); } catch (e) { }
            this.carrierOsc.disconnect();
            this.carrierOsc = null;
        }
        if (this.carrierGain) {
            try { this.carrierGain.disconnect(); } catch (e) { }
            this.carrierGain = null;
        }
    }
}
