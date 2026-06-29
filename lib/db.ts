export interface User {
  id: number;
  name: string;
  created_at: string;
}

export interface Holding {
  id: number;
  user_id: number;
  ticker: string;
  market: 'US' | 'JP';
  shares: number;
  cost_price: number;
  created_at: string;
}

export interface NisaTsumitate {
  id: number;
  user_id: number;
  fund_code: string;
  fund_name: string;
  broker: string;
  accumulation_type: 'amount' | 'units';
  monthly_amount: number;
  monthly_units: number;
  purchase_price: number;
  start_date: string;
  // 基準日方式
  baseline_units:     number;       // 基準日時点の保有口数（0 = 基準なし）
  baseline_avg_price: number;       // 基準日時点の平均取得単価（円/万口）
  accumulation_day:   number | null; // 毎月の積立日（null = start_date の日付を使用）
  created_at: string;
}

export interface NisaGrowth {
  id: number;
  user_id: number;
  type: 'fund' | 'stock';
  market: 'JP' | 'US';
  code: string;
  fund_name: string;
  units_or_shares: number;
  purchase_price: number;
  purchase_date: string;
  created_at: string;
}

/** Yahoo Finance に渡すティッカー（日本株は末尾に .T を付加） */
export function toYfTicker(ticker: string, market: 'US' | 'JP'): string {
  return market === 'JP' ? `${ticker}.T` : ticker;
}