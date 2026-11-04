import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  AUTO_SAVE_INTERVAL_MS,
  applyDraft,
  applySaveConflict,
  applySaveFailure,
  applySaveSuccess,
  beginSave,
  createSaveView,
  isMemoConflict,
  savePhaseLabel,
  shouldAutoSave,
} from '../utils/memo-save'

const root = process.cwd()

function main(): void {
  assert(AUTO_SAVE_INTERVAL_MS === 5_000, '자동 저장 주기가 5초가 아닙니다.')
  const assignments = walk(root).filter((file) => {
    const relative = file.slice(root.length).replaceAll('\\', '/')
    return !relative.includes('/node_modules/')
      && !relative.includes('/.nuxt/')
      && !relative.includes('/.output/')
      && /\.(vue|ts|js|mjs)$/.test(relative)
      && /AUTO_SAVE_INTERVAL_MS\s*=\s*\d/.test(readFileSync(file, 'utf8'))
  })
  assert(assignments.length === 1, '자동 저장 주기가 한 곳에 정해져 있지 않습니다.')

  const labels = ['저장 중', '저장됨', '실패', '충돌']
  const phases = ['saving', 'saved', 'failed', 'conflict'] as const
  assert(new Set(phases.map((phase) => savePhaseLabel(phase))).size === labels.length, '저장 상태가 서로 구분되지 않습니다.')
  for (const label of labels) {
    assert(phases.some((phase) => savePhaseLabel(phase) === label), `${label} 표시가 없습니다.`)
  }

  let view = createSaveView('처음', 1)
  assert(view.phase === 'saved' && !shouldAutoSave(view) && beginSave(view) === null, '저장된 본문에 요청을 보냅니다.')

  view = applyDraft(view, '고침')
  assert(view.phase === 'pending' && view.draft === '고침', '본문이 달라져도 저장 대기가 되지 않습니다.')
  const started = beginSave(view)
  assert(started?.snapshot === '고침' && started.baseVersion === 1 && started.view.phase === 'saving', '수동 저장이 그 시점의 스냅샷을 잡지 않습니다.')
  assert(beginSave(started.view) === null && !shouldAutoSave(started.view), '저장 중에 요청을 또 보냅니다.')

  const typedWhileSaving = applyDraft(started.view, '고침 그리고 더')
  assert(typedWhileSaving.phase === 'saving' && typedWhileSaving.draft === '고침 그리고 더', '저장 중에 입력이 반영되지 않습니다.')
  const diverged = applySaveSuccess(typedWhileSaving, started.snapshot, 2)
  assert(diverged.phase === 'pending' && diverged.baseline === '고침' && diverged.baselineVersion === 2, '응답 뒤 바뀐 본문이 저장 대기로 남지 않습니다.')
  assert(diverged.draft === '고침 그리고 더' && beginSave(diverged) !== null, '이어서 다시 저장하지 못합니다.')

  const caughtUp = applySaveSuccess(started.view, started.snapshot, 2)
  assert(caughtUp.phase === 'saved' && caughtUp.baseline === '고침' && caughtUp.baselineVersion === 2, '스냅샷과 같은 화면이 저장됨이 되지 않습니다.')

  const conflicted = applySaveConflict(applyDraft(started.view, '화면 유지'))
  assert(conflicted.phase === 'conflict' && conflicted.draft === '화면 유지' && conflicted.baseline === '처음', '충돌 때 화면 본문이나 기준이 바뀝니다.')
  assert(beginSave(conflicted) === null && !shouldAutoSave(conflicted), '충돌 상태에서 서버로 저장을 보냅니다.')

  const failed = applySaveFailure(applyDraft(started.view, '실패 후에도 유지'))
  assert(failed.phase === 'failed' && failed.draft === '실패 후에도 유지' && failed.baseline === '처음', '실패 때 화면 본문이 유지되지 않습니다.')
  assert(shouldAutoSave(failed) && beginSave(failed)?.snapshot === '실패 후에도 유지', '실패 뒤 다시 저장하지 못합니다.')
  assert(applyDraft(failed, '처음').phase === 'saved', '실패 뒤 기준과 같아져도 저장됨이 되지 않습니다.')

  assert(isMemoConflict({ statusCode: 409 }), '409를 충돌로 보지 않습니다.')
  assert(isMemoConflict({ data: { message: '저장 버전이 달라 저장하지 못했습니다.' } }), '충돌 메시지를 충돌로 보지 않습니다.')
  assert(!isMemoConflict(new Error('네트워크 오류')), '네트워크 오류를 충돌로 봅니다.')
  assert(!isMemoConflict({ statusCode: 500, message: '서버 오류' }), '서버 오류를 충돌로 봅니다.')

  console.log('수동 저장과 자동 저장 검증을 통과했습니다.')
}

function walk(dir: string): string[] {
  const entries = readdirSync(dir)
  const files: string[] = []
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.nuxt' || entry === '.output' || entry === '.git') {
      continue
    }
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      files.push(...walk(path))
      continue
    }
    files.push(path)
  }
  return files
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

main()
