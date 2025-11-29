import { DSPNode } from '../core/dsp-node.js';
import { AudioUtils } from '../utils/audio-utils.js';

export class AudioSourceNode extends DSPNode {
    constructor(x, y, app) {
        super(x, y, 'Audio Source', app);
        this.type = 'audio-source';
        this.width = 210;
        this.paramSpacing = 40;
        this.customBuffer = null;
        this.lastType = 'kick'; // For spacebar
        this.baseFrequency = 440;
        this.basePlaybackRate = 1;
        this.noteRelease = 0.3;
        this.micStream = null;
        this.micSource = null;
        this.micActive = false;
        this.micPending = false;
        this.micError = null;
    }

    initAudio(ctx) {
        this.tag = Math.random().toString(36).slice(2, 6);
        this.outNode = ctx.createGain();
        this.outNode._debugLabel = `Audio Source Out [${this.tag}]`;
        this.outputs = [{ name: 'Out', id: 0, node: this.outNode }];
        this.computeHeight();
    }

    isTypePitchable(type) {
        if (type === 'custom') return !!this.customBuffer;
        return type === 'sine' || type === 'saw' || type === 'square' || type === 'triangle';
    }

    isPitchable() {
        return this.isTypePitchable(this.lastType);
    }

    playOscillator(type, frequency, duration = this.noteRelease) {
        const ctx = this.app.audioCtx;
        if (!ctx) return;
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc._debugLabel = `Audio Source - Oscillator [${this.tag}]`;
        osc.type = type === 'saw' ? 'sawtooth' : type;
        osc.frequency.setValueAtTime(frequency, t);
        const gain = ctx.createGain();
        gain._debugLabel = `Audio Source - Oscillator Gain [${this.tag}]`;
        gain.gain.setValueAtTime(0.5, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
        console.log(`Playing oscillator: type=${type}, freq=${frequency}, duration=${duration}`);
        osc.connect(gain).connect(this.outNode);
        console.log('Oscillator connected to output node');
        osc.start(t);
        osc.stop(t + duration);
    }

    playCustomBuffer(rate = 1) {
        const ctx = this.app.audioCtx;
        if (!ctx || !this.customBuffer) return;
        const t = ctx.currentTime;
        const src = ctx.createBufferSource();
        src.buffer = this.customBuffer;
        src.playbackRate.setValueAtTime(rate, t);
        src.connect(this.outNode);
        src.start(t);
    }

    loadCustomSample(file) {
        if (!this.app.audioCtx) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            this.app.audioCtx.decodeAudioData(e.target.result, (buffer) => {
                this.customBuffer = buffer;
                this.basePlaybackRate = 1;
                this.trigger('custom');
            }, (e) => console.error("Error decoding audio data", e));
        };
        reader.readAsArrayBuffer(file);
    }

    async toggleMic() {
        if (!this.app) return;
        await this.app.startAudio();
        if (this.micPending) return;
        this.micPending = true;
        try {
            if (this.micActive) {
                this.stopMic();
                return;
            }
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                this.micError = new Error('Microphone unavailable');
                console.error('Microphone unavailable in this browser');
                return;
            }
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const ctx = this.app.audioCtx;
            if (!ctx) {
                stream.getTracks().forEach(track => track.stop());
                this.micError = new Error('Audio context unavailable');
                return;
            }
            this.micStream = stream;
            this.micSource = ctx.createMediaStreamSource(stream);
            this.micSource.connect(this.outNode);
            this.micActive = true;
            this.micError = null;
        } catch (err) {
            this.micError = err;
            this.stopMic();
            console.error('Microphone access failed', err);
        } finally {
            this.micPending = false;
        }
    }

    stopMic() {
        if (this.micSource) {
            try { this.micSource.disconnect(); } catch (e) { }
            this.micSource = null;
        }
        if (this.micStream) {
            this.micStream.getTracks().forEach(track => {
                try { track.stop(); } catch (e) { }
            });
            this.micStream = null;
        }
        this.micActive = false;
    }

    trigger(type) {
        if (!this.app.audioCtx) return;

        this.lastType = type;
        this.app.lastAudioSourceNode = this; // Register as active for spacebar

        const ctx = this.app.audioCtx;
        const t = ctx.currentTime;
        const out = this.outNode;

        if (type === 'custom' && this.customBuffer) {
            this.basePlaybackRate = 1;
            this.playCustomBuffer(1);
        } else if (type === 'kick') {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.setValueAtTime(150, t);
            osc.frequency.exponentialRampToValueAtTime(0.01, t + 0.5);
            gain.gain.setValueAtTime(1, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
            osc.connect(gain);
            gain.connect(out);
            osc.start(t); osc.stop(t + 0.5);
        } else if (type === 'snare') {
            const noise = ctx.createBufferSource();
            noise.buffer = AudioUtils.createNoise(0.2);
            const nGain = ctx.createGain();
            const nFilter = ctx.createBiquadFilter();
            nFilter.type = 'highpass'; nFilter.frequency.value = 1000;
            nGain.gain.setValueAtTime(1, t); nGain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
            noise.connect(nFilter).connect(nGain).connect(out);
            noise.start(t);

            const osc = ctx.createOscillator();
            const oGain = ctx.createGain();
            osc.frequency.setValueAtTime(250, t); osc.frequency.linearRampToValueAtTime(100, t + 0.1);
            oGain.gain.setValueAtTime(0.5, t); oGain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
            osc.connect(oGain).connect(out);
            osc.start(t); osc.stop(t + 0.2);
        } else if (type === 'hh') {
            const noise = ctx.createBufferSource();
            noise.buffer = AudioUtils.createNoise(0.05);
            const nGain = ctx.createGain();
            const nFilter = ctx.createBiquadFilter();
            nFilter.type = 'highpass'; nFilter.frequency.value = 5000;
            nGain.gain.setValueAtTime(0.6, t); nGain.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
            noise.connect(nFilter).connect(nGain).connect(out);
            noise.start(t);
        } else if (type === 'sine' || type === 'saw' || type === 'square' || type === 'triangle') {
            this.baseFrequency = 440;
            this.playOscillator(type, this.baseFrequency);
        } else if (type === 'noise') {
            const buffer = AudioUtils.createNoise(0.4);
            if (buffer) {
                const noise = ctx.createBufferSource();
                noise.buffer = buffer;
                const gain = ctx.createGain();
                gain.gain.setValueAtTime(0.4, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
                noise.connect(gain).connect(out);
                noise.start(t);
            }
        } else if (type === 'mic') {
            this.toggleMic();
        }
    }

    triggerNote(semitone, octaveOffset = 0) {
        if (!this.app.audioCtx) return;
        if (!this.isPitchable()) return;
        const ratio = Math.pow(2, octaveOffset) * Math.pow(2, semitone / 12);

        if (this.lastType === 'custom') {
            this.playCustomBuffer(this.basePlaybackRate * ratio);
        } else if (this.lastType === 'sine' || this.lastType === 'saw' || this.lastType === 'square' || this.lastType === 'triangle') {
            this.playOscillator(this.lastType, this.baseFrequency * ratio);
        }

        this.app.lastAudioSourceNode = this;
    }

    onRemoved() {
        this.stopMic();
    }
}
