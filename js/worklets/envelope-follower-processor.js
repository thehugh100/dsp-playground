// Envelope Follower AudioWorklet Processor
// Tracks the amplitude envelope of an audio signal
class EnvelopeFollowerProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            {
                name: 'attack',
                defaultValue: 10,
                minValue: 0.1,
                maxValue: 500
            },
            {
                name: 'release',
                defaultValue: 100,
                minValue: 0.1,
                maxValue: 2000
            },
            {
                name: 'gain',
                defaultValue: 1,
                minValue: 0,
                maxValue: 10
            }
        ];
    }

    constructor() {
        super();
        this.envelope = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];

        if (!input || !input.length || !input[0]) {
            // Output silence if no input
            if (output && output.length) {
                for (let channel = 0; channel < output.length; channel++) {
                    output[channel].fill(0);
                }
            }
            return true;
        }

        const inputChannel = input[0];
        const sampleRate = globalThis.sampleRate || 48000;
        const blockSize = inputChannel.length;

        // Get parameters (can be arrays if automated)
        const attack = parameters.attack;
        const release = parameters.release;
        const gain = parameters.gain;

        for (let i = 0; i < blockSize; i++) {
            // Get parameter values (handle both array and constant)
            const attackMs = attack.length > 1 ? attack[i] : attack[0];
            const releaseMs = release.length > 1 ? release[i] : release[0];
            const gainVal = gain.length > 1 ? gain[i] : gain[0];

            // Convert ms to coefficient
            const attackCoeff = Math.exp(-1000 / (attackMs * sampleRate));
            const releaseCoeff = Math.exp(-1000 / (releaseMs * sampleRate));

            // Get input amplitude (absolute value)
            const inputAmp = Math.abs(inputChannel[i]);

            // Follow envelope
            if (inputAmp > this.envelope) {
                // Attack phase
                this.envelope = attackCoeff * this.envelope + (1 - attackCoeff) * inputAmp;
            } else {
                // Release phase
                this.envelope = releaseCoeff * this.envelope + (1 - releaseCoeff) * inputAmp;
            }

            // Output the envelope value with gain applied
            const envelopeOutput = this.envelope * gainVal;

            // Write to all output channels (mono signal)
            if (output && output.length) {
                for (let channel = 0; channel < output.length; channel++) {
                    if (output[channel]) {
                        output[channel][i] = envelopeOutput;
                    }
                }
            }
        }

        return true;
    }
}

registerProcessor('envelope-follower-processor', EnvelopeFollowerProcessor);
