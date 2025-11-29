import { DSPNode } from '../core/dsp-node.js';

export class DelayNodeUI extends DSPNode {
    constructor(x, y, app) { super(x, y, 'Delay', app); this.type = 'delay'; }
    initAudio(ctx) {
        this.node = ctx.createDelay(5.0);
        this.node.delayTime.value = 0.5;
        this.inputs = [{ name: 'In', id: 0, node: this.node }];
        this.outputs = [{ name: 'Out', id: 0, node: this.node }];
        this.params = [{
            label: 'Time (s)', type: 'range', value: 0.5, min: 0.01, max: 2, scale: 'log',
            onChange: (v) => this.node.delayTime.setTargetAtTime(v, ctx.currentTime, 0.02)
        }];
        this.initializeParams();
        this.computeHeight();
    }
    onRemoved() {
        try {
            this.node.disconnect();
        } catch (e) { }
    }
}
