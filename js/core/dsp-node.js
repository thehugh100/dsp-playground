/* NODE GRAPH ENGINE */
import { AudioUtils } from '../utils/audio-utils.js';

export class DSPNode {
    constructor(x, y, title, app) {
        this.id = crypto.randomUUID();
        this.x = x;
        this.y = y;
        this.width = 140;
        this.title = title;
        this.app = app;
        this.inputs = [];  // {name, id, node: AudioNode}
        this.outputs = []; // {name, id, node: AudioNode}
        this.params = [];  // {label, type, value, min, max, scale, onChange}
        this.paramInputs = []; // [{name, id, paramIndex}]
        this.paramModulators = []; // Array of [{node}]
        this.paramSpacing = 40;

        this.headerHeight = 25;
        this.bodyHeight = 0;
        this.dragOffset = { x: 0, y: 0 };
    }

    computeHeight() {
        const perParam = this.paramSpacing || 40;
        const paramH = this.params.length * perParam;
        const ioH = Math.max(this.inputs.length, this.outputs.length) * 20;
        // Add extra space for specific nodes
        const isAudioSource = this.type === 'audio-source' || this.type === 'sampler';
        let extra = isAudioSource ? 160 : (this.type === 'output' ? 20 : 0);
        this.bodyHeight = extra + paramH + ioH;
        this.height = this.headerHeight + this.bodyHeight;
    }

    initAudio(ctx) { } // Override

    setupParameterIO() {
        if (!this.params) return;
        this.paramInputs = this.params.map((p, idx) => ({
            name: p.label ? `${p.label} Scale` : 'Scale',
            id: idx,
            paramIndex: idx
        }));
        if (!this.paramModulators) this.paramModulators = [];
        this.params.forEach((_, idx) => {
            if (!this.paramModulators[idx]) this.paramModulators[idx] = [];
        });
    }

    getParamInputPos(index) {
        const slotTop = this.getParamSlotTop(index);
        const portOffset = 28;
        return {
            x: this.x,
            y: slotTop + portOffset
        };
    }

    updateParam(index) {
        const param = this.params && this.params[index];
        if (!param || typeof param.onChange !== 'function') return;
        const mods = (this.paramModulators && this.paramModulators[index]) || [];
        const modEntries = mods
            .map(entry => {
                if (!entry || !entry.node || typeof entry.node.getValue !== 'function') return null;
                const value = entry.node.getValue();
                if (typeof value !== 'number' || !isFinite(value)) return null;
                const mode = entry.mode || param.modulationStrategy || 'multiply';
                return { value, mode };
            })
            .filter(Boolean);
        let effective = param.value;
        if (modEntries.length) {
            let overrideValue = null;
            let additiveSum = 0;
            let multiplicativeProduct = 1;
            modEntries.forEach(({ value, mode }) => {
                if (mode === 'override') {
                    overrideValue = value;
                } else if (mode === 'add') {
                    additiveSum += value;
                } else {
                    multiplicativeProduct *= value;
                }
            });
            if (overrideValue !== null) {
                effective = overrideValue;
            } else {
                const base = typeof param.value === 'number' ? param.value : 0;
                effective = (base * multiplicativeProduct) + additiveSum;
            }
        }
        const meta = { fromAutomation: modEntries.length > 0 };
        param.onChange(effective, meta);
        param.effectiveValue = effective;
    }

    removeParamModulator(index, node) {
        if (!this.paramModulators || !this.paramModulators[index]) return;
        this.paramModulators[index] = this.paramModulators[index].filter(entry => entry.node !== node);
    }

    initializeParams() {
        this.setupParameterIO();
        if (!this.params) return;
        this.params.forEach(param => {
            if (param.defaultValue === undefined) {
                param.defaultValue = param.value;
            }
            const strategy = param.modulationStrategy || 'multiply';
            param.modulationStrategy = strategy;
            if (param.defaultModulationStrategy === undefined) {
                param.defaultModulationStrategy = strategy;
            }
        });
        this.params.forEach((_, idx) => this.updateParam(idx));
    }

    getParamSlotTop(index) {
        const baseOffset = (this.type === 'audio-source' || this.type === 'sampler') ? 100 : 14;
        const spacing = this.paramSpacing || 40;
        return this.y + this.headerHeight + baseOffset + (index * spacing);
    }

    getSnapshot() {
        const snapshot = {
            id: this.id,
            type: this.type,
            x: this.x,
            y: this.y,
            params: this.params.map(p => p.value)
        };
        const extra = this.getExtraData();
        if (extra && Object.keys(extra).length > 0) {
            snapshot.extra = extra;
        }
        return snapshot;
    }

    getExtraData() {
        if (!this.params || !this.params.length) return null;
        const overrides = [];
        this.params.forEach((param, idx) => {
            const defaultStrategy = param.defaultModulationStrategy || 'multiply';
            const currentStrategy = param.modulationStrategy || 'multiply';
            if (currentStrategy !== defaultStrategy) {
                overrides.push({ index: idx, strategy: currentStrategy });
            }
        });
        return overrides.length ? { paramStrategies: overrides } : null;
    }

    restoreExtraData(data) {
        if (!data || !this.params) return;
        const strategies = Array.isArray(data.paramStrategies)
            ? data.paramStrategies
            : (data.paramStrategies ? [data.paramStrategies] : []);
        strategies.forEach(entry => {
            const { index, strategy } = entry || {};
            if (typeof index === 'number' && this.params[index]) {
                this.params[index].modulationStrategy = strategy || 'multiply';
            }
        });
    }

    isPointInside(x, y) {
        return x >= this.x && x <= this.x + this.width &&
            y >= this.y && y <= this.y + this.height;
    }

    getPortPos(isInput, index) {
        if (isInput && this.params && this.params.length > 0 && index < this.params.length) {
            const slotTop = this.getParamSlotTop(index);
            return {
                x: this.x,
                y: slotTop + 8
            };
        }

        const baseY = this.y + (this.headerHeight * 0.5);
        const spacing = 18;
        const y = baseY + (index * spacing);
        const x = isInput ? this.x : this.x + this.width;
        return { x, y };
    }
}
