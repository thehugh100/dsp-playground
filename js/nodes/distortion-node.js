import { DSPNode } from '../core/dsp-node.js';

export class DistortionNodeUI extends DSPNode {
    constructor(x, y, app) {
        super(x, y, 'Distortion', app);
        this.type = 'distortion';
        this.width = 170;
        this.context = null;
        this.driveValue = 0.5;
        this.preGainValue = 1;
        this.mixValue = 0.75;
        this.inputNode = null;
        this.outputNode = null;
        this.preGain = null;
        this.waveShaper = null;
        this.dryGain = null;
        this.wetGain = null;
    }

    initAudio(ctx) {
        this.context = ctx;

        this.inputNode = ctx.createGain();
        this.outputNode = ctx.createGain();
        this.preGain = ctx.createGain();
        this.waveShaper = ctx.createWaveShaper();
        this.waveShaper.oversample = '4x';
        this.dryGain = ctx.createGain();
        this.wetGain = ctx.createGain();

        this.inputs = [{ name: 'In', id: 0, node: this.inputNode }];
        this.outputs = [{ name: 'Out', id: 0, node: this.outputNode }];

        this.inputNode.connect(this.dryGain);
        this.dryGain.connect(this.outputNode);
        this.inputNode.connect(this.preGain);
        this.preGain.connect(this.waveShaper);
        this.waveShaper.connect(this.wetGain);
        this.wetGain.connect(this.outputNode);

        this.params = [
            {
                label: 'Drive', type: 'range', value: this.driveValue,
                min: 0, max: 1, scale: 'linear',
                onChange: (v) => this.setDrive(v)
            },
            {
                label: 'Pre Gain', type: 'range', value: this.preGainValue,
                min: 0, max: 20, scale: 'linear',
                onChange: (v) => this.setPreGain(v, ctx)
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

    setDrive(value) {
        this.driveValue = value;
        if (!this.waveShaper) return;
        const amount = Math.max(0, value) * 100;
        this.waveShaper.curve = this.makeDistortionCurve(amount);
    }

    setPreGain(value, ctx) {
        this.preGainValue = value;
        const context = ctx || this.context;
        if (this.preGain && context) {
            this.preGain.gain.setTargetAtTime(value, context.currentTime, 0.01);
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

    makeDistortionCurve(amount) {
        const k = amount;
        const samples = 44100;
        const curve = new Float32Array(samples);
        for (let i = 0; i < samples; i++) {
            const x = i * 2 / samples - 1;
            curve[i] = (1 + k) * x / (1 + k * Math.abs(x));
        }
        return curve;
    }

    onRemoved() {
        if (this.waveShaper) {
            try { this.waveShaper.disconnect(); } catch (e) { }
            this.waveShaper = null;
        }
    }
}
