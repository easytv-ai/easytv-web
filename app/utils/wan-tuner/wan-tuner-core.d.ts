import type { WanTuningContext, WanTuningMedia, WanTuningMode, WanTuningResult, WanSourceAnalysis } from '../wanPromptTuning'
export const KNOWLEDGE_VERSION: string
export const TUNING_DOMAINS: readonly string[]
export const TUNING_MODES: readonly WanTuningMode[]
export const TUNING_OUTPUTS: readonly string[]
export function loadKnowledge(): Promise<Record<string, unknown>>
export function inferTuningMode(context: Partial<WanTuningContext> & { editIntent?: boolean }): WanTuningMode
export function normalizeTuningMedia(media: WanTuningMedia[]): WanTuningMedia[]
export function buildAnalysisMessages(context: WanTuningContext): Array<{ role: string, content: unknown }>
export function buildTuningMessages(context: WanTuningContext, sourceAnalysis: WanSourceAnalysis | null, knowledge: Record<string, unknown>): Array<{ role: string, content: unknown }>
export function parseAnalysisResult(text: string): WanSourceAnalysis
export function parseTuningResult(text: string, options?: { requireDiagnosis?: boolean, context?: WanTuningContext }): WanTuningResult
export function readEventStream(response: Response, onEvent: (event: unknown) => void, signal?: AbortSignal): Promise<unknown>
