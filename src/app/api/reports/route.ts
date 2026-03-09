import { NextResponse } from 'next/server'

const mockReports = [
  {
    id: '1',
    created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    sent_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    email_opened: true,
    report_data: {
      changes: [
        {
          url: 'https://example-competitor.com',
          urlName: '競合A社',
          summary: '競合A社がトップページのCTAを変更。価格も月額9,800円から12,800円に値上げしました。',
          importance: 'high' as const,
          insights: ['価格改定は市場ポジショニングの変更を示唆', '新機能追加により競争力強化の可能性'],
        },
      ],
    },
  },
  {
    id: '2',
    created_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    sent_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    email_opened: false,
    report_data: {
      changes: [
        {
          url: 'https://another-competitor.com',
          urlName: '競合B社',
          summary: '競合B社が新しいブログ記事を3本追加。SEO対策を強化している模様。',
          importance: 'medium' as const,
          insights: ['コンテンツマーケティングへの投資を強化'],
        },
      ],
    },
  },
]

export async function GET() {
  return NextResponse.json({ reports: mockReports })
}
