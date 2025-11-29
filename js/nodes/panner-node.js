import { DSPNode } from '../core/dsp-node.js';

export class PannerNodeUI extends DSPNode {
    constructor(x, y, app) { super(x, y, 'Stereo Panner', app); this.type = 'panner'; }
    initAudio(ctx) {
        this.node = ctx.createStereoPanner();
        this.inputs = [{ name: 'In', id: 0, node: this.node }];
        this.outputs = [{ name: 'Out', id: 0, node: this.node }];
        this.params = [{
            label: 'Pan', type: 'range', value: 0, min: -1, max: 1, scale: 'linear',
            onChange: (v) => this.node.pan.setTargetAtTime(v, ctx.currentTime, 0.01)
        }];
        this.initializeParams();
        this.computeHeight();
    }
}
