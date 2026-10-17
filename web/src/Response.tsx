import type { FullMentionsData, ResponseData, ResponsePair, SlimClaim } from './types'
import { fmt, fmtDay } from './time'

interface Props {
  data: ResponseData
  full: FullMentionsData | null
  emdNames: Record<string, string>
  t: number
  onSeek: (t: number) => void
  onFocusEmd: (code: string) => void
}

const AX_W = 230
// Mini axis window: from 6 h before the earliest reviewed record to 6 h after the latest.
let W0 = 0
let W1 = 1440
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

function Pair({ q, t, auto, onSeek, onFocusEmd }: { q: ResponsePair; t: number; auto: FullMentionsData['by_emd'][string] | null; onSeek: (t: number) => void; onFocusEmd: (c: string) => void }) {
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
        {Array.from({ length: Math.floor(W1 / 1440) - Math.floor(W0 / 1440) }, (_, i) => (Math.floor(W0 / 1440) + 1 + i) * 1440).map((d) => (
          <g key={d}>
            <line x1={px(d)} x2={px(d)} y1={6} y2={20} className="rp-day" />
            <text x={px(d) + 2} y={25} className="rp-tick">{fmtDay(d)}</text>
          </g>
        ))}
        {q.spread?.t != null && <polygon points={`${px(q.spread.t)},5 ${px(q.spread.t) + 5},16 ${px(q.spread.t) - 5},16`} className="rp-spread" />}
        {q.response?.t != null && <rect x={px(q.response.t) - 4} y={8} width={8} height={10} className="rp-response" />}
        {sat != null && <circle cx={px(sat)} cy={13} r={5} className={`rp-sat ${satSensor.toLowerCase()}`} />}
        {t >= W0 && t <= W1 && <line x1={px(t)} x2={px(t)} y1={2} y2={24} className="rp-now" />}
      </svg>
      <ClaimLine label="진입 기록" c={q.spread} cls="spread" />
      <ClaimLine label={q.role === 'order_issued' ? '대피명령 기록' : q.role === 'sms_sent' ? '재난문자 기록' : '행정 기록'} c={q.response} cls="response" />
      <div className="rp-claim satellite">
        <span className="rp-sym" />
        <span className="rp-label">위성 첫 탐지</span>
        <span className="rp-time">{sat != null ? fmt(sat) : '없음'}</span>
        <span className="rp-meta">{satSensor} · 읍면동 경계 안 첫 열점(관측 시각)</span>
      </div>
      <div className="rp-gaps">
        <span>
          진입 보도→행정 기록 <b>{signed(q.gap_response_minus_spread) ?? `불가(${q.gap_reason})`}</b>
        </span>
        <span>
          진입 보도→위성 <b>{signed(q.gap_satellite_minus_spread) ?? '불가'}</b>
        </span>
        <span>
          행정 기록→위성 <b>{signed(q.gap_satellite_minus_response) ?? '불가'}</b>
        </span>
        {q.approximate && <span className="rp-approx">‘께·쯤’ 근사 시각 포함</span>}
      </div>
      {auto && (
        <div className="rp-auto">
          본문 자동 추출 후보 최초:{' '}
          {(['spread', 'evacuation', 'alert', 'control'] as const)
            .filter((k) => auto.first[k] != null)
            .map((k) => (
              <button key={k} className="link-row inline" onClick={() => onSeek(auto.first[k]!)}>
                {({ spread: '확산', evacuation: '대피', alert: '문자', control: '통제' } as Record<string, string>)[k]} {fmt(auto.first[k]!, false)}
              </button>
            ))}
          <small> (미검토 후보)</small>
        </div>
      )}
      {q.spatial !== 'emd' && (
        <div className="rp-note">
          {q.spatial === 'route_endpoint_to_emd' ? '도로 통제 구간의 끝점을 읍면과 연결한 비교' : '특정 리·시설 기록을 읍면 단위 위성 관측과 비교'}
        </div>
      )}
    </article>
  )
}

