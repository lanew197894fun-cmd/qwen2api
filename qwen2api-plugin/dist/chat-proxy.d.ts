export function startProxy(): Promise<any>;
export const PROXY_PORT: number;
export function getRouteInfo(): {
    enabled: boolean;
    levels: {
        small: any;
        medium: any;
        large: any;
    };
    detected: {
        small: any;
        medium: any;
        large: any;
    } | null;
};
//# sourceMappingURL=chat-proxy.d.ts.map