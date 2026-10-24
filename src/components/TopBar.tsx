interface TopBarProps {
  colorCount: number
  onCopyAll: () => void
}

/** 화면 맨 위의 상단 바: 로고와 전체 동작 버튼이 있습니다. */
export function TopBar({ colorCount, onCopyAll }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="topbar-logo" aria-hidden="true">
          <i style={{ background: '#FF6B6B' }} />
          <i style={{ background: '#FFD166' }} />
          <i style={{ background: '#06D6A0' }} />
          <i style={{ background: '#4D7CFE' }} />
        </span>
        <strong>Palette Studio</strong>
      </div>
      <div className="topbar-actions">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onCopyAll}
          disabled={colorCount === 0}
        >
          HEX 전체 복사
        </button>
      </div>
    </header>
  )
}
