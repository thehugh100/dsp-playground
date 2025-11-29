import { DSPNode } from '../core/dsp-node.js';

export class GainNodeUI extends DSPNode {
    constructor(x, y, app) { super(x, y, 'Gain', app); this.type = 'gain'; }
    initAudio(ctx) {
        this.tag = Math.random().toString(36).slice(2, 6);

        this.inputNode = ctx.createGain();
        this.inputNode._debugLabel = `Gain In [${this.tag}]`;
        this.outputNode = ctx.createGain();
        this.outputNode._debugLabel = `Gain Out [${this.tag}]`;
        this.inputNode.connect(this.outputNode);

        this.inputs = [{ name: 'In', id: 0, node: this.inputNode }];
        this.outputs = [{ name: 'Out', id: 0, node: this.outputNode }];

        this.params = [{
            label: 'Level', type: 'range', value: 1.0, min: 0, max: 2, scale: 'linear',
            onChange: (v) => this.outputNode.gain.setTargetAtTime(v, ctx.currentTime, 0.01)
        }];
        this.initializeParams();
        this.computeHeight();
    }

    onRemoved() {
        try {
            this.inputNode.disconnect();
        } catch (e) { }
        try {
            this.outputNode.disconnect();
        } catch (e) { }
    }

}
