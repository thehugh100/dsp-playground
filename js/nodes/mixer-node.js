import { DSPNode } from '../core/dsp-node.js';

export class MixerNodeUI extends DSPNode {
    constructor(x, y, app) { super(x, y, 'Mixer (4ch)', app); this.type = 'mixer'; this.width = 160; }
    initAudio(ctx) {
        this.outNode = ctx.createGain();
        this.gains = [];
        this.inputs = [];

        for (let i = 0; i < 4; i++) {
            const g = ctx.createGain();
            g.connect(this.outNode);
            this.gains.push(g);
            this.inputs.push({ name: `In ${i + 1}`, id: i, node: g });
        }

        this.outputs = [{ name: 'Mix Out', id: 0, node: this.outNode }];

        this.params = this.gains.map((g, i) => ({
            label: `Ch ${i + 1} Vol`, type: 'range', value: 0.8, min: 0, max: 1, scale: 'linear',
            onChange: (v) => g.gain.setTargetAtTime(v, ctx.currentTime, 0.01)
        }));
        this.initializeParams();
        this.computeHeight();
    }
}
