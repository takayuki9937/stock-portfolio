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
  baseline_amount:  number;        // 基準日時点の投資総額（円）
  baseline_nav:     number;        // 基準日時点の基準価額（0 = インデックスから自動推定）
  accumulation_day: number | null; // 毎月の積立日（null = start_date の日付を使用）
  created_at: string;
}

export interface NisaGrowth {
  id: number;
  user_id: number;
  type: 'fund' | 'stock';
  market: 'JP' | 'US';
  code: string;
  fund_name: string;
  purchase_amount: number; // 購入金額（円 or ドル）
  purchase_nav:    number; // 購入時の基準価額（投信: ¥/万口、株: ¥ or $ per share）
  purchase_date: string;
  created_at: string;
}

/** Yahoo Finance に渡すティッカー（日本株は末尾に .T を付加） */
export function toYfTicker(ticker: string, market: 'US' | 'JP'): string {
  return market === 'JP' ? `${ticker}.T` : ticker;
}