import { DSPNode } from '../core/dsp-node.js';

export class OutputNode extends DSPNode {
    constructor(x, y, app) {
        super(x, y, 'Stereo Output', app);
        this.type = 'output';
        this.width = 140;
        this.analyser = null;
        this.visualData = null;
        
        // Initialize inputs array so node can render before audio starts
        this.inputs = [{ name: 'L/R', id: 0, node: null }];
        this.computeHeight();
    }

    initAudio(ctx) {
        this.tag = Math.random().toString(36).slice(2, 6);
        this.analyser = ctx.createAnalyser();
        this.analyser._debugLabel = `Output Node - Analyser [${this.tag}]`;
        this.analyser.fftSize = 256;
        this.visualData = new Uint8Array(this.analyser.frequencyBinCount);

        this.limiter = ctx.createDynamicsCompressor();
        this.limiter._debugLabel = `Output Node - Limiter [${this.tag}]`;
        this.limiter.threshold.value = -1;
        this.limiter.ratio.value = 20;

        this.analyser.connect(this.limiter);
        this.limiter.connect(ctx.destination);

        this.inputs[0].node = this.analyser;
    }
}
