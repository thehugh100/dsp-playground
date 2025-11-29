import { DSPNode } from '../core/dsp-node.js';

export class FDNNodeUI extends DSPNode {
    constructor(x, y, app) {
        super(x, y, 'FDN (8-Tap Householder)', app);
        this.type = 'fdn-scalable';
        this.width = 180;
        this.N = 8; // 8 Taps

        this.delays = [];
        this.feedbackGains = [];
        this.dampers = [];
        this.lfos = [];
        this.lfoGains = [];

        const sampleRate = 48000;

        this.baseDelays = [
            571 / sampleRate,
            779 / sampleRate,
            903 / sampleRate,
            1127 / sampleRate,
            1349 / sampleRate,
            1491 / sampleRate,
            1557 / sampleRate,
            1617 / sampleRate
        ];

        // LFO Tuning Offsets (in Hz) for Modulation Diversity
        this.lfoTuningOffsets = [0, 0.01, 0.0142, 0.02, 0.025, 0.028235, 0.03151, 0.0343341];

        this.currentSize = 1.0;
        this.currentDecay = 2.0;
        this.modRateBase = 0.1;
        this.modRateSpread = 0.05;
        this.modAmount = 0.5;
    }

    initAudio(ctx) {
        // --- 1. Master I/O ---
        this.inputGain = ctx.createGain();
        this.outputMixer = ctx.createGain();

        // --- 2. Householder Matrix Node ---
        // Formula: Output = Input - (2/N * Sum)
        this.matrixSum = ctx.createGain();

        // CRITICAL FIX: Dynamic scaling based on N. 
        // For N=8, this becomes -0.25. For N=4, it was -0.5.
        const scalingFactor = -2.0 / this.N;
        this.matrixSum.gain.value = scalingFactor;

        // Cleanup
        this.delays = [];
        this.feedbackGains = [];
        this.dampers = [];
        this.lfos = [];
        this.lfoGains = [];

        // --- 3. Construct the Feedback Loops ---
        for (let i = 0; i < this.N; i++) {
            // A. Delay Line
            const delay = ctx.createDelay(1.5); // More headroom for size > 1.0
            delay.delayTime.value = this.baseDelays[i] * this.currentSize;
            this.delays.push(delay);

            // B. Modulation
            const lfo = ctx.createOscillator();
            const freq = Math.max(0.01, this.modRateBase + (i * this.modRateSpread) + this.lfoTuningOffsets[i]);
            lfo.frequency.value = freq;
            lfo.phase = Math.random() * Math.PI * 2; // Random start phase
            const lfoGain = ctx.createGain();
            const depth = Math.max(0, this.modAmount) * 0.001;
            lfoGain.gain.value = depth;

            lfo.connect(lfoGain).connect(delay.delayTime);
            lfo.start();
            this.lfos.push(lfo);
            this.lfoGains.push(lfoGain);

            // C. Feedback Gain
            const fbGain = ctx.createGain();
            fbGain.gain.value = 0.5;
            this.feedbackGains.push(fbGain);

            // D. Color / Stability Filters

            // 1. Highpass (DC Blocker)
            const hpf = ctx.createBiquadFilter();
            hpf.type = 'highpass';
            hpf.frequency.value = 20;
            hpf.Q.value = -3; // Standard Butterworth-ish response

            // 2. Lowpass (Damping)
            // STABILITY FIX: Q=0 is physically accurate (1-pole). 
            // Q=-3 is a hack that isn't needed with correct matrix scaling.
            const lpf = ctx.createBiquadFilter();
            lpf.type = 'lowpass';
            lpf.frequency.value = 15000;
            lpf.Q.value = -3;
            this.dampers.push(lpf);

            // --- WIRING ---

            // 1. Forward Path: Delay -> Gain -> HPF -> LPF
            delay.connect(fbGain);
            fbGain.connect(hpf);
            hpf.connect(lpf);

            // 2. Matrix Injection (Send to Summer)
            lpf.connect(this.matrixSum);

            // 3. Feedback Return (Householder)
            // Input = Self + (Sum * -2/N)
            lpf.connect(delay);
            this.matrixSum.connect(delay);

            // 4. Output Tap
            delay.connect(this.outputMixer);
        }

        // Connect Input
        this.delays.forEach(d => this.inputGain.connect(d));

        // --- 4. Parameters ---
        this.inputs = [{ name: 'In', id: 0, node: this.inputGain }];
        this.outputs = [{ name: 'Out', id: 0, node: this.outputMixer }];

        this.params = [
            {
                label: 'Size (Scale)', type: 'range', value: 1.0, min: 0.1, max: 2.0, scale: 'linear',
                onChange: (v) => this.setSize(v, ctx)
            },
            {
                label: 'Decay (s)', type: 'range', value: 2.0, min: 0.1, max: 10.0, scale: 'log',
                onChange: (v) => this.setDecayTime(v, ctx)
            },
            {
                label: 'Damping', type: 'range', value: 8000, min: 500, max: 20000, scale: 'log',
                onChange: (v) => this.setDamping(v, ctx)
            },
            {
                label: 'Mod Rate', type: 'range', value: this.modRateBase, min: 0.01, max: 5.0, scale: 'log',
                onChange: (v) => this.setModulationRate(v, ctx)
            },
            {
                label: 'Mod Amt', type: 'range', value: this.modAmount, min: 0, max: 4.0, scale: 'linear',
                onChange: (v) => this.setModulationAmount(v, ctx)
            }
        ];

        this.initializeParams();
        this.computeHeight();

        // Initial setup
        this.setSize(1.0, ctx);
        this.setModulationRate(this.modRateBase, ctx);
        this.setModulationAmount(this.modAmount, ctx);
    }

