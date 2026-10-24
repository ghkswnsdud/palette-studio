import { useRef, useState, type DragEvent } from 'react'
import { ACCEPT_ATTR, COLOR_COUNT_OPTIONS } from '../utils/extractColors'

interface ImageUploaderProps {
  imageSrc: string | null
  imageName: string
  /** 예: '1920×1080' */
  imageSize: string
  colorCount: number
  isExtracting: boolean
  error: string | null
  onFile: (file: File) => void
  onCountChange: (count: number) => void
  onReextract: () => void
}

/** 이미지를 클릭 또는 드래그&드롭으로 올리는 영역 */
export function ImageUploader({
  imageSrc,
  imageName,
  imageSize,
  colorCount,
  isExtracting,
  error,
  onFile,
  onCountChange,
  onReextract,
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const openPicker = () => {
    if (!isExtracting) inputRef.current?.click()
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    if (isExtracting) return
    const file = event.dataTransfer.files[0]
    if (file) onFile(file)
  }

  return (
    <section className="panel-section">
      <div className="section-title">
        <h2>이미지</h2>
        {imageSrc && (
          <button type="button" className="btn btn-link" onClick={openPicker}>
            변경
          </button>
        )}
      </div>

      <div
        className={`dropzone${isDragging ? ' is-dragging' : ''}${imageSrc ? ' has-image' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="이미지 업로드"
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') openPicker()
        }}
        onDragOver={(e) => {
          // 파일을 끌고 왔을 때만 놓기를 허용합니다.
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        {imageSrc ? (
          <img src={imageSrc} alt={imageName} className="dropzone-preview" />
        ) : (
          <div className="dropzone-empty">
            <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <p>
              <strong>클릭</strong>하거나 이미지를 <strong>끌어다 놓으세요</strong>
            </p>
            <span>JPG · JPEG · PNG · WebP · 최대 20MB</span>
          </div>
        )}
        {isDragging && <div className="dropzone-overlay">여기에 놓기</div>}
        {isExtracting && <div className="dropzone-overlay">색상 분석 중…</div>}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          // 같은 파일을 다시 골라도 onChange가 동작하도록 값을 비웁니다.
          e.target.value = ''
        }}
      />

      {error && (
        <p className="upload-error" role="alert">
          {error}
        </p>
      )}

      {imageSrc && (
        <p className="file-name" title={imageName}>
          {imageName}
          {imageSize && <span> · {imageSize}</span>}
        </p>
      )}

      <div className="field-row">
        <span>추출할 색상 수</span>
        <div className="segmented" role="group" aria-label="추출할 색상 수">
          {COLOR_COUNT_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              className={n === colorCount ? 'is-active' : ''}
              aria-pressed={n === colorCount}
              disabled={isExtracting}
              onClick={() => onCountChange(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="btn btn-block"
        onClick={onReextract}
        disabled={!imageSrc || isExtracting}
      >
        다시 추출하기
      </button>
    </section>
  )
}
