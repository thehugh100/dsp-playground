'use strict';

class SampleHoldProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [{
            name: 'frequency',
            defaultValue: 1000,
            minValue: 0,
            maxValue: 16000,
            automationRate: 'a-rate'
        }];
    }

    constructor() {
        super();
        this._heldValue = 0;
        this._phase = 1;
        this._notifyCountdown = 0;
        this._notifyInterval = Math.max(1, Math.floor(sampleRate / 30));
        this.port.onmessage = (event) => {
            const data = event && event.data;
            if (data && data.type === 'reset') {
                this._heldValue = 0;
                this._phase = 1;
                this._notifyCountdown = 0;
                this.port.postMessage(this._heldValue);
            }
        };
        this.port.postMessage(this._heldValue);
    }

    process(inputs, outputs, parameters) {
        const outputGroup = outputs[0];
        if (!outputGroup || outputGroup.length === 0) {
            return true;
        }

        const outChannel = outputGroup[0];
        const inputGroup = inputs[0];
        const inChannel = inputGroup && inputGroup[0];
        const freqValues = parameters.frequency;
        const freqIsConstant = freqValues.length === 1;
        const invSampleRate = 1 / sampleRate;

        let held = this._heldValue;
        let phase = this._phase;
        let notify = this._notifyCountdown;

        for (let i = 0; i < outChannel.length; i++) {
            const freq = freqIsConstant ? freqValues[0] : freqValues[i];
            const clamped = this._sanitizeFrequency(freq);
            const increment = clamped * invSampleRate;

            phase += increment;
            if (phase >= 1) {
                const source = inChannel ? inChannel[i] : 0;
                if (Number.isFinite(source)) {
                    if (source !== held) {
                        held = source;
                        if (notify <= 0) {
                            this.port.postMessage(held);
                            notify = this._notifyInterval;
                        }
                    } else if (notify <= 0) {
                        this.port.postMessage(held);
                        notify = this._notifyInterval;
                    }
                }
                phase -= Math.floor(phase);
            }

            outChannel[i] = held;

            if (notify > 0) {
                notify -= 1;
            }
        }

        this._heldValue = held;
        this._phase = phase;
        this._notifyCountdown = notify;
        return true;
    }

    _sanitizeFrequency(value) {
        if (!Number.isFinite(value)) return 1000;
        if (value <= 0) return 0;
        const minHz = 0.1;
        const maxHz = Math.min(20000, sampleRate * 0.5);
        if (value < minHz) return minHz;
        if (value > maxHz) return maxHz;
        return value;
    }
}

registerProcessor('sample-hold-processor', SampleHoldProcessor);
