import { DSPNode } from '../core/dsp-node.js';

export class CombNodeUI extends DSPNode {
    constructor(x, y, app) {
        super(x, y, 'Comb (FB)', app);
        this.type = 'comb';
    }

    initAudio(ctx) {
        this.inputGain = ctx.createGain();
        this.output = ctx.createGain();

        // The Loop Components
        this.delay = ctx.createDelay(1.0); // Max 1 second
        this.feedbackGain = ctx.createGain();
        this.dampFilter = ctx.createBiquadFilter();

        this.dampFilter.type = 'lowpass';
        this.dampFilter.Q.value = -3.0;
        this.dampFilter.frequency.value = 6000; // Default "Open" frequency

        // 2. Delay defaults
        this.delay.delayTime.value = 0.04;

        // 3. Initial Gain
        this.feedbackGain.gain.value = 0.7;

        // --- Topology: Input -> Delay -> Filter -> Feedback -> Delay ---

        // Signal enters
        this.inputGain.connect(this.delay);

        this.delay.connect(this.output);

        // Feedback Loop
        this.delay.connect(this.dampFilter);
        this.dampFilter.connect(this.feedbackGain);
        this.feedbackGain.connect(this.delay);

        // --- IO Setup ---
        this.inputs = [{ name: 'In', id: 0, node: this.inputGain }];
        this.outputs = [{ name: 'Out', id: 0, node: this.output }];

        // --- Parameters ---
        this.params = [
            {
                label: 'Delay (ms)', type: 'range', value: 40, min: 1, max: 100, scale: 'linear',
                onChange: (v) => this.setDelayTime(v, ctx)
            },
            {
                label: 'Feedback', type: 'range', value: 0.5, min: 0, max: 1, scale: 'linear',
                onChange: (v) => this.setFeedback(v, ctx)
            },
            {
                label: 'Damp', type: 'range', value: 0.5, min: 0, max: 1, scale: 'linear',
                onChange: (v) => this.setDamp(v, ctx)
            }
        ];

        // Allow your presets to modulate damp/feedback
        this.params[1].modulationStrategy = 'override';
        this.params[2].modulationStrategy = 'override';

        // Initialize
        this.initializeParams();
        this.computeHeight();
    }

    setDelayTime(v, ctx) {
        // Smooth transition to prevent zipper noise
        this.delay.delayTime.setTargetAtTime(v / 1000, ctx.currentTime, 0.02);
    }

    setFeedback(v, ctx) {
        const min = 0;
        const max = 1;
        const scaledGain = min + (v * (max - min));

        this.feedbackGain.gain.setTargetAtTime(scaledGain, ctx.currentTime, 0.02);
    }

    setDamp(v, ctx) {
        // Damp = 0 -> Filter Open.
        // Damp = 1 -> Filter Closed.

        const minFreq = 100;
        const maxFreq = 20000;

        // Logarithmic mapping acts more like the linear coefficient of the original algorithm
        // Damp 0 = maxFreq, Damp 1 = minFreq
        const frequency = minFreq * Math.pow(maxFreq / minFreq, 1 - v);

        this.dampFilter.frequency.setTargetAtTime(frequency, ctx.currentTime, 0.02);
    }
}
