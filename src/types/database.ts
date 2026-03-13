export type Plan = 'free' | 'standard'
export type Importance = 'high' | 'medium' | 'low'
export type CheckInterval = 'daily' | 'weekly'

export interface Profile {
  id: string
  email: string
  plan: Plan
  stripe_customer_id: string | null
  created_at: string
}

export interface MonitoredUrl {
  id: string
  user_id: string
  url: string
  name: string | null
  check_interval: CheckInterval
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Snapshot {
  id: string
  url_id: string
  content_hash: string | null
  content_text: string | null
  screenshot_url: string | null
  captured_at: string
}

export interface Change {
  id: string
  url_id: string
  snapshot_before_id: string | null
  snapshot_after_id: string | null
  diff_summary: string | null
  ai_analysis: string | null
  importance: Importance
  detected_at: string
}

export interface ReportData {
  changes: Array<{
    url: string
    urlName: string
    summary: string
    importance: Importance
    insights: string[]
  }>
}

export interface Report {
  id: string
  user_id: string
  report_data: ReportData
  sent_at: string | null
  email_opened: boolean
  created_at: string
}

export interface AnalysisUsage {
  id: string
  user_id: string
  asin: string
  product_name: string | null
  created_at: string
}
