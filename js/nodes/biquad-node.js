import { DSPNode } from '../core/dsp-node.js';

export class BiquadNodeUI extends DSPNode {
    constructor(x, y, app, type) {
        const titleMap = {
            lowpass: 'LP Filter',
            highpass: 'HP Filter',
            bandpass: 'BP Filter',
            notch: 'Notch Filter',
            allpass: 'Allpass (Biquad)'
        };
        const typeMap = {
            lowpass: 'lpf',
            highpass: 'hpf',
            bandpass: 'bpf',
            notch: 'notch',
            allpass: 'allpass'
        };
        super(x, y, titleMap[type] || 'Filter', app);
        this.filterType = type;
        this.type = typeMap[type] || 'filter';
    }
    initAudio(ctx) {
        this.node = ctx.createBiquadFilter();
        this.node.type = this.filterType;
        let defaultFreq = 1000;
        if (this.filterType === 'lowpass') defaultFreq = 2000;
        else if (this.filterType === 'highpass') defaultFreq = 500;
        this.node.frequency.value = defaultFreq;
        if (this.filterType === 'notch' || this.filterType === 'bandpass') {
            this.node.Q.value = 1;
        }
        if (this.filterType === 'allpass') {
            this.node.Q.value = 0.707;
        }

        this.inputs = [{ name: 'In', id: 0, node: this.node }];
        this.outputs = [{ name: 'Out', id: 0, node: this.node }];

        this.params = [{
            label: 'Freq (Hz)', type: 'range', value: this.node.frequency.value, min: 20, max: 15000, scale: 'log',
            onChange: (v) => this.node.frequency.setTargetAtTime(v, ctx.currentTime, 0.02)
        },
        {
            label: 'Q', type: 'range', value: this.node.Q.value || 1, min: -3, max: 20, scale: 'linear',
            onChange: (v) => this.node.Q.setTargetAtTime(v, ctx.currentTime, 0.02)
        }];
        this.initializeParams();
        this.computeHeight();
    }
}
