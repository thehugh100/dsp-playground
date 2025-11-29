/* AUDIO SYNTHESIS UTILS */
export const AudioUtils = {
    ctx: null,
    init(ctx) { this.ctx = ctx; },

    createNoise(duration = 1.0) {
        if (!this.ctx) return null;
        const size = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, size, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
        return buffer;
    },

    // Helper math for log sliders
    toLog(position, min, max) {
        // position 0..1
        const minv = Math.log(min);
        const maxv = Math.log(max);
        const scale = maxv - minv;
        return Math.exp(minv + scale * position);
    },

    fromLog(value, min, max) {
        // value min..max -> returns 0..1
        const minv = Math.log(min);
        const maxv = Math.log(max);
        const scale = maxv - minv;
        return (Math.log(value) - minv) / scale;
    }
};
