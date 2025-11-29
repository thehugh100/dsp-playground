import { DSPNode } from '../core/dsp-node.js';

export class AbsoluteNodeUI extends DSPNode {
    constructor(x, y, app) {
        super(x, y, 'Absolute', app);
        this.type = 'abs';
        this.width = 150;
        this.inputNode = null;
        this.shaper = null;
        this.outputGain = null;
    }

    initAudio(ctx) {
        this.inputNode = ctx.createGain();
        this.shaper = ctx.createWaveShaper();
        this.outputGain = ctx.createGain();

        this.shaper.curve = this.makeAbsCurve();
        this.shaper.oversample = '4x';

        this.inputNode.connect(this.shaper);
        this.shaper.connect(this.outputGain);

        this.inputs = [{ name: 'In', id: 0, node: this.inputNode }];
        this.outputs = [{ name: 'Out', id: 0, node: this.outputGain }];

        this.params = [{
            label: 'Scale', type: 'range', value: 1, min: 0, max: 2, scale: 'linear',
            onChange: (v) => this.outputGain.gain.setTargetAtTime(v, ctx.currentTime, 0.01)
        }];

        this.initializeParams();
        this.computeHeight();
    }

    makeAbsCurve() {
        const samples = 65536;
        const curve = new Float32Array(samples);
        for (let i = 0; i < samples; i++) {
            const x = (i / (samples - 1)) * 2 - 1;
            curve[i] = Math.abs(x);
        }
        return curve;
    }

    onRemoved() {
        if (this.shaper) {
            try { this.shaper.disconnect(); } catch (e) { }
            this.shaper = null;
        }
    }
}
