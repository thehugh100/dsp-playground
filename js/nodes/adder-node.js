import { DSPNode } from '../core/dsp-node.js';

export class AdderNodeUI extends DSPNode {
    constructor(x, y, app) {
        super(x, y, 'Adder (3ch)', app);
        this.type = 'adder';
        this.width = 170;
        this.inputGains = [];
        this.sumGain = null;
    }

    initAudio(ctx) {
        this.sumGain = ctx.createGain();
        this.sumGain.gain.value = 1;

        this.inputGains = Array.from({ length: 3 }, () => ctx.createGain());
        this.inputGains.forEach(g => g.connect(this.sumGain));

        this.inputs = this.inputGains.map((g, idx) => ({ name: `In ${idx + 1}`, id: idx, node: g }));
        this.outputs = [{ name: 'Out', id: 0, node: this.sumGain }];

        this.params = this.inputGains.map((g, idx) => ({
            label: `In ${idx + 1} Level`, type: 'range', value: 1, min: -2, max: 2, scale: 'linear',
            onChange: (v) => g.gain.setTargetAtTime(v, ctx.currentTime, 0.01)
        }));

        this.initializeParams();
        this.computeHeight();
    }
}
