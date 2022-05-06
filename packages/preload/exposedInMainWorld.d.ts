interface Window {
    /**
     * Expose Environment versions.
     * @example
     * console.log( window.versions )
     */
    readonly versions: NodeJS.ProcessVersions;
    /**
     * Expose the user data path.
     * intended to be used in a vuex store plugin
     */
    readonly getPath: (path: import('./src/config').Paths) => Promise<string>;
    readonly apiServer: { startServer: (payload: import('../main/src/types/forkedAPI').startPayload) => Promise<import('../main/src/types/forkedAPI').ForkResponse>; stopServer: () => Promise<import('../main/src/types/forkedAPI').ForkResponse>; getEnv: string; };
}