export default function Response({ data, full, emdNames, t, onSeek, onFocusEmd }: Props) {
  const ts = data.pairs.flatMap((q) => [q.spread?.t, q.response?.t, q.satellite.t]).filter((v): v is number => v != null)
  W0 = Math.min(...ts) - 360
  W1 = Math.max(...ts) + 360
  return (
    <div className="pane response">
      <p className="rp-intro">
        같은 읍면동에 대해 <b>산불 진입이 보도된 시각</b>, <b>대피명령·재난문자가 기록된 시각</b>, <b>위성이 처음 열점을 본 시각</b>을 나란히 놓습니다. 세 시각은 모두
        출처가 다른 ‘기록’의 시각이며 실제 발생·발령·수신 시각과 다를 수 있습니다. <b>이 간격은 대응이 빨랐는지 늦었는지를 판단하는 지표가 아닙니다.</b> 어떤 기록을
        기준으로 삼느냐에 따라 순서가 달라진다는 것을 보여 주기 위한 대조입니다.
      </p>
      <div className="rp-legend">
        <span className="spread">▲ 진입 기록</span>
        <span className="response">■ 행정 기록(대피명령·재난문자)</span>
        <span className="satellite">● 위성 첫 탐지</span>
      </div>
      {data.pairs.map((q, i) => (
        <Pair key={i} q={q} t={t} auto={full?.by_emd[q.code] ?? null} onSeek={onSeek} onFocusEmd={onFocusEmd} />
      ))}
      {full && (
        <>
          <h3>자동 추출 후보 (검토 전, {Object.keys(full.by_emd).length}개 읍면동)</h3>
          <p className="note">기사 본문 문장에서 기계로 뽑은 가장 이른 시각입니다. 표본 정밀도 약 67%. 위성 첫 탐지와 함께 두어 어느 기록부터 확인할지 정하는 용도이며, 이 시각 차이를 수치로 인용하면 안 됩니다.</p>
          <table className="cmp-table rp-cand">
            <thead>
              <tr>
                <th>읍면동</th>
                <th>확산</th>
                <th>대피</th>
                <th>문자</th>
                <th>위성</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(full.by_emd)
                .map(([code, m]) => ({ code, m, name: emdNames[code] ?? code, sat: data.rows.find((r) => r.code === code)?.satellite.t ?? data.no_record.find((r) => r.code === code)?.first_hit ?? null }))
                .filter((r) => r.m.first.spread != null || r.m.first.evacuation != null || r.m.first.alert != null)
                .sort((a, b) => (Math.min(a.m.first.spread ?? 1e9, a.m.first.evacuation ?? 1e9, a.m.first.alert ?? 1e9)) - (Math.min(b.m.first.spread ?? 1e9, b.m.first.evacuation ?? 1e9, b.m.first.alert ?? 1e9)))
                .map((r) => (
                  <tr key={r.code} onClick={() => onFocusEmd(r.code)}>
                    <td>{r.name}</td>
                    <td>{r.m.first.spread != null ? fmt(r.m.first.spread) : '–'}</td>
                    <td>{r.m.first.evacuation != null ? fmt(r.m.first.evacuation) : '–'}</td>
                    <td>{r.m.first.alert != null ? fmt(r.m.first.alert) : '–'}</td>
                    <td>{r.sat != null ? fmt(r.sat) : '–'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
      <h3>열점은 탐지됐지만 읍면 단위 기록을 찾지 못한 곳 ({data.no_record.length})</h3>
      <p className="rp-norecord">
        {data.no_record.map((r) => (
          <button key={r.code} className="chip-btn" onClick={() => onFocusEmd(r.code)} title={`위성 첫 탐지 ${fmt(r.first_hit)}`}>
            {r.sigungu.replace(/[시군]$/, '')} {r.emd}
          </button>
        ))}
      </p>
      <p className="note">
        여기에 없다고 대피명령·재난문자가 없었다는 뜻이 아닙니다. 수집한 보도 70건에 읍면 단위 시각이 적힌 사례만 비교했습니다. 재난문자 발송 원장·기상특보 이력이 확보되면 이 표를
        다시 계산합니다. 매핑 검토 전문: <code>data/raw/claims_review.md</code>
      </p>
    </div>
  )
}
