export const AUTO_SAVE_INTERVAL_MS = 5_000

export type SavePhase = 'saved' | 'pending' | 'saving' | 'failed' | 'conflict'

export type SaveView = {
  phase: SavePhase
  baseline: string
  baselineVersion: number
  draft: string
}

const labels: Record<SavePhase, string> = {
  saved: '저장됨',
  pending: '저장 대기',
  saving: '저장 중',
  failed: '실패',
  conflict: '충돌',
}

export function savePhaseLabel(phase: SavePhase): string {
  return labels[phase]
}

export function createSaveView(body: string, version: number): SaveView {
  return {
    phase: 'saved',
    baseline: body,
    baselineVersion: version,
    draft: body,
  }
}

export function applyDraft(view: SaveView, draft: string): SaveView {
  if (view.phase === 'saving' || view.phase === 'conflict') {
    return { ...view, draft }
  }
  if (draft === view.baseline) {
    return { ...view, draft, phase: 'saved' }
  }
  if (view.phase === 'failed') {
    return { ...view, draft }
  }
  return { ...view, draft, phase: 'pending' }
}

export function beginSave(view: SaveView): { view: SaveView, snapshot: string, baseVersion: number } | null {
  if (view.phase === 'saving' || view.phase === 'conflict') {
    return null
  }
  if (view.draft === view.baseline) {
    return null
  }
  return {
    view: { ...view, phase: 'saving' },
    snapshot: view.draft,
    baseVersion: view.baselineVersion,
  }
}

export function applySaveSuccess(view: SaveView, snapshot: string, version: number): SaveView {
  return {
    phase: view.draft === snapshot ? 'saved' : 'pending',
    baseline: snapshot,
    baselineVersion: version,
    draft: view.draft,
  }
}

export function applySaveConflict(view: SaveView): SaveView {
  return { ...view, phase: 'conflict' }
}

export function applySaveFailure(view: SaveView): SaveView {
  return { ...view, phase: 'failed' }
}

export function shouldAutoSave(view: SaveView): boolean {
  return beginSave(view) !== null
}

export function isMemoConflict(error: unknown): boolean {
  if (readStatus(error) === 409) {
    return true
  }
  return readErrorMessage(error).includes('저장 버전이 달라')
}

function readStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined
  }
  const record = error as {
    statusCode?: unknown
    status?: unknown
    response?: { status?: unknown }
  }
  if (typeof record.statusCode === 'number') {
    return record.statusCode
  }
  if (typeof record.status === 'number') {
    return record.status
  }
  if (typeof record.response?.status === 'number') {
    return record.response.status
  }
  return undefined
}

function readErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return ''
  }
  const record = error as { message?: unknown, data?: unknown }
  const nested = readNestedMessage(record.data)
  if (nested) {
    return nested
  }
  return typeof record.message === 'string' ? record.message : ''
}

function readNestedMessage(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return ''
  }
  const record = data as { message?: unknown, data?: { message?: unknown } }
  if (typeof record.data?.message === 'string') {
    return record.data.message
  }
  if (typeof record.message === 'string') {
    return record.message
  }
  return ''
}
