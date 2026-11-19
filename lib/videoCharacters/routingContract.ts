/** Qualified extraction endpoints. The scheduler still verifies physical GPU admission. */
export const EXTRACTION_WORKERS = {
 rtx3090: "http://100.75.162.64:8188",
 rtx5060ti: "http://100.98.212.116:8188",
 rtx3060: "http://127.0.0.1:8190",
} as const;
export type ExtractionGpu = keyof typeof EXTRACTION_WORKERS;
