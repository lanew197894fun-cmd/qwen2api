export function init(opts?: {
    selfLearning?: object | undefined;
    complexKeywords?: string[] | undefined;
    cognitiveKeywords?: string[] | undefined;
}): void;
export function getWeight(kw: any): any;
export function getCognitiveKeywords(): any[];
export function getSuggestions(): any[];
export function isRunning(): boolean;
export function getTriggerState(): {
    threshold: number;
    count: number;
};
export function getPenalty(taskType: string): number;
export function recordModelLatency(model: string, latencyMs: number, isTimeout?: boolean): void;
export function getModelStats(): Array<{
    model: string;
    count: number;
    avgLatency: number;
    timeoutRate: number;
    stallRate: number;
}>;
export function isModelStalling(model: string, threshold?: number): boolean;
export function isModelTimingOut(model: string, threshold?: number): boolean;
export function suggestFallbackRoute(): object | null;
export function adjustWeights(recent: any, modelStats: any): void;
export function evolve(): Promise<void>;
export function resetTrigger(): void;
export function flushPending(): number;
export function updateKeywords(complex: any, cognitive: any): void;
//# sourceMappingURL=evolution-engine.d.ts.map