export function supportsColor(): boolean;
export namespace color {
    export { ESC };
    export { RESET };
    export { BOLD };
    export { DIM };
    export { ITALIC };
    export { UNDERLINE };
    export { ansi };
    export { rgb };
    export { bgRgb };
    export { hex };
    export { bgHex };
    export { ANSI16 };
    export { BG_ANSI16 };
    export { SEMANTIC };
    export { LEVEL_COLOR };
    export { TAG_COLOR };
    export { colorize };
    export { colorizeTag };
    export { colorizeLevel };
    export function tag(name: any): any;
    export function level(lvl: any): any;
    export function error(msg: any): any;
    export function warn(msg: any): any;
    export function info(msg: any): any;
    export function debug(msg: any): any;
    export function success(msg: any): any;
    export function primary(msg: any): any;
    export function secondary(msg: any): any;
    export function accent(msg: any): any;
    export function muted(msg: any): any;
    export function dim(msg: any): string;
    export function bold(msg: any): string;
}
export default color;
/**
 * color.js — ANSI color utilities for qwen2api-dev
 * Minimal, zero-dep, supports 16-color & TrueColor (24-bit)
 */
declare const ESC: "\u001B[";
declare const RESET: "\u001B[0m";
declare const BOLD: "\u001B[1m";
declare const DIM: "\u001B[2m";
declare const ITALIC: "\u001B[3m";
declare const UNDERLINE: "\u001B[4m";
declare function ansi(code: any): string;
declare function rgb(r: any, g: any, b: any): string;
declare function bgRgb(r: any, g: any, b: any): string;
declare function hex(hexColor: any): string;
declare function bgHex(hexColor: any): string;
declare namespace ANSI16 {
    let black: number;
    let red: number;
    let green: number;
    let yellow: number;
    let blue: number;
    let magenta: number;
    let cyan: number;
    let white: number;
    let gray: number;
    let brightRed: number;
    let brightGreen: number;
    let brightYellow: number;
    let brightBlue: number;
    let brightMagenta: number;
    let brightCyan: number;
    let brightWhite: number;
}
declare namespace BG_ANSI16 {
    let black_1: number;
    export { black_1 as black };
    let red_1: number;
    export { red_1 as red };
    let green_1: number;
    export { green_1 as green };
    let yellow_1: number;
    export { yellow_1 as yellow };
    let blue_1: number;
    export { blue_1 as blue };
    let magenta_1: number;
    export { magenta_1 as magenta };
    let cyan_1: number;
    export { cyan_1 as cyan };
    let white_1: number;
    export { white_1 as white };
    let gray_1: number;
    export { gray_1 as gray };
    let brightRed_1: number;
    export { brightRed_1 as brightRed };
    let brightGreen_1: number;
    export { brightGreen_1 as brightGreen };
    let brightYellow_1: number;
    export { brightYellow_1 as brightYellow };
    let brightBlue_1: number;
    export { brightBlue_1 as brightBlue };
    let brightMagenta_1: number;
    export { brightMagenta_1 as brightMagenta };
    let brightCyan_1: number;
    export { brightCyan_1 as brightCyan };
    let brightWhite_1: number;
    export { brightWhite_1 as brightWhite };
}
declare namespace SEMANTIC {
    let primary_1: string;
    export { primary_1 as primary };
    let secondary_1: string;
    export { secondary_1 as secondary };
    let accent_1: string;
    export { accent_1 as accent };
    let success_1: string;
    export { success_1 as success };
    export let warning: string;
    let error_1: string;
    export { error_1 as error };
    let info_1: string;
    export { info_1 as info };
    export let text: string;
    let muted_1: string;
    export { muted_1 as muted };
    let dim_1: string;
    export { dim_1 as dim };
}
declare namespace LEVEL_COLOR {
    import debug_1 = SEMANTIC.muted;
    export { debug_1 as debug };
    import info_2 = SEMANTIC.info;
    export { info_2 as info };
    import warn_1 = SEMANTIC.warning;
    export { warn_1 as warn };
    import error_2 = SEMANTIC.error;
    export { error_2 as error };
    import systemError = SEMANTIC.error;
    export { systemError };
}
declare const TAG_COLOR: {
    proxy: string;
    system: string;
    auto: string;
    ssxmod: string;
    account: string;
    cli: string;
    phase: string;
    parser: string;
    request: string;
    chat: string;
    push: string;
    peer: string;
    watch: string;
    "env-detect": any;
    role: any;
    governor: any;
    evolution: any;
    learning: any;
};
declare function colorize(text: any, color: any): any;
declare function colorizeTag(tag: any, color: any): any;
declare function colorizeLevel(level: any, color: any): any;
//# sourceMappingURL=color.d.ts.map