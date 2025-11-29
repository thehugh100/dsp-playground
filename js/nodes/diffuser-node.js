import { DSPNode } from '../core/dsp-node.js';

export class DiffuserNodeUI extends DSPNode {
    constructor(x, y, app) {
        super(x, y, 'Diffuser (Smear)', app);
        this.type = 'diffuser';
        this.filterChain = [];
        this.width = 160;
        this.baseFrequencies = [500, 1200, 2500, 4000];
        this.modOscillators = [];
        this.modGains = [];
        this.modDepthValue = 0;
        this.modRateValue = 0.35;
        this.modRateSpread = 0.05;
        this.lfoTuningOffsets = [0, 0.01956954, 0.0142, 0.022352, 0.025535];
    }

    initAudio(ctx) {
        this.cleanupModulation();
        // --- 1. Create Input and Output Gains ---
        this.inputGain = ctx.createGain();
        this.outputGain = ctx.createGain();

        // --- 2. Define Allpass Filter Parameters ---
        // These short, non-harmonic delay times prevent metallic ringing.
        // We simulate a series of first-order APFs by staggering the Biquad center frequencies.
        // This is the default Q value, controlling the amount of phase shift.
        const defaultQ = 2.0;

        // --- 3. Build the Internal Filter Chain (Cascade) ---
        let previousNode = this.inputGain;
        this.filterChain = [];
        this.modOscillators = [];
        this.modGains = [];
        this.baseFrequencies.forEach((freq, index) => {
            const ap = ctx.createBiquadFilter();
            ap.type = 'allpass';
            ap.frequency.value = freq;
            ap.Q.value = defaultQ;

            const modGain = ctx.createGain();
            modGain.gain.value = 0;
            this.modGains.push(modGain);

            const lfo = ctx.createOscillator();
            lfo.type = 'sine';
            lfo.frequency.value = Math.max(0.01, this.modRateValue + (index * this.modRateSpread) + this.lfoTuningOffsets[index]);
            lfo.phase = Math.random() * Math.PI * 2;
            lfo.connect(modGain);
            modGain.connect(ap.frequency);
            lfo.start();
            this.modOscillators.push(lfo);

            // Connect the previous node to this new allpass filter
            previousNode.connect(ap);
            previousNode = ap;
            this.filterChain.push(ap);
        });

        // --- 4. Connect the last filter to the output gain ---
        previousNode.connect(this.outputGain);

        // --- 5. Define I/O Ports ---
        this.inputs = [{ name: 'In', id: 0, node: this.inputGain }];
        this.outputs = [{ name: 'Out', id: 0, node: this.outputGain }];

        // --- 6. Define User Parameters ---
        this.params = [
            {
                label: 'Smear Q',
                type: 'range',
                value: defaultQ,
                min: 0.1,
                max: 10,
                scale: 'linear',
                // When the user changes the Q slider, update ALL internal filters
                onChange: (v) => {
                    this.filterChain.forEach(ap => ap.Q.setTargetAtTime(v, ctx.currentTime, 0.01));
                }
            },
            {
                label: 'Mod Depth',
                type: 'range',
                value: this.modDepthValue,
                min: 0,
                max: 1,
                scale: 'linear',
                onChange: (v) => this.setModDepth(v, ctx)
            },
            {
                label: 'Mod Rate',
                type: 'range',
                value: this.modRateValue,
                min: 0.01,
                max: 20,
                scale: 'log',
                onChange: (v) => this.setModRate(v, ctx)
            }
        ];

        this.initializeParams();
        this.computeHeight();
        this.setModDepth(this.modDepthValue, ctx);
        this.setModRate(this.modRateValue, ctx);
    }

    setModDepth(value, ctx) {
        this.modDepthValue = Math.max(0, value);
        const context = ctx || (this.app && this.app.audioCtx);
        if (!context) return;
        const now = context.currentTime;
        const maxRatio = 0.4;
        this.modGains.forEach((gain, idx) => {
            const base = this.baseFrequencies[idx] || 0;
            const depthHz = base * maxRatio * this.modDepthValue;
            gain.gain.setTargetAtTime(depthHz, now, 0.05);
        });
    }

    setModRate(value, ctx) {
        this.modRateValue = Math.max(0.01, value);
        const context = ctx || (this.app && this.app.audioCtx);
        if (!context) return;
        const now = context.currentTime;
        this.modOscillators.forEach((osc, idx) => {
            const freq = Math.max(0.01, this.modRateValue + (idx * this.modRateSpread) + this.lfoTuningOffsets[idx]);
            osc.frequency.setTargetAtTime(freq, now, 0.05);
        });
    }

    cleanupModulation() {
        if (this.modOscillators) {
            this.modOscillators.forEach(osc => {
                try { osc.stop(); } catch (e) { }
                try { osc.disconnect(); } catch (e) { }
            });
        }
        if (this.modGains) {
            this.modGains.forEach(gain => {
                try { gain.disconnect(); } catch (e) { }
            });
        }
        this.modOscillators = [];
        this.modGains = [];
    }

    onRemoved() {
        this.cleanupModulation();
    }
}
