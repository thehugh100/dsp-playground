import { DSPNode } from '../core/dsp-node.js';

export class MonoNodeUI extends DSPNode {
    constructor(x, y, app) {
        super(x, y, 'Mono', app);
        this.type = 'mono';
        this.width = 140;
        this.inputNode = null;
        this.splitter = null;
        this.sumGain = null;
        this.merger = null;
    }

    initAudio(ctx) {
        this.inputNode = ctx.createGain();
        this.splitter = ctx.createChannelSplitter(2);
        this.sumGain = ctx.createGain();
        this.sumGain.gain.value = 0.5; // average left and right
        this.merger = ctx.createChannelMerger(2);

        this.inputNode.connect(this.splitter);
        this.splitter.connect(this.sumGain, 0);
        this.splitter.connect(this.sumGain, 1);
        this.sumGain.connect(this.merger, 0, 0);
        this.sumGain.connect(this.merger, 0, 1);

        this.inputs = [{ name: 'In', id: 0, node: this.inputNode }];
        this.outputs = [{ name: 'Out', id: 0, node: this.merger }];
        this.params = [];
        this.initializeParams();
        this.computeHeight();
    }

    onRemoved() {
        if (this.inputNode) {
            try { this.inputNode.disconnect(); } catch (e) { }
        }
        if (this.splitter) {
            try { this.splitter.disconnect(); } catch (e) { }
        }
        if (this.sumGain) {
            try { this.sumGain.disconnect(); } catch (e) { }
        }
        if (this.merger) {
            try { this.merger.disconnect(); } catch (e) { }
        }
        this.inputNode = null;
        this.splitter = null;
        this.sumGain = null;
        this.merger = null;
    }
}
