export interface ReportEmailData {
  to: string
  userName: string
  reportDate: string
  changes: Array<{
    url: string
    urlName: string
    summary: string
    importance: 'high' | 'medium' | 'low'
    insights: string[]
  }>
}

const MOCK_ENABLED = !process.env.RESEND_API_KEY

export async function sendReportEmail(data: ReportEmailData): Promise<{ success: boolean; id?: string }> {
  const html = buildReportHtml(data)

  if (MOCK_ENABLED) {
    console.log('=== MOCK EMAIL ===')
    console.log(`To: ${data.to}`)
    console.log(`Subject: 【CompAI】${data.reportDate} 競合レポート`)
    console.log(`Changes: ${data.changes.length}件`)
    console.log('==================')
    return { success: true, id: 'mock-' + Date.now() }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'CompAI <reports@compai.app>',
        to: data.to,
        subject: `【CompAI】${data.reportDate} 競合レポート`,
        html,
      }),
    })
    const result = await response.json()
    return { success: true, id: result.id }
  } catch (error) {
    console.error('Failed to send email:', error)
    return { success: false }
  }
}

function buildReportHtml(data: ReportEmailData): string {
  const importanceColor = { high: '#EF4444', medium: '#F59E0B', low: '#10B981' }
  const importanceLabel = { high: '重要', medium: '注目', low: '軽微' }

  const changesHtml = data.changes.map(change => `
    <div style="border:1px solid #E5E7EB;border-radius:8px;padding:16px;margin-bottom:16px">
      <div style="margin-bottom:8px">
        <strong style="font-size:16px;color:#1F2937">${change.urlName}</strong>
        <span style="background:${importanceColor[change.importance]};color:white;padding:2px 8px;border-radius:4px;font-size:12px;margin-left:8px">
          ${importanceLabel[change.importance]}
        </span>
      </div>
      <p style="color:#6B7280;font-size:13px;margin:4px 0">${change.url}</p>
      <p style="color:#374151;font-size:14px;line-height:1.6">${change.summary}</p>
      <div style="margin-top:12px">
        <p style="font-size:13px;font-weight:600;color:#4B5563;margin-bottom:4px">分析:</p>
        <ul style="margin:0;padding-left:20px">
          ${change.insights.map(i => `<li style="color:#6B7280;font-size:13px;margin-bottom:4px">${i}</li>`).join('')}
        </ul>
      </div>
    </div>
  `).join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#F9FAFB">
  <div style="background:white;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
    <div style="text-align:center;margin-bottom:24px">
      <h1 style="font-size:24px;color:#111827;margin:0">CompAI</h1>
      <p style="color:#6B7280;font-size:14px">競合レポート - ${data.reportDate}</p>
    </div>
    <p style="color:#374151;font-size:14px">${data.userName}さん、今週の競合レポートです。${data.changes.length}件の変更が検出されました。</p>
    <div style="margin-top:24px">${changesHtml}</div>
    <div style="text-align:center;margin-top:32px;padding-top:16px;border-top:1px solid #E5E7EB">
      <a href="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/dashboard" style="background:#2563EB;color:white;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px">ダッシュボードで詳細を確認</a>
    </div>
    <p style="color:#9CA3AF;font-size:12px;text-align:center;margin-top:24px">CompAI - 競合監視を自動化</p>
  </div>
</body></html>`
}
