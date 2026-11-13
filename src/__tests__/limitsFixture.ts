/**
 * The ranges `GET /rooms/limits` serves, as the backend's `DEFAULT_LIMITS`
 * declares them (`app/core/limits.py`), for tests that mount the host form.
 *
 * Test data, not a second source: the app keeps no copy of these numbers and
 * reads them from the server at run time. A test that needs the form must
 * serve them, exactly as the real backend would.
 */
import type { Limits } from '../types/game'

export const TEST_LIMITS: Limits = {
  max_order_quantity: 9_999,
  max_weeks: 104,
  min_weeks: 8,
  max_delay_weeks: 8,
  min_delay_weeks: 1,
  max_initial_quantity: 9_999,
  max_unit_value: 1_000_000.0,
  max_random_seed: Number.MAX_SAFE_INTEGER,
  min_step_week: 2,
  min_period_weeks: 2,
  max_period_weeks: 104,
  max_phase: 2 * Math.PI,
  max_currency_symbol_length: 4,
  max_bot_weight: 1.0,
  max_target_stock_multiplier: 10.0,
  min_batch_rooms: 2,
  max_batch_rooms: 10,
}
