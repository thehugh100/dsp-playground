import { DSPNode } from '../core/dsp-node.js';

export class InverterNodeUI extends DSPNode {
    constructor(x, y, app) {
        super(x, y, 'Inverter', app);
        this.type = 'inverter';
        this.width = 130;
    }

    initAudio(ctx) {
        this.node = ctx.createGain();
        this.node.gain.value = -1;

        this.inputs = [{ name: 'In', id: 0, node: this.node }];
        this.outputs = [{ name: 'Out', id: 0, node: this.node }];

        this.params = [{
            label: 'Gain', type: 'range', value: -1, min: -2, max: 2, scale: 'linear',
            onChange: (v) => this.node.gain.setTargetAtTime(v, ctx.currentTime, 0.01)
        }];

        this.initializeParams();
        this.computeHeight();
    }
}
