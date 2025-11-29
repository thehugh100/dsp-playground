import { AudioUtils } from './utils/audio-utils.js';
import { DSPNode } from './core/dsp-node.js';
import { OutputNode } from './nodes/output-node.js';
import { AudioSourceNode } from './nodes/audio-source-node.js';
import { GainNodeUI } from './nodes/gain-node.js';
import { MixerNodeUI } from './nodes/mixer-node.js';
import { WetDryNodeUI } from './nodes/wetdry-node.js';
import { PannerNodeUI } from './nodes/panner-node.js';
import { DelayNodeUI } from './nodes/delay-node.js';
import { BiquadNodeUI } from './nodes/biquad-node.js';
import { CombNodeUI } from './nodes/comb-node.js';
import { AllpassNodeUI } from './nodes/allpass-node.js';
import { DiffuserNodeUI } from './nodes/diffuser-node.js';
import { FDNNodeUI } from './nodes/fdn-node.js';
import { PitchShiftNodeUI } from './nodes/pitch-shifter-node.js';
import { RingModNodeUI } from './nodes/ringmod-node.js';
import { DistortionNodeUI } from './nodes/distortion-node.js';
import { InverterNodeUI } from './nodes/inverter-node.js';
import { AdderNodeUI } from './nodes/adder-node.js';
import { MultiplyNodeUI } from './nodes/multiply-node.js';
import { AbsoluteNodeUI } from './nodes/absolute-node.js';
import { ValueNodeUI } from './nodes/value-node.js';
import { MonoNodeUI } from './nodes/mono-node.js';
import { SampleHoldNodeUI } from './nodes/samplehold-node.js';
import { LFONodeUI } from './nodes/lfo-node.js';
import { ChaosNodeUI } from './nodes/chaos-node.js';

export class App {
    debugParams() {
        this.nodes.forEach(node => {
            if (typeof node.debugDump === 'function') {
                node.debugDump();
            }
        });
    }

    constructor() {

        AllpassNodeUI.prototype.debugDump = function () {
            console.log('--- Allpass debug', this.id, '---');
            console.log('g_ff:', this.g_ff.gain.value);
            console.log('g_fb:', this.g_fb.gain.value);
            console.log('delayTime:', this.delay.delayTime.value);
        };

        GainNodeUI.prototype.debugDump = function () {
            console.log('--- Gain debug', this.id, '---');
            console.log('gain:', this.outputNode.gain.value);
        };

        (function () {
            const origConnect = AudioNode.prototype.connect;
            const origDisconnect = AudioNode.prototype.disconnect;

            // Use Map instead of WeakMap so we can iterate it.
            const waGraph = new Map();

            window.trueGraph = {};

            function addEdge(src, dst) {
                let set = waGraph.get(src);
                if (!set) {
                    set = new Set();
                    waGraph.set(src, set);
                }
                set.add(dst);
            }

            function removeEdge(src, dst) {
                const set = waGraph.get(src);
                if (set) {
                    set.delete(dst);
                    if (!set.size) waGraph.delete(src);
                }
            }

            AudioNode.prototype.connect = function (dest, ...rest) {
                const s = this._debugLabel || this.toString();
                const d = dest && (dest._debugLabel || dest.toString());
                console.log('[WA connect]', s, '->', d);

                addEdge(this, dest);
                return origConnect.call(this, dest, ...rest);
            };

            AudioNode.prototype.disconnect = function (dest, ...rest) {
                const s = this._debugLabel || this.toString();
                const d = dest && (dest._debugLabel || dest.toString());
                console.log('[WA disconnect]', s, '->', d || '(all)');

                if (dest) removeEdge(this, dest);
                else waGraph.delete(this);

                return origDisconnect.call(this, dest, ...rest);
            };

            // Dump function now works because Map is iterable
            window.dumpWebAudioGraph = function () {
                console.log('--- Web Audio Graph ---');
                waGraph.forEach((dstSet, src) => {
                    const s = src._debugLabel || src.toString();
                    const targets = [];
                    dstSet.forEach(dst => {
                        targets.push(dst._debugLabel || dst.toString());
                    });
                    console.log(s, '->', targets);
                });
            };

            window.getWaGraph = function () {
                return waGraph;
            };
        })();

        this.canvas = document.getElementById('nodeCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.nodes = [];
        this.connections = [];
        this.audioCtx = null;
        this.lastAudioSourceNode = null;
        this.activeSourceForLoad = null;
        this.selectedNodes = new Set();
        this.draggingSelection = null;
        this.draggingAnchor = null;

        this.draggingNode = null;
        this.draggingCable = null;
        this.draggingParam = null;
        this.hoveredPort = null;
        this.showDelaySamples = false;
        this.viewOffset = { x: 0, y: 0 };
        this.isPanning = false;
        this.panStart = null;
        this.panStartOffset = null;
        this.pitchOctaveOffset = 0;
        this.activeKeys = new Set();
        this.scaleKeyMap = {
            KeyQ: 0,
            KeyW: 2,
            KeyE: 4,
            KeyR: 5,
            KeyT: 7,
            KeyY: 9,
            KeyU: 11,
            KeyI: 12,
            KeyO: 14,
            KeyP: 16
        };
        this.sharpKeyMap = {
            Digit2: 1,
            Digit3: 3,
            Digit5: 6,
            Digit6: 8,
            Digit7: 10,
            Digit9: 13,
            Digit0: 15
        };
        this.dynamicNodes = new Set();
        this.lastTickTime = performance.now();

        this.resize();
        window.addEventListener('resize', () => this.resize());
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                if (this.lastAudioSourceNode) this.lastAudioSourceNode.trigger(this.lastAudioSourceNode.lastType);
                return;
            }

            const diatonic = this.scaleKeyMap.hasOwnProperty(e.code) ? this.scaleKeyMap[e.code] : undefined;
            const sharp = this.sharpKeyMap.hasOwnProperty(e.code) ? this.sharpKeyMap[e.code] : undefined;
            if (diatonic !== undefined || sharp !== undefined) {
                if (this.activeKeys.has(e.code)) return;
                this.activeKeys.add(e.code);
                const source = this.lastAudioSourceNode;
                if (source && source.isPitchable()) {
                    this.startAudio();
                    const semitone = diatonic !== undefined ? diatonic : sharp;
                    source.triggerNote(semitone, this.pitchOctaveOffset);
                }
                e.preventDefault();
                return;
            }

            if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+') {
                this.adjustOctave(1);
                e.preventDefault();
                return;
            }

