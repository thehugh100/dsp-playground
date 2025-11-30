import { DSPNode } from '../core/dsp-node.js';

export class SynthNodeUI extends DSPNode {
    constructor(x, y, app) { super(x, y, 'Synth', app); this.type = 'synth'; }
    initAudio(ctx) {
        this.tag = Math.random().toString(36).slice(2, 6);

        this.outputNode = ctx.createGain();
        this.outputNode._debugLabel = `Synth Out [${this.tag}]`;

        this.waves = ['sine', 'triangle', 'sawtooth', 'square'];
        this.currentWaveIndex = 2;

        this.voiceCount = 8;
        this.voices = [];
        for (let i = 0; i < this.voiceCount; i++) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            gain.gain.value = 0;
            osc.connect(gain);
            gain.connect(this.outputNode);
            osc.start();
            this.voices.push({ osc, gain, inUse: false, noteNumber: null, lastUsed: 0, releaseEndTime: 0 });
        }

        this.env = {
            attack: 0.001,
            decay: 0.1,
            sustain: 0.7,
            release: 0.3
        };

        this.inputs = [];
        this.outputs = [{ name: 'Out', id: 0, node: this.outputNode }];

        this.nonZero = 1e-5;
        
        //waveform selector param (slider)

        this.params = [
            {   
                label: 'Waveform', type: 'range', value: 2, min: 0, max: 3, step: 1, scale: 'linear',
                onChange: (v) => {
                    this.setWaveform(Math.max(0, Math.min(this.waves.length - 1, Math.round(v))));
                }
            },
            {
                label: 'Attack', type: 'range',
                value: this.env.attack, min: 0.001, max: 2, step: 0.001, scale: 'linear',
                onChange: (v) => { this.env.attack = Number(v); }
            },
            {
                label: 'Decay', type: 'range',
                value: this.env.decay, min: 0.001, max: 2, step: 0.001, scale: 'linear',
                onChange: (v) => { this.env.decay = Number(v); }
            },
            {
                label: 'Sustain', type: 'range',
                value: this.env.sustain, min: 0, max: 1, step: 0.01, scale: 'linear',
                onChange: (v) => { this.env.sustain = Number(v); }
            },
            {
                label: 'Release', type: 'range',
                value: this.env.release, min: 0.001, max: 5, step: 0.001, scale: 'linear',
                onChange: (v) => { this.env.release = Number(v); }
            }
        ];
        this.initializeParams();
        this.computeHeight();
    }

    setWaveform(newIndex) {
        this.currentWaveIndex = newIndex;
        for (const voice of this.voices) {
            voice.osc.type = this.waves[this.currentWaveIndex];
        }
    }

    findFreeVoice(noteNumber) {
        // Find a free voice or steal the oldest one
        // If the note is already playing, return that voice
        const existingVoice = this.voices.find(v => v.inUse && v.noteNumber === noteNumber);
        if (existingVoice) return existingVoice;

        let freeVoice = this.voices.find(v => !v.inUse);
        if (!freeVoice) {
            freeVoice = this.voices.reduce((oldest, v) => 
                (v.lastUsed < oldest.lastUsed ? v : oldest), this.voices[0]);
        }
        return freeVoice;
    }

    midiNoteOn(noteNumber) {
        const voice = this.findFreeVoice(noteNumber);
        voice.inUse = true;
        voice.noteNumber = noteNumber;

        const ctx = this.outputNode.context;
        const now = ctx.currentTime;
        const frequency = 440 * Math.pow(2, (noteNumber - 69) / 12);
        voice.osc.frequency.setValueAtTime(frequency, now);

        const g = voice.gain.gain;
        const peak = 1 / this.voiceCount; // max amplitude per voice

        // Clear any old automation for this voice
        g.cancelScheduledValues(now);

        // Start from 0, Attack -> Decay -> Sustain
        g.setValueAtTime(0, now);
        g.linearRampToValueAtTime(peak, now + this.env.attack); // Attack
        g.exponentialRampToValueAtTime(
            Math.max(this.nonZero, peak * this.env.sustain),
            now + this.env.attack + this.env.decay
        ); // Decay -> Sustain level


        voice.lastUsed = Date.now();
        this.app.lastAudioSourceNode = this; // Set as active source
    }

    midiNoteOff(noteNumber) {
        const voice = this.voices.find(v => v.inUse && v.noteNumber === noteNumber);
        if (!voice) return;

        const ctx = this.outputNode.context;
        const now = ctx.currentTime;
        const g = voice.gain.gain;

        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        const releaseEnd = now + this.env.release;
        g.exponentialRampToValueAtTime(this.nonZero, releaseEnd);

        voice.releaseEndTime = releaseEnd;
    }

    onRemoved() {
        try {
            this.inputNode.disconnect();
        } catch (e) { }
        try {
            this.outputNode.disconnect();
        } catch (e) { }

        for (const voice of this.voices) {
            try {
                voice.osc.stop();
                voice.osc.disconnect();
            } catch (e) { }
            try {
                voice.gain.disconnect();
            } catch (e) { }
        }
    }

}
