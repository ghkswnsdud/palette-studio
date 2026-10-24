import { useRef, useState } from 'react'
import type { SavedPalette } from '../utils/paletteStorage'

interface PaletteLibraryProps {
  name: string
  currentId: string | null
  hasColors: boolean
  palettes: SavedPalette[]
  error: string | null
  onNameChange: (name: string) => void
  onSave: () => void
  onSaveAsNew: () => void
  onLoad: (id: string) => void
  onDelete: (id: string) => void
  onExportJson: () => void
  onExportAllJson: () => void
  onExportPng: () => void
  onImportFile: (file: File) => void
}

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

/** 팔레트 이름·저장·내보내기와 저장된 팔레트 목록 */
export function PaletteLibrary({
  name,
  currentId,
  hasColors,
  palettes,
  error,
  onNameChange,
  onSave,
  onSaveAsNew,
  onLoad,
  onDelete,
  onExportJson,
  onExportAllJson,
  onExportPng,
  onImportFile,
}: PaletteLibraryProps) {
  const importRef = useRef<HTMLInputElement>(null)
  // 삭제는 실수 방지를 위해 한 번 더 눌러야 실행됩니다.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const isSaved = currentId !== null && palettes.some((p) => p.id === currentId)

  return (
    <>
      <section className="panel-section">
        <div className="section-title">
          <h2>팔레트 저장</h2>
          {isSaved && <span className="badge">저장된 팔레트</span>}
        </div>

        <label className="field">
          <span>팔레트 이름</span>
          <input
            type="text"
            className="name-input"
            value={name}
            maxLength={50}
            placeholder="이름 없는 팔레트"
            onChange={(e) => onNameChange(e.target.value)}
          />
        </label>

        <div className="button-row">
          <button type="button" className="btn btn-primary" onClick={onSave} disabled={!hasColors}>
            {isSaved ? '변경 사항 저장' : '저장'}
          </button>
          {isSaved && (
            <button type="button" className="btn" onClick={onSaveAsNew} disabled={!hasColors}>
              새로 저장
            </button>
          )}
        </div>

        <div className="button-row">
          <button type="button" className="btn" onClick={onExportJson} disabled={!hasColors}>
            JSON 내보내기
          </button>
          <button type="button" className="btn" onClick={onExportPng} disabled={!hasColors}>
            PNG 내보내기
          </button>
          <button type="button" className="btn" onClick={() => importRef.current?.click()}>
            JSON 가져오기
          </button>
        </div>
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onImportFile(file)
            e.target.value = ''
          }}
        />

        {error && (
          <p className="upload-error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="panel-section panel-grow">
        <div className="section-title">
          <h2>저장된 팔레트 ({palettes.length})</h2>
          {palettes.length > 0 && (
            <button type="button" className="btn btn-link" onClick={onExportAllJson}>
              전체 내보내기
            </button>
          )}
        </div>

        {palettes.length === 0 ? (
          <p className="empty-hint">저장한 팔레트가 여기에 표시됩니다.</p>
        ) : (
          <ul className="library-list">
            {palettes.map((p) => (
              <li key={p.id} className={`library-card${p.id === currentId ? ' is-current' : ''}`}>
                <div className="library-strip" aria-hidden="true">
                  {p.colors.map((hex, i) => (
                    <span key={i} style={{ background: hex }} />
                  ))}
                </div>
                <div className="library-meta">
                  <strong title={p.name}>{p.name}</strong>
                  <small title={`만든 시각: ${formatTime(p.createdAt)}`}>
                    {p.colors.length}색 · {formatTime(p.updatedAt)} 수정
                  </small>
                </div>
                <div className="library-actions">
                  <button type="button" className="btn btn-small" onClick={() => onLoad(p.id)}>
                    불러오기
                  </button>
                  {pendingDeleteId === p.id ? (
                    <button
                      type="button"
                      className="btn btn-small btn-danger"
                      onClick={() => {
                        setPendingDeleteId(null)
                        onDelete(p.id)
                      }}
                      onBlur={() => setPendingDeleteId(null)}
                      autoFocus
                    >
                      삭제 확인
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => setPendingDeleteId(p.id)}
                    >
                      삭제
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
