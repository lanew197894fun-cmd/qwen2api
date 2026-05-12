export const PLATFORM: NodeJS.Platform;
export const IS_WIN: boolean;
export const IS_MAC: boolean;
export const IS_LINUX: boolean;
export function getPath(name: any): any;
export function killPort(port: any): void;
export function execShell(cmd: any, opts?: {}): {
    stdout: any;
    stderr: any;
    exitCode: any;
};
export function execGrep(pattern: any, filePath: any, includes?: any[]): {
    stdout: any;
    stderr: any;
    exitCode: any;
};
export function onSafeSignal(signal: any, handler: any): void;
export function detectGpuMac(): string | null;
//# sourceMappingURL=platform.d.ts.map