            if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-') {
                this.adjustOctave(-1);
                e.preventDefault();
            }

            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') {
                if (this.selectedNodes && this.selectedNodes.size) {
                    e.preventDefault();
                    this.duplicateSelectedNodes();
                }
                return;
            }

            if (e.key === 'Delete') {
                if (this.selectedNodes && this.selectedNodes.size) {
                    this.deleteSelectedNodes();
                    e.preventDefault();
                }
                return;
            }
        });

        window.addEventListener('keyup', (e) => {
            if (this.scaleKeyMap.hasOwnProperty(e.code) || this.sharpKeyMap.hasOwnProperty(e.code)) {
                this.activeKeys.delete(e.code);
            }
        });

        this.setupInput();

        // Init Defaults
        this.audioStarted = false;
        this.addNode('output', window.innerWidth - 200, window.innerHeight / 2 - 50);
        this.addNode('audio-source', 50, window.innerHeight / 2 - 100);
        this.lastAudioSourceNode = this.nodes[1];

        this.loop();
    }

    async startAudio() {
        if (this.audioCtx) {
            if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
            if (SampleHoldNodeUI.shouldUseWorklet(this.audioCtx)) {
                try {
                    await SampleHoldNodeUI.ensureWorklet(this.audioCtx);
                } catch (err) {
                    console.error('Sample & Hold worklet preload failed', err);
                }
            }
            if (AllpassNodeUI.shouldUseWorklet(this.audioCtx)) {
                try {
                    await AllpassNodeUI.ensureWorklet(this.audioCtx);
                } catch (err) {
                    console.error('Allpass worklet preload failed', err);
                }
            }
            return;
        }
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        AudioUtils.init(this.audioCtx);
        if (SampleHoldNodeUI.shouldUseWorklet(this.audioCtx)) {
            try {
                await SampleHoldNodeUI.ensureWorklet(this.audioCtx);
            } catch (err) {
                console.error('Sample & Hold worklet preload failed', err);
            }
        }
        if (AllpassNodeUI.shouldUseWorklet(this.audioCtx)) {
            try {
                await AllpassNodeUI.ensureWorklet(this.audioCtx);
            } catch (err) {
                console.error('Allpass worklet preload failed', err);
            }
        }
        this.nodes.forEach(n => n.initAudio(this.audioCtx));
    }

    reset() {
        if (this.connections.length > 0) {
            this.connections.forEach(c => this.disconnect(c));
        }
        this.clearSelection();
        this.draggingSelection = null;
        this.draggingAnchor = null;
        this.viewOffset.x = 0;
        this.viewOffset.y = 0;
        this.isPanning = false;
        this.panStart = null;
        this.panStartOffset = null;
        this.canvas.style.cursor = 'default';
        this.connections = [];
        this.nodes.forEach(n => {
            if (this.dynamicNodes.has(n)) this.unregisterDynamicNode(n);
            if (typeof n.onRemoved === 'function') n.onRemoved();
        });
        this.dynamicNodes.clear();
        this.nodes = [];
        this.activeSourceForLoad = null;
        this.addNode('output', this.canvas.width - 200, this.canvas.height / 2 - 50);
        this.addNode('audio-source', 50, this.canvas.height / 2 - 100);
        this.lastAudioSourceNode = this.nodes[1];
    }

    async loadPreset(name) {
        if (!name) return;
        // Auto-start audio on preset load
        if (!this.audioStarted) {
            this.audioStarted = true;
            await this.startAudio();
        }
        const presetId = name.trim();
        if (!presetId) return;
        try {
            const response = await fetch(`presets/${encodeURIComponent(presetId)}.json`, { cache: 'no-cache' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            await this.loadGraphFromData(data);
        } catch (err) {
            console.error(`Failed to load preset "${presetId}"`, err);
            alert(`Unable to load preset: ${presetId}`);
        }
    }

    // Helper to set params by index
    setNodeParam(node, idx, val) {
        if (node && node.params[idx]) {
            node.params[idx].value = val;
            node.updateParam(idx);
        }
    }

    registerDynamicNode(node) {
        this.dynamicNodes.add(node);
    }

    unregisterDynamicNode(node) {
        this.dynamicNodes.delete(node);
    }

    adjustOctave(delta) {
        const limit = 4;
        const next = Math.max(-limit, Math.min(limit, this.pitchOctaveOffset + delta));
        if (next === this.pitchOctaveOffset) return;
        this.pitchOctaveOffset = next;
        console.log(`Octave offset: ${this.pitchOctaveOffset}`);
    }

    getSignedPowSpans(param) {
        if (!param) return { neg: 1, pos: 1 };
        const min = typeof param.min === 'number' ? param.min : -1;
        const max = typeof param.max === 'number' ? param.max : 1;
        const neg = Math.max(0, -min);
        const pos = Math.max(0, max);
        return {
            neg: neg > 0 ? neg : 0,
            pos: pos > 0 ? pos : 0
        };
    }

    resolveSignedPowPower(param) {
        const candidate = param && typeof param.power === 'number' ? param.power : null;
        if (Number.isFinite(candidate) && candidate > 0) return candidate;
        return 3;
    }

    mapSignedPowNormToValue(param, norm) {
        const spans = this.getSignedPowSpans(param);
        const power = this.resolveSignedPowPower(param);
        const clampedNorm = Math.max(0, Math.min(1, norm));
        if (clampedNorm >= 0.5) {
            if (spans.pos <= 0) return 0;
            const local = (clampedNorm - 0.5) / 0.5;
            const shaped = Math.pow(local, power);
            return shaped * spans.pos;
        }
        if (spans.neg <= 0) return 0;
        const local = (0.5 - clampedNorm) / 0.5;
        const shaped = Math.pow(local, power);
        return -shaped * spans.neg;
    }

    mapSignedPowValueToNorm(param, value) {
        if (!Number.isFinite(value)) return 0.5;
        const spans = this.getSignedPowSpans(param);
        const power = this.resolveSignedPowPower(param);
        const min = typeof param.min === 'number' ? param.min : (spans.neg > 0 ? -spans.neg : 0);
        const max = typeof param.max === 'number' ? param.max : (spans.pos > 0 ? spans.pos : 0);
        const clamped = Math.max(min, Math.min(max, value));
        if (clamped >= 0) {
            if (spans.pos <= 0) return 0.5;
            const ratio = spans.pos === 0 ? 0 : Math.max(0, Math.min(1, clamped / spans.pos));
            const shaped = Math.pow(ratio, 1 / power);
            return 0.5 + 0.5 * shaped;
        }
        if (spans.neg <= 0) return 0.5;
        const ratio = spans.neg === 0 ? 0 : Math.max(0, Math.min(1, (-clamped) / spans.neg));
        const shaped = Math.pow(ratio, 1 / power);
        return 0.5 - 0.5 * shaped;
    }

    // Map a pointer position into the appropriate slider value for the active parameter.
    setParamValueFromPointer(target, pointerX) {
        if (!target || !target.node || !target.param) return;
        const node = target.node;
        const param = target.param;
        const sliderX = node.x + 10;
        const sliderWidth = node.width - 20;
        if (sliderWidth <= 0) return;

        let norm = (pointerX - sliderX) / sliderWidth;
        norm = Math.max(0, Math.min(1, norm));

        let newVal;
        if (param.scale === 'log') {
            newVal = AudioUtils.toLog(norm, param.min, param.max);
        } else if (param.scale === 'signedPow') {
            newVal = this.mapSignedPowNormToValue(param, norm);
        } else {
            newVal = param.min + (param.max - param.min) * norm;
        }

        if (param.step) {
            newVal = Math.round(newVal / param.step) * param.step;
        }

        newVal = Math.min(param.max, Math.max(param.min, newVal));

        if (Math.abs(newVal - param.value) < 1e-6) return;
        param.value = newVal;
        if (typeof target.index === 'number') {
            node.updateParam(target.index);
        } else {
            param.onChange(newVal);
        }
    }

    resetParamToDefault(node, index) {
        if (!node || !node.params || !node.params[index]) return false;
        const param = node.params[index];
        if (param.defaultValue === undefined) return false;
        const resetValue = param.defaultValue;
        if (typeof resetValue === 'number' && Math.abs(param.value - resetValue) < 1e-6) {
            return true;
        }
        param.value = resetValue;
        node.updateParam(index);
        return true;
    }

    /* SAVE / LOAD SYSTEM */

    async loadGraphFromData(data) {
        if (!data) return;

        await this.startAudio();

        this.connections.forEach(c => this.disconnect(c));
        this.connections = [];
        this.nodes.forEach(n => {
            if (this.dynamicNodes.has(n)) this.unregisterDynamicNode(n);
            if (typeof n.onRemoved === 'function') n.onRemoved();
        });
        this.dynamicNodes.clear();
        this.nodes = [];
        this.activeSourceForLoad = null;
        this.clearSelection();
        this.draggingSelection = null;
        this.draggingAnchor = null;
        this.draggingNode = null;
        this.draggingCable = null;
        this.draggingParam = null;
        this.hoveredPort = null;
        if (this.viewOffset) {
            this.viewOffset.x = 0;
            this.viewOffset.y = 0;
        }
        this.isPanning = false;
        if (this.canvas) {
            this.canvas.style.cursor = 'default';
        }

        const nodeMap = {};
        (data.nodes || []).forEach(nData => {
            if (!nData || !nData.type) return;
            const node = this.createNodeInstance(nData.type, nData.x, nData.y);
            node.id = nData.id || crypto.randomUUID();
            node.initAudio(this.audioCtx);

            if (nData.extra) {
                node.restoreExtraData(nData.extra);
            }

            if (Array.isArray(nData.params)) {
                nData.params.forEach((val, i) => {
                    if (node.params && node.params[i]) {
                        this.setNodeParam(node, i, val);
                    }
                });
            }

            if (typeof node.computeHeight === 'function') {
                node.computeHeight();
            }

            this.nodes.push(node);
            nodeMap[node.id] = node;
        });

        (data.connections || []).forEach(c => {
            if (!c) return;
            const from = nodeMap[c.fromNodeId];
            const to = nodeMap[c.toNodeId];
            if (from && to) {
                this.connect(from, c.fromPort, to, c.toPort, c.kind || 'audio', c.mode);
            }
        });

        const sources = this.nodes.filter(n => n.type === 'audio-source' || n.type === 'sampler');
        if (sources.length > 0) {
            this.lastAudioSourceNode = sources[0];
        }
    }

    saveGraph() {
        const data = {
            nodes: this.nodes.map(n => n.getSnapshot()),
            connections: this.connections.map(c => ({
                fromNodeId: c.fromNode.id,
                fromPort: c.fromPort,
                toNodeId: c.toNode.id,
                toPort: c.toPort,
                kind: c.kind,
                paramIndex: c.paramIndex,
                mode: c.mode
            }))
        };
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'dps-playground-patch.json';
        a.click();
    }

    loadGraph(input) {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                await this.loadGraphFromData(data);
            } catch (err) {
                console.error('Failed to load graph file', err);
                alert('Unable to load patch file.');
            } finally {
                input.value = '';
            }
        };
        reader.readAsText(file);
    }

    addNode(type, x, y) {
        console.log(`Adding node of type: ${type}`);
        if (x === undefined) x = this.canvas.width / 2 - 70 - this.viewOffset.x;
        if (y === undefined) y = this.canvas.height / 2 - 50 - this.viewOffset.y;

        // Auto-start audio on first node addition (toolbar clicks)
        if (!this.audioStarted && x === this.canvas.width / 2 - 70 - this.viewOffset.x) {
            this.audioStarted = true;
            this.startAudio();
        }

        // Snap to grid
        x = Math.round(x / 20) * 20;
        y = Math.round(y / 20) * 20;

        const n = this.createNodeInstance(type, x, y);
        if (this.audioCtx) n.initAudio(this.audioCtx);
        this.nodes.push(n);
        if (type === 'audio-source' || type === 'sampler') this.lastAudioSourceNode = n;
        console.log(`finished adding node ID: ${n.id}`);
        return n; // Return for scripting
    }

    createNodeInstance(type, x, y) {
        switch (type) {
            case 'output': return new OutputNode(x, y, this);
            case 'audio-source': return new AudioSourceNode(x, y, this);
            case 'sampler': return new AudioSourceNode(x, y, this);
            case 'gain': return new GainNodeUI(x, y, this);
            case 'mixer': return new MixerNodeUI(x, y, this);
            case 'wetdry': return new WetDryNodeUI(x, y, this);
            case 'panner': return new PannerNodeUI(x, y, this);
            case 'delay': return new DelayNodeUI(x, y, this);
            case 'comb': return new CombNodeUI(x, y, this);
            case 'allpass-delay': return new AllpassNodeUI(x, y, this);
            case 'lpf': return new BiquadNodeUI(x, y, this, 'lowpass');
            case 'hpf': return new BiquadNodeUI(x, y, this, 'highpass');
            case 'bpf': return new BiquadNodeUI(x, y, this, 'bandpass');
            case 'notch': return new BiquadNodeUI(x, y, this, 'notch');
            case 'diffuser': return new DiffuserNodeUI(x, y, this);
            case 'fdn-scalable': return new FDNNodeUI(x, y, this);
            case 'ringmod': return new RingModNodeUI(x, y, this);
            case 'pitch-shifter': return new PitchShiftNodeUI(x, y, this);
            case 'mono': return new MonoNodeUI(x, y, this);
            case 'allpass': return new BiquadNodeUI(x, y, this, 'allpass');
            case 'distortion': return new DistortionNodeUI(x, y, this);
            case 'adder': return new AdderNodeUI(x, y, this);
            case 'multiply': return new MultiplyNodeUI(x, y, this);
            case 'inverter': return new InverterNodeUI(x, y, this);
            case 'abs': return new AbsoluteNodeUI(x, y, this);
            case 'samplehold': return new SampleHoldNodeUI(x, y, this);
            case 'lfo': return new LFONodeUI(x, y, this);
            case 'chaos': return new ChaosNodeUI(x, y, this);
            case 'value': return new ValueNodeUI(x, y, this);
            default: return new GainNodeUI(x, y, this);
        }
    }

    deleteNode(node) {
        console.log(`Deleting node ID: ${node.id}`);
        if (node.type === 'output') return; // Keep output
        if (this.dynamicNodes.has(node)) this.unregisterDynamicNode(node);
        if (typeof node.onRemoved === 'function') node.onRemoved();
        if (this.activeSourceForLoad === node) this.activeSourceForLoad = null;
        if (this.selectedNodes.has(node)) {
            this.selectedNodes.delete(node);
        }
        if (this.draggingSelection) {
            this.draggingSelection = this.draggingSelection.filter(entry => entry.node !== node);
            if (!this.draggingSelection.length) {
                this.draggingSelection = null;
                this.draggingAnchor = null;
                this.draggingNode = null;
            } else if (this.draggingAnchor && this.draggingAnchor.node === node) {
                this.draggingAnchor = this.draggingSelection[0];
                this.draggingNode = this.draggingAnchor.node;
            }
        }

        this.connections = this.connections.filter(c => {
            if (c.fromNode === node || c.toNode === node) {
                this.disconnect(c);
                return false;
            }
            return true;
        });
        this.nodes = this.nodes.filter(n => n !== node);
        console.log(`Deleted node ID: ${node.id}`);
    }

    connect(fromNode, fromPort, toNode, toPort, targetKind = 'audio', modeOverride) {
        if (targetKind === 'param') {
            const paramInput = toNode.paramInputs && toNode.paramInputs[toPort];
            if (!paramInput) return;
            const modList = toNode.paramModulators[paramInput.paramIndex] || (toNode.paramModulators[paramInput.paramIndex] = []);
            if (modList.some(entry => entry.node === fromNode)) return;
            const param = toNode.params && toNode.params[paramInput.paramIndex];
            const defaultMode = modeOverride
                || (param && (param.modulationStrategy || param.defaultModulationStrategy))
                || 'multiply';
            modList.push({ node: fromNode, mode: defaultMode });
            if (typeof fromNode.addSubscriber === 'function') {
                fromNode.addSubscriber(toNode, paramInput.paramIndex);
            }
            toNode.updateParam(paramInput.paramIndex);
            this.connections.push({ kind: 'param', fromNode, fromPort, toNode, toPort, paramIndex: paramInput.paramIndex, mode: defaultMode });
            console.log(`Connected param modulator: ${fromNode.title} ID ${fromNode.id} -> ${toNode.title} ID ${toNode.id} [${paramInput.paramIndex}] (${defaultMode})`);
            return;
        }

        const exists = this.connections.some(c =>
            c.kind === 'audio' &&
            c.fromNode === fromNode &&
            c.fromPort === fromPort &&
            c.toNode === toNode &&
            c.toPort === toPort
        );
        if (exists) {
            console.log(`Connection already exists: ${fromNode.title} ID ${fromNode.id} -> ${toNode.title} ID ${toNode.id} [${fromPort} -> ${toPort}] skipping`);
            return; // already connected, do nothing
        }

        const fromOut = fromNode.outputs[fromPort] && fromNode.outputs[fromPort].node;
        const toIn = toNode.inputs[toPort] && toNode.inputs[toPort].node;

        if (fromOut && toIn) {
            try {
                // Defensive: ensure there is at most *one* connection
                fromOut.disconnect(toIn);
            } catch (e) {
                // disconnect may throw if there wasn't a connection; ignore
            }
            try {
                fromOut.connect(toIn);
            } catch (e) {
                console.error("Connection failed", e);
            }
        }
        this.connections.push({ kind: 'audio', fromNode, fromPort, toNode, toPort });
        console.log(`Connected: ${fromNode.title} ID ${fromNode.id} -> ${toNode.title} ID ${toNode.id} [${fromPort} -> ${toPort}]`);
    }

    disconnect(conn) {
        if (conn.kind === 'param') {
            const { toNode, paramIndex, fromNode } = conn;
            if (toNode && typeof toNode.removeParamModulator === 'function') {
                toNode.removeParamModulator(paramIndex, fromNode);
                toNode.updateParam(paramIndex);
            }
            if (fromNode && typeof fromNode.removeSubscriber === 'function') {
                fromNode.removeSubscriber(toNode, paramIndex);
            }

            console.log(`Disconnected param modulator: ${fromNode.title} ID ${fromNode.id} -> ${toNode.title} ID ${toNode.id} [${paramIndex}]`);

            return;
        }

        const src = conn.fromNode.outputs[conn.fromPort].node;
        const dest = conn.toNode.inputs[conn.toPort].node;
        if (src && dest) {
            try {
                src.disconnect(dest);
                console.log(`Disconnected: ${conn.fromNode.title} ID ${conn.fromNode.id} -> ${conn.toNode.title} ID ${conn.toNode.id} [${conn.fromPort} -> ${conn.toPort}]`);
            } catch (e) { }
        }
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    clearSelection() {
        if (!this.selectedNodes.size) return;
        this.selectedNodes.clear();
    }

    selectSingleNode(node) {
        this.selectedNodes.clear();
        if (node) this.selectedNodes.add(node);
    }

    addNodeToSelection(node) {
        if (node) this.selectedNodes.add(node);
    }

    beginDragSelection(anchorNode, pointerX, pointerY) {
        if (!anchorNode) return;
        if (!this.selectedNodes.has(anchorNode)) {
            this.selectSingleNode(anchorNode);
        }

        const entries = Array.from(this.selectedNodes).map(node => ({
            node,
            startX: node.x,
            startY: node.y,
            offsetX: pointerX - node.x,
            offsetY: pointerY - node.y
        }));

        const anchor = entries.find(entry => entry.node === anchorNode) || entries[0];
        this.draggingSelection = entries;
        this.draggingAnchor = anchor;
        this.draggingNode = anchorNode;

        const orderedNodes = entries
            .map(entry => ({ node: entry.node, index: this.nodes.indexOf(entry.node) }))
            .filter(item => item.index >= 0)
            .sort((a, b) => a.index - b.index);

        orderedNodes.forEach(({ node }) => {
            const idx = this.nodes.indexOf(node);
            if (idx >= 0) this.nodes.splice(idx, 1);
        });
        orderedNodes.forEach(({ node }) => this.nodes.push(node));
    }

    findConnectionAt(x, y, tolerance = 12) {
        for (let i = this.connections.length - 1; i >= 0; i--) {
            const c = this.connections[i];
            const p1 = c.fromNode.getPortPos(false, c.fromPort);
            const p2 = c.kind === 'param'
                ? c.toNode.getParamInputPos(c.toPort)
                : c.toNode.getPortPos(true, c.toPort);

            const cp1x = p1.x + Math.abs(p2.x - p1.x) * 0.5;
            const cp2x = p2.x - Math.abs(p2.x - p1.x) * 0.5;

            for (let t = 0; t <= 1; t += 0.05) {
                const it = 1 - t;
                const bx = (it * it * it) * p1.x + 3 * (it * it) * t * cp1x + 3 * it * (t * t) * cp2x + (t * t * t) * p2.x;
                const by = (it * it * it) * p1.y + 3 * (it * it) * t * p1.y + 3 * it * (t * t) * p2.y + (t * t * t) * p2.y;
                if (Math.hypot(x - bx, y - by) <= tolerance) {
                    return c;
                }
            }
        }
        return null;
    }

    cycleParamConnectionMode(connection) {
        if (!connection || connection.kind !== 'param') return;
        const sequence = ['multiply', 'add', 'override'];
        const current = connection.mode || 'multiply';
        const nextMode = sequence[(sequence.indexOf(current) + 1) % sequence.length];
        connection.mode = nextMode;
        const paramIndex = connection.paramIndex;
        const modList = connection.toNode.paramModulators && connection.toNode.paramModulators[paramIndex];
        if (modList) {
            const entry = modList.find(item => item.node === connection.fromNode);
            if (entry) entry.mode = nextMode;
        }
        connection.toNode.updateParam(paramIndex);
    }

    deleteSelectedNodes() {
        if (!this.selectedNodes.size) return;
        const toDelete = Array.from(this.selectedNodes);
        toDelete.forEach(node => this.deleteNode(node));
        this.clearSelection();
    }

    duplicateSelectedNodes() {
        if (!this.selectedNodes.size) return;
        const originals = Array.from(this.selectedNodes);
        const offsetX = 40;
        const offsetY = 40;
        const mapping = new Map();
        const clones = [];
        const originalLastSource = this.lastAudioSourceNode;

        originals.forEach(source => {
            const extra = typeof source.getExtraData === 'function' ? source.getExtraData() : null;
            const clone = this.addNode(source.type, source.x + offsetX, source.y + offsetY);
            if (!clone) return;
            if (extra && typeof clone.restoreExtraData === 'function') {
                clone.restoreExtraData(extra);
            }
            if (source.params && clone.params) {
                source.params.forEach((param, idx) => {
                    if (!clone.params[idx]) return;
                    clone.params[idx].value = param.value;
                    if (param.modulationStrategy) {
                        clone.params[idx].modulationStrategy = param.modulationStrategy;
                    }
                    if (param.defaultModulationStrategy !== undefined) {
                        clone.params[idx].defaultModulationStrategy = param.defaultModulationStrategy;
                    }
                    clone.updateParam(idx);
                });
            }
            if (source.type === 'audio-source') {
                clone.lastType = source.lastType;
                clone.baseFrequency = source.baseFrequency;
                clone.basePlaybackRate = source.basePlaybackRate;
                clone.noteRelease = source.noteRelease;
                clone.customBuffer = source.customBuffer;
            }
            if (typeof clone.computeHeight === 'function') {
                clone.computeHeight();
            }
            mapping.set(source, clone);
            clones.push(clone);
        });

        if (!clones.length) return;

        const originalsSet = new Set(originals);
        const connectionsToClone = this.connections.filter(conn =>
            originalsSet.has(conn.fromNode) && originalsSet.has(conn.toNode)
        );

        connectionsToClone.forEach(conn => {
            const fromClone = mapping.get(conn.fromNode);
            const toClone = mapping.get(conn.toNode);
            if (!fromClone || !toClone) return;
            this.connect(fromClone, conn.fromPort, toClone, conn.toPort, conn.kind, conn.mode);
        });

        if (originalLastSource && mapping.has(originalLastSource)) {
            this.lastAudioSourceNode = mapping.get(originalLastSource);
        } else {
            this.lastAudioSourceNode = originalLastSource;
        }

        this.clearSelection();
        clones.forEach(node => this.selectedNodes.add(node));
    }

    setupInput() {
        const delayUnitButton = document.getElementById('btn-toggle-delay-units');
        if (delayUnitButton) {
            delayUnitButton.addEventListener('click', () => {
                this.showDelaySamples = !this.showDelaySamples;
                delayUnitButton.textContent = `Delay Units: ${this.showDelaySamples ? 'samples' : 'ms'}`;
            });
        }

        // File input delegation
        const audioInput = document.getElementById('audio-input');
        audioInput.addEventListener('change', (e) => {
            if (this.activeSourceForLoad && e.target.files[0]) {
                this.activeSourceForLoad.loadCustomSample(e.target.files[0]);
            }
            this.activeSourceForLoad = null;
            audioInput.value = '';
        });

        const getMousePos = (e) => {
            const r = this.canvas.getBoundingClientRect();
            return {
                x: e.clientX - r.left - this.viewOffset.x,
                y: e.clientY - r.top - this.viewOffset.y
            };
        };

        this.canvas.addEventListener('mousedown', (e) => {
            // Auto-start audio on first interaction
            if (!this.audioStarted) {
                this.audioStarted = true;
                this.startAudio();
            }

            if (e.button === 1) {
                e.preventDefault();
                this.isPanning = true;
                this.panStart = { x: e.clientX, y: e.clientY };
                this.panStartOffset = { x: this.viewOffset.x, y: this.viewOffset.y };
                this.canvas.style.cursor = 'grabbing';
                this.draggingSelection = null;
                this.draggingAnchor = null;
                this.draggingNode = null;
                this.draggingCable = null;
                this.draggingParam = null;
                this.hoveredPort = null;
                return;
            }

            const { x, y } = getMousePos(e);
            const wantsToggle = e.ctrlKey || e.metaKey;
            const wantsAdd = e.shiftKey;
            const additiveSelect = wantsToggle || wantsAdd;

            // Reverse iterate for Z-index (top first)
            for (let i = this.nodes.length - 1; i >= 0; i--) {
                const n = this.nodes[i];

                const isAudioSourceNode = n.type === 'audio-source' || n.type === 'sampler';

                // 1. Check Audio Source UI
                if (isAudioSourceNode) {
                    const btnW = 60; const btnH = 20; const gap = 5;
                    const buttons = ['kick', 'snare', 'hh', 'sine', 'saw', 'square', 'triangle', 'noise', 'mic', 'custom'];
                    let bx = n.x + 10, by = n.y + n.headerHeight + 10;

                    // Audio Triggers
                    for (let j = 0; j < buttons.length; j++) {
                        if (x >= bx && x <= bx + btnW && y >= by && y <= by + btnH) {
                            n.trigger(buttons[j]);
                            return;
                        }
                        bx += btnW + gap;
                        if (bx + btnW > n.x + n.width - 10) { bx = n.x + 10; by += btnH + gap; }
                    }

                    // Load Button
                    const loadX = n.x + 10;
                    const loadY = by + 5;
                    const loadW = 90;
                    const loadH = 22;
                    if (x >= loadX && x <= loadX + loadW && y >= loadY && y <= loadY + loadH) {
                        this.activeSourceForLoad = n;
                        document.getElementById('audio-input').click();
                        return;
                    }
                }

                // 2. Check Output Ports first so they are easy to grab near sliders
                for (let j = 0; j < n.outputs.length; j++) {
                    const p = n.getPortPos(false, j);
                    if (Math.hypot(x - p.x, y - p.y) < 10) {
                        this.draggingSelection = null;
                        this.draggingAnchor = null;
                        this.draggingNode = null;
                        this.draggingCable = { fromNode: n, fromPort: j, x: x, y: y };
                        return;
                    }
                }

                // 3. Check Params (slider body only)
                const paramBaseOffset = isAudioSourceNode ? 100 : 24;
                const paramSpacing = n.paramSpacing || 48;
                for (let idx = 0; idx < n.params.length; idx++) {
                    const p = n.params[idx];
                    const sliderX = n.x + 10;
                    const sliderWidth = n.width - 20;
                    const slotTop = typeof n.getParamSlotTop === 'function'
                        ? n.getParamSlotTop(idx)
                        : n.y + n.headerHeight + paramBaseOffset + (idx * paramSpacing);
                    const captureTop = slotTop + 16;
                    const captureBottom = slotTop + paramSpacing;

                    if (x >= sliderX && x <= sliderX + sliderWidth && y >= captureTop && y <= captureBottom) {
                        this.draggingSelection = null;
                        this.draggingAnchor = null;
                        this.draggingNode = null;
                        this.draggingParam = { node: n, param: p, index: idx };
                        this.setParamValueFromPointer(this.draggingParam, x);
                        return;
                    }
                }

                // 4. Node Drag
                if (x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.headerHeight) {
                    if (wantsToggle) {
                        if (this.selectedNodes.has(n)) {
                            this.selectedNodes.delete(n);
                            this.draggingSelection = null;
                            this.draggingAnchor = null;
                            this.draggingNode = null;
                            return;
                        }
                        this.addNodeToSelection(n);
                    } else if (wantsAdd) {
                        this.addNodeToSelection(n);
                    } else if (this.selectedNodes.has(n)) {
                        // Already part of the selection, keep existing group
                    } else {
                        this.selectSingleNode(n);
                    }
                    this.beginDragSelection(n, x, y);
                    return;
                }
            }

            if (!wantsAdd && !wantsToggle) {
                this.clearSelection();
            }
        });

        this.canvas.addEventListener('mousemove', (e) => {
            if (this.isPanning) return;
            const { x, y } = getMousePos(e);

            if (this.draggingSelection && this.draggingAnchor) {
                const rawX = x - this.draggingAnchor.offsetX;
                const rawY = y - this.draggingAnchor.offsetY;
                const snappedX = Math.round(rawX / 20) * 20;
                const snappedY = Math.round(rawY / 20) * 20;
                const deltaX = snappedX - this.draggingAnchor.startX;
                const deltaY = snappedY - this.draggingAnchor.startY;

                this.draggingSelection.forEach(entry => {
                    entry.node.x = entry.startX + deltaX;
                    entry.node.y = entry.startY + deltaY;
                });

            } else if (this.draggingCable) {
                this.draggingCable.x = x;
                this.draggingCable.y = y;
            } else if (this.draggingParam) {
                this.setParamValueFromPointer(this.draggingParam, x);
            }

            // Hover
            this.hoveredPort = null;
            if (this.draggingCable) {
                for (let n of this.nodes) {
                    if (n === this.draggingCable.fromNode) continue;
                    for (let j = 0; j < n.inputs.length; j++) {
                        const p = n.getPortPos(true, j);
                        if (Math.hypot(x - p.x, y - p.y) < 15) {
                            this.hoveredPort = { node: n, index: j, kind: 'audio' };
                        }
                    }
                    if (n.paramInputs) {
                        for (let j = 0; j < n.paramInputs.length; j++) {
                            const pos = n.getParamInputPos(j);
                            if (Math.hypot(x - pos.x, y - pos.y) < 15) {
                                this.hoveredPort = { node: n, index: j, kind: 'param' };
                            }
                        }
                    }
                }
            }
        });

        this.canvas.addEventListener('mouseup', (e) => {
            if (this.draggingCable && this.hoveredPort) {
                this.connect(
                    this.draggingCable.fromNode,
                    this.draggingCable.fromPort,
                    this.hoveredPort.node,
                    this.hoveredPort.index,
                    this.hoveredPort.kind || 'audio'
                );
            }
            this.draggingNode = null;
            this.draggingCable = null;
            this.draggingParam = null;
            this.draggingSelection = null;
            this.draggingAnchor = null;
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.isPanning || !this.panStart || !this.panStartOffset) return;
            const dx = e.clientX - this.panStart.x;
            const dy = e.clientY - this.panStart.y;
            this.viewOffset.x = this.panStartOffset.x + dx;
            this.viewOffset.y = this.panStartOffset.y + dy;
            this.hoveredPort = null;
        });

        window.addEventListener('mouseup', (e) => {
            if (e.button === 1 && this.isPanning) {
                this.isPanning = false;
                this.panStart = null;
                this.panStartOffset = null;
                this.canvas.style.cursor = 'default';
            }
            if (e.button === 0) {
                if (this.draggingSelection || this.draggingCable || this.draggingParam) {
                    this.draggingSelection = null;
                    this.draggingAnchor = null;
                    this.draggingNode = null;
                    this.draggingCable = null;
                    this.draggingParam = null;
                    this.hoveredPort = null;
                }
            }
        });

        this.canvas.addEventListener('dblclick', (e) => {
            const { x, y } = getMousePos(e);

            for (let i = this.nodes.length - 1; i >= 0; i--) {
                const n = this.nodes[i];
                if (!n.params || !n.params.length) continue;
                const isAudioSourceNode = n.type === 'audio-source' || n.type === 'sampler';
                const paramBaseOffset = isAudioSourceNode ? 100 : 24;
                const paramSpacing = n.paramSpacing || 48;
                for (let idx = 0; idx < n.params.length; idx++) {
                    const sliderX = n.x + 10;
                    const sliderWidth = n.width - 20;
                    const slotTop = typeof n.getParamSlotTop === 'function'
                        ? n.getParamSlotTop(idx)
                        : n.y + n.headerHeight + paramBaseOffset + (idx * paramSpacing);
                    const captureTop = slotTop + 16;
                    const captureBottom = slotTop + paramSpacing;
                    if (x >= sliderX && x <= sliderX + sliderWidth && y >= captureTop && y <= captureBottom) {
                        if (this.resetParamToDefault(n, idx)) {
                            return;
                        }
                    }
                }
            }

            const connection = this.findConnectionAt(x, y, 10);
            if (connection) {
                const idx = this.connections.indexOf(connection);
                this.disconnect(connection);
                if (idx >= 0) this.connections.splice(idx, 1);
            }
        });

        this.canvas.addEventListener('contextmenu', (e) => {
            const { x, y } = getMousePos(e);
            const connection = this.findConnectionAt(x, y, 10);
            if (connection && connection.kind === 'param') {
                e.preventDefault();
                this.cycleParamConnectionMode(connection);
                return;
            }
        });
    }

    drawNode(n) {
        const ctx = this.ctx;
        const w = n.width;
        const h = n.height;
        const r = 6;
        const screenX = n.x + this.viewOffset.x;
        const screenY = n.y + this.viewOffset.y;

        const isSelected = this.selectedNodes.has(n);

        // Body
        ctx.fillStyle = '#2d2d2d';
        const isAudioSourceNode = n.type === 'audio-source' || n.type === 'sampler';
        const isActiveSource = n === this.lastAudioSourceNode && isAudioSourceNode;
        let strokeStyle = '#555';
        let strokeWidth = 1;
        if (isActiveSource) {
            strokeStyle = '#00d2ff';
            strokeWidth = 2;
        }
        if (isSelected) {
            strokeStyle = '#ffd54f';
            strokeWidth = 2;
        }
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = strokeWidth;
        ctx.beginPath();
        ctx.roundRect(screenX, screenY, w, h, r);
        ctx.fill();
        ctx.stroke();

        // Header
        ctx.fillStyle = isSelected ? '#474747' : '#404040';
        ctx.beginPath();
        ctx.roundRect(screenX, screenY, w, n.headerHeight, [r, r, 0, 0]);
        ctx.fill();

        // Title
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(n.title, screenX + 10, screenY + 17);

        // Inputs
        n.inputs.forEach((inp, i) => {
            const pos = n.getPortPos(true, i);
            const sx = pos.x + this.viewOffset.x;
            const sy = pos.y + this.viewOffset.y;
            ctx.fillStyle = '#ff4d4d';
            ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill();
        });

        // Outputs
        n.outputs.forEach((out, i) => {
            const pos = n.getPortPos(false, i);
            const sx = pos.x + this.viewOffset.x;
            const sy = pos.y + this.viewOffset.y;
            ctx.fillStyle = '#4dff88';
            ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill();
        });

        if (isAudioSourceNode) {
            const buttons = ['kick', 'snare', 'hh', 'sine', 'saw', 'square', 'triangle', 'noise', 'mic', 'custom'];
            let bx = screenX + 10;
            let by = screenY + n.headerHeight + 10;
            const btnW = 60;
            const btnH = 20;
            const gap = 5;
            let buttonsBottom = by;

            ctx.font = '9px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            buttons.forEach(b => {
                let fill = '#555';
                if (b === 'mic') {
                    if (n.micActive) fill = '#2e7d32';
                    else if (n.micPending) fill = '#8c6d1f';
                    else if (n.micError) fill = '#8c1f1f';
                    else if (n.lastType === 'mic') fill = '#006d9c';
                } else if (b === n.lastType) {
                    fill = '#006d9c';
                }
                ctx.fillStyle = fill;
                ctx.fillRect(bx, by, btnW, btnH);
                ctx.fillStyle = '#fff';
                let label = b.toUpperCase();
                if (b === 'mic') {
                    if (n.micActive) label = 'MIC ON';
                    else if (n.micPending) label = 'MIC...';
                    else if (n.micError) label = 'MIC ERR';
                }
                ctx.fillText(label, bx + btnW / 2, by + btnH / 2);
                const bottom = by + btnH;
                if (bottom > buttonsBottom) buttonsBottom = bottom;
                bx += btnW + gap;
                if (bx + btnW > screenX + w - 10) {
                    bx = screenX + 10;
                    by += btnH + gap;
                }
            });

            const loadX = screenX + 10;
            const loadY = buttonsBottom + gap;
            const loadW = 90;
            const loadH = 22;
            ctx.fillStyle = '#444';
            ctx.fillRect(loadX, loadY, loadW, loadH);
            ctx.fillStyle = '#ccc';
            ctx.fillText('LOAD FILE', loadX + loadW / 2, loadY + loadH / 2);

            let statusY = loadY + loadH + 14;
            if (n.micPending) {
                ctx.fillStyle = '#ffd54f';
                ctx.fillText('Mic: requesting...', loadX, statusY);
                statusY += 12;
            } else if (n.micActive) {
                ctx.fillStyle = '#4dff88';
                ctx.fillText('Mic: active', loadX, statusY);
                statusY += 12;
            } else if (n.micError) {
                ctx.fillStyle = '#ff6b6b';
                const message = typeof n.micError === 'string'
                    ? n.micError
                    : (n.micError && n.micError.message) ? n.micError.message : 'unavailable';
                const display = message.length > 36 ? `${message.slice(0, 33)}...` : message;
                ctx.fillText(`Mic: ${display}`, loadX, statusY);
                statusY += 12;
            }

            ctx.textAlign = 'start';
            ctx.textBaseline = 'alphabetic';
        }

        if (n.type === 'output' && n.analyser) {
            const scopeX = screenX + 12;
            const scopeY = screenY + n.headerHeight + 8;
            const scopeW = Math.max(20, w - 24);
            const scopeH = Math.max(16, Math.min(40, h - n.headerHeight - 16));

            ctx.save();
            ctx.beginPath();
            ctx.rect(scopeX, scopeY, scopeW, scopeH);
            ctx.clip();

            ctx.fillStyle = '#000';
            ctx.fillRect(scopeX, scopeY, scopeW, scopeH);

            n.analyser.getByteTimeDomainData(n.visualData);
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#00d2ff';
            ctx.beginPath();
            const sliceWidth = scopeW * 1.0 / n.visualData.length;
            let px = 0;
            for (let i = 0; i < n.visualData.length; i++) {
                const v = n.visualData[i] / 128.0;
                const py = scopeY + (v * scopeH / 2);
                const sx = scopeX + px;
                if (i === 0) ctx.moveTo(sx, py);
                else ctx.lineTo(sx, py);
                px += sliceWidth;
            }
            ctx.stroke();
            ctx.restore();
        }

        // Sliders
        const paramBaseOffset = isAudioSourceNode ? 100 : 24;
        const paramSpacing = n.paramSpacing || 40;
        const sliderTopOffset = 24;
        const sliderHeight = 6;
        const sliderPadding = 4;
        const sampleRate = this.audioCtx ? this.audioCtx.sampleRate : 44100;
        n.params.forEach((p, idx) => {
            const slotTop = typeof n.getParamSlotTop === 'function'
                ? n.getParamSlotTop(idx)
                : n.y + n.headerHeight + paramBaseOffset + (idx * paramSpacing);
            ctx.fillStyle = '#aaa';
            ctx.font = '10px sans-serif';
            const effectiveVal = typeof p.effectiveValue === 'number' ? p.effectiveValue : p.value;
            const hasMod = typeof p.value === 'number' && typeof effectiveVal === 'number' && Math.abs(effectiveVal - p.value) > 1e-6;

            const formatValue = (val) => {
                if (typeof val !== 'number' || Number.isNaN(val)) return `${val}`;
                if (p.label === 'Waveform') {
                    const waveNames = ['Sine', 'Triangle', 'Saw', 'Square', 'Random'];
                    const idx = Math.max(0, Math.min(waveNames.length - 1, Math.round(val)));
                    return waveNames[idx];
                }
                if (p.label.includes('Delay (ms)')) {
                    const msVal = val.toFixed(2);
                    let text = `${msVal} ms`;
                    if (this.showDelaySamples) {
                        const samples = Math.round((val / 1000) * sampleRate);
                        text += ` (${samples} samples)`;
                    }
                    return text;
                }
                if (p.label.includes('Time (s)')) {
                    const secVal = val.toFixed(3);
                    let text = `${secVal} s`;
                    if (this.showDelaySamples) {
                        const samples = Math.round(val * sampleRate);
                        text += ` (${samples} samples)`;
                    }
                    return text;
                }
                if (p.label.includes('Hz')) {
                    const decimals = val >= 10 ? 1 : 2;
                    return `${val.toFixed(decimals)} Hz`;
                }
                const magnitude = Math.abs(val);
                if (magnitude > 0 && magnitude < 0.001) {
                    return val.toExponential(2);
                }
                const decimals = magnitude >= 10 ? 2 : (magnitude >= 1 ? 3 : 4);
                const formatted = parseFloat(val.toFixed(decimals));
                return formatted === 0 ? '0' : formatted.toString();
            };

            const baseText = formatValue(p.value);
            const effectiveText = formatValue(effectiveVal);
            const displayText = hasMod ? `${baseText} -> ${effectiveText}` : baseText;
            const slotTopScreen = slotTop + this.viewOffset.y;
            const sliderX = screenX + 10;
            const sliderWidth = w - 20;
            const sliderY = slotTopScreen + sliderTopOffset;
            const sliderMidY = sliderY + sliderHeight / 2;
            const textY = slotTopScreen + 12;
            ctx.fillText(`${p.label}: ${displayText}`, screenX + 10, textY);

            if (n.paramInputs && n.paramInputs[idx]) {
                const paramPos = n.getParamInputPos(idx);
                const spx = paramPos.x + this.viewOffset.x;
                const spy = paramPos.y + this.viewOffset.y;
                const portRadius = 5;
                ctx.fillStyle = '#ffd54f';
                ctx.beginPath();
                ctx.arc(spx, spy, portRadius, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#b8860b';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(spx, spy, portRadius, 0, Math.PI * 2);
                ctx.stroke();
            }

            ctx.fillStyle = '#333';
            ctx.fillRect(sliderX, sliderY, sliderWidth, sliderHeight);

            let pct;
            if (p.scale === 'log') {
                pct = AudioUtils.fromLog(p.value, p.min, p.max);
            } else if (p.scale === 'signedPow') {
                pct = this.mapSignedPowValueToNorm(p, p.value);
            } else {
                const range = p.max - p.min;
                pct = range === 0 ? 0 : (p.value - p.min) / range;
            }
            pct = Math.max(0, Math.min(1, pct));

            const knobHalf = 6;
            const knobX = sliderX + pct * sliderWidth;
            const clampedKnobX = Math.min(sliderX + sliderWidth - knobHalf, Math.max(sliderX + knobHalf, knobX));

            ctx.fillStyle = '#00d2ff';
            ctx.fillRect(clampedKnobX - knobHalf, sliderY - sliderPadding, knobHalf * 2, sliderHeight + sliderPadding * 2);
        });
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 1;
    }

    drawCable(connection, x1, y1, x2, y2, active) {
        const ctx = this.ctx;
        const sx1 = x1 + this.viewOffset.x;
        const sy1 = y1 + this.viewOffset.y;
        const sx2 = x2 + this.viewOffset.x;
        const sy2 = y2 + this.viewOffset.y;
        ctx.beginPath();
        const cp1x = sx1 + Math.abs(sx2 - sx1) * 0.5;
        const cp2x = sx2 - Math.abs(sx2 - sx1) * 0.5;
        ctx.moveTo(sx1, sy1);
        ctx.bezierCurveTo(cp1x, sy1, cp2x, sy2, sx2, sy2);
        if (active) {
            ctx.strokeStyle = '#fff';
        } else if (connection && connection.kind === 'param') {
            const mode = connection.mode || 'multiply';
            if (mode === 'add') ctx.strokeStyle = '#7cb5ff';
            else if (mode === 'override') ctx.strokeStyle = '#ff8a65';
            else ctx.strokeStyle = '#ffd54f';
        } else {
            ctx.strokeStyle = '#888';
        }
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    loop() {
        const now = performance.now();
        const delta = Math.min(0.1, Math.max(0, (now - this.lastTickTime) / 1000));
        if (delta > 0) {
            this.dynamicNodes.forEach(node => {
                if (typeof node.tick === 'function') node.tick(delta, now / 1000);
            });
        }
        this.lastTickTime = now;

        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        const gs = 20;
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1;
        ctx.beginPath();

        const startX = ((Math.floor((-this.viewOffset.x) / gs) - 1) * gs) + this.viewOffset.x;
        for (let x = startX; x < this.canvas.width + gs; x += gs) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.canvas.height);
        }

        const startY = ((Math.floor((-this.viewOffset.y) / gs) - 1) * gs) + this.viewOffset.y;
        for (let y = startY; y < this.canvas.height + gs; y += gs) {
            ctx.moveTo(0, y);
            ctx.lineTo(this.canvas.width, y);
        }

        ctx.stroke();

        this.connections.forEach(c => {
            const p1 = c.fromNode.getPortPos(false, c.fromPort);
            const p2 = c.kind === 'param'
                ? c.toNode.getParamInputPos(c.toPort)
                : c.toNode.getPortPos(true, c.toPort);
            this.drawCable(c, p1.x, p1.y, p2.x, p2.y, false);
        });

        if (this.draggingCable) {
            const p1 = this.draggingCable.fromNode.getPortPos(false, this.draggingCable.fromPort);
            this.drawCable(null, p1.x, p1.y, this.draggingCable.x, this.draggingCable.y, true);
        }

        this.nodes.forEach(n => this.drawNode(n));
        requestAnimationFrame(() => this.loop());
    }
}

