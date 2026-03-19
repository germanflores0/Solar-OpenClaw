import { RuntimeCapabilities } from './types.js';
/**
 * Detect runtime capabilities from the api object.
 */
export declare function detectCapabilities(api: any): RuntimeCapabilities;
declare function handler(eventOrApi: any, ctx?: any): {
    prependContext?: string;
} | void;
declare const dual: typeof handler & {
    id: string;
    register: (api: any) => void;
    activate: () => Promise<void>;
};
export default dual;
