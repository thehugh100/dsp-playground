import { DSPNode } from '../core/dsp-node.js';

export class WetDryNodeUI extends DSPNode {
    constructor(x, y, app) {
        super(x, y, 'Wet/Dry', app);
        this.type = 'wetdry';
        this.width = 160;
        this.blendValue = 0.5;
        this.levelValue = 1;
    }

    initAudio(ctx) {
        this.dryGain = ctx.createGain();
        this.wetGain = ctx.createGain();
        this.outputGain = ctx.createGain();

        this.dryGain.connect(this.outputGain);
        this.wetGain.connect(this.outputGain);

        this.inputs = [
            { name: 'Dry In', id: 0, node: this.dryGain },
            { name: 'Wet In', id: 1, node: this.wetGain }
        ];
        this.outputs = [{ name: 'Mix Out', id: 0, node: this.outputGain }];

        this.params = [
            {
                label: 'Wet/Dry', type: 'range', value: this.blendValue, min: 0, max: 1, scale: 'linear',
                onChange: (v) => this.setBlend(v)
            },
            {
                label: 'Level', type: 'range', value: this.levelValue, min: 0, max: 2, scale: 'linear',
                onChange: (v) => this.setLevel(v, ctx)
            }
        ];

        this.initializeParams();
        this.computeHeight();
        this.refreshGains(ctx);
    }

    setBlend(v) {
        this.blendValue = v;
        this.refreshGains();
    }

    setLevel(v, ctx) {
        this.levelValue = v;
        if (this.outputGain && ctx) {
            this.outputGain.gain.setTargetAtTime(v, ctx.currentTime, 0.01);
        }
    }

    refreshGains(ctxOverride) {
        const ctx = ctxOverride || (this.app ? this.app.audioCtx : null);
        if (!ctx) return;
        const now = ctx.currentTime;
        const angle = this.blendValue * Math.PI * 0.5;
        // Use constant-power law to keep perceived loudness even across the blend.
        const dry = Math.cos(angle);
        const wet = Math.sin(angle);

        if (this.dryGain) {
            this.dryGain.gain.setTargetAtTime(dry, now, 0.01);
        }
        if (this.wetGain) {
            this.wetGain.gain.setTargetAtTime(wet, now, 0.01);
        }
        if (this.outputGain) {
            this.outputGain.gain.setTargetAtTime(this.levelValue, now, 0.01);
        }
    }
}
