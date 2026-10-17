import type { ResponseData, ResponsePair, SlimClaim } from './types'
import { fmt } from './time'

interface Props {
  data: ResponseData
  t: number
  onSeek: (t: number) => void
  onFocusEmd: (code: string) => void
}

// Mini axis window: 3/24 12:00 → 3/26 06:00 covers every reviewed pair.
const W0 = 3 * 1440 + 12 * 60
const W1 = 5 * 1440 + 6 * 60
const AX_W = 230

const px = (m: number) => Math.max(0, Math.min(AX_W, ((m - W0) / (W1 - W0)) * AX_W))
const signed = (v: number | null | undefined) => (v == null ? null : `${v > 0 ? '+' : ''}${v}분`)
const prec = (c: SlimClaim | null) => (c ? `${c.precision === 'hour' ? '시 단위' : c.precision === 'minute' ? '분 단위' : '시각 미상'}${c.approximate ? '·근사' : ''}` : '')

function ClaimLine({ label, c, cls }: { label: string; c: SlimClaim | null; cls: string }) {
  return (
    <div className={`rp-claim ${cls}`}>
      <span className="rp-sym" />
      <span className="rp-label">{label}</span>
      <span className="rp-time">{c?.t != null ? fmt(c.t) : c ? '시각 미상' : '기록 없음'}</span>
      {c && (
        <span className="rp-meta">
          {prec(c)} · {c.source_kind === 'gov_document' ? '정부 원문' : c.source_kind === 'gov_statement_via_press' ? '정부 발언(보도)' : '보도'}
          {c.url && (
            <>
              {' '}
              <a href={c.url} target="_blank" rel="noreferrer">
                원문 ↗
              </a>
            </>
          )}
        </span>
      )}
    </div>
  )
}

function Pair({ q, t, onSeek, onFocusEmd }: { q: ResponsePair; t: number; onSeek: (t: number) => void; onFocusEmd: (c: string) => void }) {
  const sat = q.satellite.t
  const satSensor = sat != null && q.satellite.viirs === sat ? 'VIIRS' : sat != null && q.satellite.modis === sat ? 'MODIS' : ''
  return (
    <article className="rp-row">
      <header>
        <button
          className="rp-title"
          onClick={() => {
            onFocusEmd(q.code)
            const to = q.spread?.t ?? q.response?.t ?? q.satellite.t
            if (to != null) onSeek(to)
          }}
        >
          {q.sigungu} {q.emd}
        </button>
        <span className="rp-pop">
          주민 {q.total?.toLocaleString()}명 · 70세+ {q.age70share != null ? Math.round(q.age70share * 100) : '–'}%
        </span>
      </header>
      <svg className="rp-axis" width={AX_W} height={26} onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        onSeek(Math.round(W0 + ((e.clientX - r.left) / AX_W) * (W1 - W0)))
      }}>
        <line x1={0} x2={AX_W} y1={13} y2={13} className="rp-base" />
        {[4 * 1440, 5 * 1440].map((d) => (
          <g key={d}>
            <line x1={px(d)} x2={px(d)} y1={6} y2={20} className="rp-day" />
            <text x={px(d) + 2} y={25} className="rp-tick">3/{21 + d / 1440}</text>
          </g>
        ))}
        {q.spread?.t != null && <polygon points={`${px(q.spread.t)},5 ${px(q.spread.t) + 5},16 ${px(q.spread.t) - 5},16`} className="rp-spread" />}
        {q.response?.t != null && <rect x={px(q.response.t) - 4} y={8} width={8} height={10} className="rp-response" />}
        {sat != null && <circle cx={px(sat)} cy={13} r={5} className={`rp-sat ${satSensor.toLowerCase()}`} />}
        {t >= W0 && t <= W1 && <line x1={px(t)} x2={px(t)} y1={2} y2={24} className="rp-now" />}
      </svg>
      <ClaimLine label="진입 기록" c={q.spread} cls="spread" />
      <ClaimLine label={q.role === 'order_issued' ? '대피명령 기록' : q.role === 'sms_sent' ? '재난문자 기록' : '대응 기록'} c={q.response} cls="response" />
      <div className="rp-claim satellite">
        <span className="rp-sym" />
        <span className="rp-label">위성 첫 탐지</span>
        <span className="rp-time">{sat != null ? fmt(sat) : '없음'}</span>
        <span className="rp-meta">{satSensor} · 읍면동 경계 안 첫 열점(관측 시각)</span>
      </div>
      <div className="rp-gaps">
        <span>
          대응−진입 <b>{signed(q.gap_response_minus_spread) ?? `불가(${q.gap_reason})`}</b>
        </span>
        <span>
          위성−진입 <b>{signed(q.gap_satellite_minus_spread) ?? '불가'}</b>
        </span>
        <span>
          위성−대응 <b>{signed(q.gap_satellite_minus_response) ?? '불가'}</b>
        </span>
        {q.approximate && <span className="rp-approx">‘께·쯤’ 근사 시각 포함</span>}
      </div>
      {q.spatial !== 'emd' && (
        <div className="rp-note">
          {q.spatial === 'route_endpoint_to_emd' ? '도로 통제 구간의 끝점을 읍면과 연결한 비교' : '특정 리·시설 기록을 읍면 단위 위성 관측과 비교'}
        </div>
      )}
    </article>
  )
}

export default function Response({ data, t, onSeek, onFocusEmd }: Props) {
  return (
    <div className="pane response">
      <p className="rp-intro">
        같은 읍면동에서 <b>산불 진입이 보도된 시각</b>, <b>대응이 기록된 시각</b>, <b>위성이 처음 열점을 본 시각</b>을 나란히 놓습니다. 세 시각은 모두 ‘기록된’ 시각이지
        실제 발생·수신 시각이 아닙니다. 위성만 보면 대응이 불보다 먼저 온 것처럼 보이는 곳이 생깁니다.
      </p>
      <div className="rp-legend">
        <span className="spread">▲ 진입 기록</span>
        <span className="response">■ 대응 기록</span>
        <span className="satellite">● 위성 첫 탐지</span>
      </div>
      {data.pairs.map((q, i) => (
        <Pair key={i} q={q} t={t} onSeek={onSeek} onFocusEmd={onFocusEmd} />
      ))}
      <h3>열점은 탐지됐지만 읍면 단위 기록을 찾지 못한 곳 ({data.no_record.length})</h3>
      <p className="rp-norecord">
        {data.no_record.map((r) => (
          <button key={r.code} className="chip-btn" onClick={() => onFocusEmd(r.code)} title={`위성 첫 탐지 ${fmt(r.first_hit)}`}>
            {r.sigungu.replace(/[시군]$/, '')} {r.emd}
          </button>
        ))}
      </p>
      <p className="note">
        여기에 없다고 대응이 없었다는 뜻이 아닙니다. 수집한 보도 70건에 읍면 단위 시각이 적힌 사례만 비교했습니다. 재난문자 발송 원장·기상특보 이력이 확보되면 이 표를
        다시 계산합니다. 매핑 검토 전문: <code>data/raw/claims_review.md</code>
      </p>
    </div>
  )
}
