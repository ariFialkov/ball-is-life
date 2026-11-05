import { OutcomeEngine } from '../core/casino/engine.ts';
import type { LedgerEntry, ModeId, RoundTicket } from '../core/casino/types.ts';
import { store } from './store.ts';

/**
 * Client-side facade over the outcome engine. In production this would call
 * the server (see server/server.mjs, which exposes the very same engine over
 * HTTP); here the engine runs locally so the PWA works fully offline.
 */
class CasinoClient {
  private engine: OutcomeEngine;

  constructor() {
    this.engine = new OutcomeEngine(store.data.operator, store.data.nonce);
  }

  get rtp() {
    return store.data.operator.rtp;
  }

  get config() {
    return store.data.operator;
  }

  setOperator(patch: Partial<typeof store.data.operator>) {
    store.data.operator = { ...store.data.operator, ...patch };
    this.engine = new OutcomeEngine(store.data.operator, store.data.nonce);
    store.save();
  }

  get balance() {
    return store.data.balance;
  }

  canBet(bet: number) {
    return bet >= this.config.minBet && bet <= this.config.maxBet && bet <= store.data.balance;
  }

  /** Debit the bet and create the predetermined ticket. */
  placeBet(mode: ModeId, bet: number, params: Record<string, unknown>): RoundTicket {
    if (!this.canBet(bet)) throw new Error('Invalid bet');
    store.data.balance -= bet;
    const ticket = this.engine.createTicket({ mode, bet, clientSeed: store.data.clientSeed, params });
    store.data.nonce = this.engine.nonce;
    store.data.totals.wagered += bet;
    store.data.totals.rounds++;
    store.save();
    return ticket;
  }

  /** Credit the payout and record the round. */
  settle(ticket: RoundTicket, multiplier: number, summary: string): LedgerEntry {
    const payout = Math.round(ticket.bet * multiplier * 100) / 100;
    store.data.balance += payout;
    store.data.totals.returned += payout;
    const entry: LedgerEntry = {
      ticketId: ticket.id,
      mode: ticket.mode,
      bet: ticket.bet,
      payout,
      multiplier,
      summary,
      settledAt: Date.now(),
      fairnessHash: ticket.fairnessHash,
      revealSeed: this.engine.revealSeed(ticket.nonce),
    };
    store.data.ledger.unshift(entry);
    store.data.ledger = store.data.ledger.slice(0, 60);
    store.save();
    return entry;
  }

  addDemoFunds(amount = 1000) {
    store.data.balance += amount;
    store.save();
  }
}

export const casino = new CasinoClient();

export function fmtCredits(v: number) {
  return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
