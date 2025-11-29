import { DSPNode } from '../core/dsp-node.js';

export class EnvelopeFollowerNode extends DSPNode {
    constructor(x, y, app) {
        super(x, y, 'Envelope Follower', app);
        this.type = 'envelope-follower';
        this.width = 180;

        this.params = [
            {
                label: 'Attack (ms)',
                value: 10,
                min: 0.1,
                max: 500,
                step: 0.1,
                onChange: (v) => {
                    if (this.workletNode) {
                        this.workletNode.parameters.get('attack').setValueAtTime(v, this.app.audioCtx.currentTime);
                    }
                }
            },
            {
                label: 'Release (ms)',
                value: 100,
                min: 0.1,
                max: 2000,
                step: 0.1,
                onChange: (v) => {
                    if (this.workletNode) {
                        this.workletNode.parameters.get('release').setValueAtTime(v, this.app.audioCtx.currentTime);
                    }
                }
            },
            {
                label: 'Gain',
                value: 1,
                min: 0,
                max: 10,
                step: 0.01,
                onChange: (v) => {
                    if (this.workletNode) {
                        this.workletNode.parameters.get('gain').setValueAtTime(v, this.app.audioCtx.currentTime);
                    }
                }
            }
        ];

        this.setupParameterIO();
        this.outputs = [{ name: 'Envelope', id: 0, node: null }];
        this.inputs = [{ name: 'Audio In', id: 0, node: null }];
        
        // For parameter modulation (matching LFO pattern)
        this.currentValue = 0;
        this.subscribers = [];
        this.analyserNode = null;
        this.timeBuffer = null;
        
        this.computeHeight();
    }

    static workletRegistered = false;

    static async ensureWorklet(ctx) {
        if (EnvelopeFollowerNode.workletRegistered) return;
        try {
            await ctx.audioWorklet.addModule('js/worklets/envelope-follower-processor.js');
            EnvelopeFollowerNode.workletRegistered = true;
            console.log('Envelope Follower worklet registered');
        } catch (err) {
            console.error('Failed to register envelope follower worklet:', err);
            throw err;
        }
    }

    async initAudio(ctx) {
        this.tag = Math.random().toString(36).slice(2, 6);

        try {
            // Ensure worklet is loaded
            await EnvelopeFollowerNode.ensureWorklet(ctx);

            // Create worklet node
            this.workletNode = new AudioWorkletNode(ctx, 'envelope-follower-processor', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [2]
            });
            this.workletNode._debugLabel = `Envelope Follower Worklet [${this.tag}]`;

            // Set initial parameter values
            this.workletNode.parameters.get('attack').setValueAtTime(this.params[0].value, ctx.currentTime);
            this.workletNode.parameters.get('release').setValueAtTime(this.params[1].value, ctx.currentTime);
            this.workletNode.parameters.get('gain').setValueAtTime(this.params[2].value, ctx.currentTime);

            // Create analyser to read the envelope output
            this.analyserNode = ctx.createAnalyser();
            this.analyserNode._debugLabel = `Envelope Follower Analyser [${this.tag}]`;
            this.analyserNode.fftSize = 256;
            this.analyserNode.smoothingTimeConstant = 0.8;
            this.analyserBuffer = new Uint8Array(this.analyserNode.frequencyBinCount);
            this.timeBuffer = new Float32Array(this.analyserNode.fftSize);
            
            // Connect worklet to analyser for reading values
            this.workletNode.connect(this.analyserNode);

            // Update inputs and outputs
            this.inputs[0].node = this.workletNode;
            this.outputs[0].node = this.workletNode;
            
            // Register as dynamic node for tick updates
            if (this.app && typeof this.app.registerDynamicNode === 'function') {
                this.app.registerDynamicNode(this);
            }

        } catch (err) {
            console.error('Envelope Follower initialization failed:', err);
            // Fallback: create a simple gain node as placeholder
            const fallback = ctx.createGain();
            fallback._debugLabel = `Envelope Follower Fallback [${this.tag}]`;
            fallback.gain.value = 0;
            this.inputs[0].node = fallback;
            this.outputs[0].node = fallback;
        }
    }

    onRemoved() {
        if (this.workletNode) {
            try {
                this.workletNode.disconnect();
            } catch (e) {
                console.warn('Error disconnecting envelope follower worklet:', e);
            }
        }
        if (this.analyserNode) {
            try {
                this.analyserNode.disconnect();
            } catch (e) {
                console.warn('Error disconnecting envelope follower analyser:', e);
            }
        }
        if (this.app && typeof this.app.unregisterDynamicNode === 'function') {
            this.app.unregisterDynamicNode(this);
        }
    }

    getValue() {
        return this.currentValue;
    }

    addSubscriber(node, paramIndex) {
        this.subscribers.push({ node, paramIndex });
    }

    removeSubscriber(node, paramIndex) {
        this.subscribers = this.subscribers.filter(s => !(s.node === node && s.paramIndex === paramIndex));
    }

    notifySubscribers() {
        this.subscribers.forEach(({ node, paramIndex }) => {
            if (node && typeof node.updateParam === 'function') {
                node.updateParam(paramIndex);
            }
        });
    }

    updateCurrentValue(value) {
        if (Math.abs(value - this.currentValue) < 1e-4) return;
        this.currentValue = value;
        this.notifySubscribers();
    }

    tick(delta, time) {
        // Continuously read envelope value and update subscribers
        if (this.analyserNode && this.timeBuffer) {
            // Read time domain data from the analyser
            this.analyserNode.getFloatTimeDomainData(this.timeBuffer);
            
            // The envelope follower outputs a DC signal representing the envelope
            // Average absolute values to get the current envelope level
            let sum = 0;
            for (let i = 0; i < this.timeBuffer.length; i++) {
                sum += Math.abs(this.timeBuffer[i]);
            }
            const envelopeValue = sum / this.timeBuffer.length;
            
            this.updateCurrentValue(envelopeValue);
        }
    }
}
