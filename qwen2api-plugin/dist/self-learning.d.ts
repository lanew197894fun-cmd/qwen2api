export function getConfig(): object;
export function updateConfig(updates: object): {
    config: object;
    changed: string[];
};
export function learnCodeStyle(projectPath: any): Promise<{
    naming: {
        camelCase: number;
        snake_case: number;
        PascalCase: number;
    };
    indent: {
        spaces2: number;
        spaces4: number;
        tabs: number;
    };
    errorHandling: {
        tryCatch: any;
        earlyReturn: any;
        ratio: number;
    };
    comments: {
        single: number;
        multi: number;
        total: number;
    };
    imports: {
        esm: any;
        cjs: any;
    };
    totalFiles: number;
    totalLines: number;
    analyzedAt: string;
} | {
    error: string;
}>;
export function learnResponseStyle(interactions?: Array<{
    content?: string;
}>): object;
export function learnProblemSolving(tools?: string[]): object;
export function recordInteraction(prompt: string, response: string, feedback?: "accepted" | "edited" | "rejected", meta?: object): object;
export function recordStallEvent(info?: object): any;
export function getStallStats(): {
    total: number;
    timeouts: number;
    stallRate: number;
    perModel: object;
};
export function getLearningMetrics(): object;
export function resetLearningData(): {
    status: string;
};
export function exportModel(outPath?: string): {
    path: string;
    size: number;
};
export function importModel(filePath: string): {
    status: string;
    dataPoints: number;
} | {
    error: string;
};
export function getPersonalRecommendation(): {
    codeStyle: {
        naming: string;
        indent: number;
    };
    tools: string[];
    strategy: string;
    confidence: number;
};
export function getInteractions(): Array<{
    ts: string;
    prompt: string;
    responseLen: number;
    feedback: string;
}>;
export function storeShadowExample(prompt: string, shadowResponse: string, meta?: object): {
    status: string;
    id: string;
};
export function getShadowExamples(currentPrompt: string, limit?: number, taskType?: string): Promise<Array<{
    prompt: string;
    shadowResponse: string;
    similarityScore: number;
}>>;
export function calculateSimilarity(a: string, b: string): number;
export function getPersona(persona?: string): {
    label: string;
    desc: string;
    prompt: string;
};
export function getPersonaList(): Array<{
    name: string;
    label: string;
    desc: string;
}>;
export function getTraits(): object;
export function setTrait(key: string, val: number): {
    ok: boolean;
    error?: string;
    trait?: string;
    val?: number;
};
export function detectUserLevel(msg: string): string;
export function analyzeUserLevel(msg: string): {
    persona: string;
    label: string;
    reason: string;
    confidence: string;
};
export function getProLevel(level?: number): {
    label: string;
    desc: string;
    prompt: string;
};
export function getProLevelPrompt(level?: number, persona?: string, userMsg?: string): string;
export function getPrivacyInfo(): object;
export function getLearningSuggestions(): string[];
export function formatProgress(val: number, max: number, width?: number): string;
export function summarizeMetrics(): string;
export class Metrics {
    d: any;
    _init(): {
        level: number;
        dataPoints: number;
        accuracy: number;
        improvements: never[];
        nextMilestone: string;
        interactions: {
            accepted: number;
            edited: number;
            rejected: number;
        };
        stalls: {
            total: number;
            timeouts: number;
            stallRate: number;
        };
        lastUpdated: number;
    };
    _load(): any;
    save(): void;
    get(): any;
    record(feedback: any, stallType: any): void;
    _adv(): void;
}
declare const BASE: string;
export { BASE as MODELS_DIR };
//# sourceMappingURL=self-learning.d.ts.map