    setSize(scale, ctx) {
        this.currentSize = Math.max(0.01, scale);
        this.delays.forEach((d, i) => {
            const newTime = this.baseDelays[i] * this.currentSize;
            // Limit max delay time to prevent errors
            if (newTime < 4.0) d.delayTime.setTargetAtTime(newTime, ctx.currentTime, 0.05);
        });
        this.setDecayTime(this.currentDecay, ctx);
    }

    setDecayTime(seconds, ctx) {
        this.currentDecay = Math.max(0.01, seconds);

        // 1. Calculate REAL average delay
        // We sum the actual base delays to get a precise average.
        const sumBase = this.baseDelays.reduce((a, b) => a + b, 0);
        const baseAvg = sumBase / this.N;
        const currentAvgTau = baseAvg * this.currentSize;

        // 2. T60 Formula
        let g = Math.pow(10, (-3 * currentAvgTau) / this.currentDecay);

        // 3. Stability Cap
        // 0.997 is the industry standard safety margin for feedback loops.
        g = Math.min(0.997, g);

        this.feedbackGains.forEach(gn => gn.gain.setTargetAtTime(g, ctx.currentTime, 0.02));
    }

    setDamping(freq, ctx) {
        this.dampers.forEach(lpf => lpf.frequency.setTargetAtTime(freq, ctx.currentTime, 0.02));
    }

    setModulationRate(baseRate, ctx) {
        this.modRateBase = Math.max(0.01, baseRate);
        const now = ctx.currentTime;
        this.lfos.forEach((osc, idx) => {
            const freq = Math.max(0.01, this.modRateBase + (idx * this.modRateSpread) + this.lfoTuningOffsets[idx]);
            osc.frequency.setTargetAtTime(freq, now, 0.02);
        });
    }

    setModulationAmount(amount, ctx) {
        this.modAmount = Math.max(0, amount);
        const depth = this.modAmount * 0.001;
        const now = ctx.currentTime;
        this.lfoGains.forEach(gn => gn.gain.setTargetAtTime(depth, now, 0.02));
    }
}
