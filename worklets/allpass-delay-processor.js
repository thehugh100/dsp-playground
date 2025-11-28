'use strict';

class AllpassDelayProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            {
                name: 'delaySamples',
                defaultValue: 2400,
                minValue: 1,
                maxValue: 192000,
                automationRate: 'k-rate'
            },
            {
                name: 'gain',
                defaultValue: 0.5,
                minValue: -0.999,
                maxValue: 0.999,
                automationRate: 'k-rate'
            }
        ];
    }

    constructor(options = {}) {
        super();
        const opts = options.processorOptions || {};
        const proposed = typeof opts.maxDelaySamples === 'number' ? opts.maxDelaySamples : (sampleRate * 0.2);
        this.maxDelaySamples = Math.max(2, Math.floor(proposed));
        const proposedDefault = typeof opts.defaultDelaySamples === 'number' ? opts.defaultDelaySamples : (sampleRate * 0.05);
        this.defaultDelaySamples = Math.min(this.maxDelaySamples - 1, Math.max(1, Math.floor(proposedDefault)));
        this.state = [];
        this.port.onmessage = this.handleMessage.bind(this);
    }

    ensureState(count) {
        while (this.state.length < count) {
            this.state.push({
                buffer: new Float32Array(this.maxDelaySamples + 4),
                writeIndex: 0
            });
        }
    }

    resizeBuffers(newMax) {
        const target = Math.max(2, Math.floor(newMax));
        if (target === this.maxDelaySamples) return;
        this.maxDelaySamples = target;
        for (let i = 0; i < this.state.length; i++) {
            const prev = this.state[i];
            const buffer = new Float32Array(this.maxDelaySamples + 4);
            const copyCount = Math.min(prev.buffer.length, buffer.length);
            if (copyCount > 0) buffer.set(prev.buffer.subarray(0, copyCount));
            this.state[i] = { buffer, writeIndex: prev.writeIndex % buffer.length };
        }
    }

    handleMessage(event) {
        const data = event.data;
        if (!data || typeof data !== 'object') return;
        if (data.type === 'reset') {
            for (let i = 0; i < this.state.length; i++) {
                const st = this.state[i];
                st.buffer.fill(0);
                st.writeIndex = 0;
            }
        } else if (data.type === 'configure' && typeof data.maxDelaySamples === 'number') {
            this.resizeBuffers(data.maxDelaySamples);
        }
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        if (!output) return true;

        const frames = output[0].length;
        const delayParam = parameters.delaySamples;
        const gainParam = parameters.gain;
        const channelCount = output.length;
        this.ensureState(channelCount);

        for (let ch = 0; ch < channelCount; ch++) {
            const state = this.state[ch];
            const buffer = state.buffer;
            const bufLen = buffer.length;
            let writeIndex = state.writeIndex;
            const inChan = input[ch] || input[0] || [];
            const outChan = output[ch];

            for (let i = 0; i < frames; i++) {
                const gainValue = gainParam.length > 1 ? gainParam[i] : (gainParam[0] ?? 0.5);
                const gain = Math.max(-0.999, Math.min(0.999, gainValue));

                let delayValue = delayParam.length > 1 ? delayParam[i] : (delayParam[0] ?? this.defaultDelaySamples);
                if (!Number.isFinite(delayValue)) delayValue = this.defaultDelaySamples;
                const clampedDelay = Math.max(1, Math.min(this.maxDelaySamples - 1, delayValue));

                let readIndex = writeIndex - clampedDelay;
                const bufferLength = bufLen;
                while (readIndex < 0) readIndex += bufferLength;
                while (readIndex >= bufferLength) readIndex -= bufferLength;
                const baseIndex = Math.floor(readIndex);
                const frac = readIndex - baseIndex;
                const nextIndex = (baseIndex + 1) % bufferLength;
                const delayed = buffer[baseIndex] + (buffer[nextIndex] - buffer[baseIndex]) * frac;

                const inputSample = inChan.length > i ? inChan[i] : 0;
                const sumIn = inputSample - gain * delayed;
                buffer[writeIndex] = sumIn;
                writeIndex = (writeIndex + 1) % bufferLength;

                outChan[i] = delayed + gain * sumIn;
            }

            state.writeIndex = writeIndex;
        }

        return true;
    }
}

registerProcessor('allpass-delay-processor', AllpassDelayProcessor);
