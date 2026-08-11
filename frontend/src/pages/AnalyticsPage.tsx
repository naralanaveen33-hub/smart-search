import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Banner, Card, CardHeader, MetricCard, SectionTitle } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { useIndexing } from '@/hooks/useIndexing'
import { useTheme } from '@/hooks/useTheme'
import { api } from '@/services/api'
import { formatBytes, formatNumber } from '@/utils/format'

export function AnalyticsPage() {
  const { status } = useIndexing()
  const { theme } = useTheme()
  const { data, loading, error } = useAsync(() => api.analytics(), [status?.state])

  const axis = theme === 'dark' ? '#71717a' : '#a1a1aa'
  const grid = theme === 'dark' ? '#26262b' : '#e4e4e7'
  const accent = theme === 'dark' ? '#a78bfa' : '#6d28d9'
  const muted = theme === 'dark' ? '#3f3f46' : '#d4d4d8'

  const tooltipStyle = {
    backgroundColor: theme === 'dark' ? '#0e0e11' : '#ffffff',
    border: `1px solid ${grid}`,
    borderRadius: 6,
    fontSize: 12,
    fontFamily: 'ui-monospace, monospace',
    color: theme === 'dark' ? '#fafafa' : '#18181b',
    padding: '6px 10px',
  }

  const axisProps = {
    stroke: axis,
    fontSize: 10,
    tickLine: false,
    axisLine: { stroke: grid },
  }

  return (
    <div className="space-y-6">
      <SectionTitle
        eyebrow="Metrics"
        title="Analytics"
        description="Index composition, indexing cost and search behaviour — all measured from real runs."
      />

      {error && <Banner tone="error">{error}</Banner>}
      {loading && !data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((n) => (
            <div key={n} className="h-20 animate-pulse rounded-[8px] border border-line bg-surface" />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <MetricCard label="Documents" value={formatNumber(data.documents)} index={0} />
            <MetricCard label="Unique Terms" value={formatNumber(data.unique_terms)} index={1} />
            <MetricCard label="Index Size" value={formatBytes(data.index_size_bytes)} index={2} />
            <MetricCard label="Searches" value={formatNumber(data.searches)} index={3} />
            <MetricCard
              label="Avg Response"
              value={`${data.avg_response_ms.toFixed(1)} ms`}
              tone="accent"
              index={4}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Documents Indexed Over Time"
                description="Cumulative corpus size, last 14 days"
              />
              <div className="mt-4 h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.documents_over_time} margin={{ top: 4, right: 6, bottom: 0, left: -22 }}>
                    <CartesianGrid stroke={grid} strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="label" {...axisProps} />
                    <YAxis {...axisProps} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: grid }} />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke={accent}
                      strokeWidth={1.75}
                      dot={false}
                      name="Documents"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <CardHeader title="Searches Over Time" description="Queries executed per day" />
              <div className="mt-4 h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.searches_over_time} margin={{ top: 4, right: 6, bottom: 0, left: -22 }}>
                    <CartesianGrid stroke={grid} strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="label" {...axisProps} />
                    <YAxis {...axisProps} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: grid, fillOpacity: 0.3 }} />
                    <Bar dataKey="value" fill={accent} radius={[2, 2, 0, 0]} name="Searches" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Average Response Time"
                description="Mean query latency in milliseconds"
              />
              <div className="mt-4 h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.response_time_over_time} margin={{ top: 4, right: 6, bottom: 0, left: -22 }}>
                    <CartesianGrid stroke={grid} strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="label" {...axisProps} />
                    <YAxis {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: grid }} />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke={accent}
                      strokeWidth={1.75}
                      dot={false}
                      name="ms"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Most Frequent Terms"
                description="Highest collection frequency in the index"
              />
              <div className="mt-4 h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.top_terms.slice(0, 8)}
                    layout="vertical"
                    margin={{ top: 0, right: 12, bottom: 0, left: 14 }}
                  >
                    <CartesianGrid stroke={grid} strokeDasharray="2 4" horizontal={false} />
                    <XAxis type="number" {...axisProps} />
                    <YAxis type="category" dataKey="term" width={72} {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: grid, fillOpacity: 0.3 }} />
                    <Bar dataKey="occurrences" radius={[0, 2, 2, 0]} name="Occurrences">
                      {data.top_terms.slice(0, 8).map((entry, index) => (
                        <Cell key={entry.term} fill={index === 0 ? accent : muted} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card padded={false}>
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-[14px] font-semibold">Indexing Run</h2>
              <p className="mt-0.5 text-[12px] text-muted">Cost of the most recent BSBI build</p>
            </div>
            <div className="grid grid-cols-2 divide-x divide-[var(--border)] sm:grid-cols-4">
              {[
                ['Indexing Time', `${data.indexing_seconds.toFixed(2)} s`, undefined],
                ['Blocks Created', formatNumber(data.blocks), undefined],
                ['Avg Block Size', `${formatNumber(data.avg_block_size)} entries`, undefined],
                [
                  'Peak Buffer Usage',
                  `${formatNumber(data.peak_memory_entries)} entries`,
                  data.block_capacity
                    ? `${data.peak_memory_used}% of the ${formatNumber(data.block_capacity)}-posting block`
                    : undefined,
                ],
              ].map(([label, value, hint]) => (
                <div key={label as string} className="px-4 py-3.5">
                  <p className="text-[11px] tracking-wide text-subtle uppercase">{label}</p>
                  <p className="tabular mt-1 font-mono text-[17px] text-ink">{value}</p>
                  {hint && <p className="mt-1 text-[11px] text-subtle">{hint}</p>}
                </div>
              ))}
            </div>
            <p className="border-t border-line px-4 py-2.5 text-[11px] text-subtle">
              Peak buffer usage is the high-water mark of the in-memory posting block during the
              run — not process or OS memory, which SwiftSearch does not measure.
            </p>
          </Card>

          {data.top_queries.length > 0 && (
            <Card padded={false}>
              <div className="border-b border-line px-4 py-3">
                <h2 className="text-[13px] font-semibold">Top Queries</h2>
              </div>
              <ul>
                {data.top_queries.map((item) => (
                  <li
                    key={item.query}
                    className="flex items-center justify-between gap-4 border-b border-line px-4 py-2.5 last:border-0"
                  >
                    <span className="truncate text-[13px]">{item.query}</span>
                    <span className="tabular shrink-0 font-mono text-[11px] text-muted">
                      {item.count} search{item.count === 1 ? '' : 'es'}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
