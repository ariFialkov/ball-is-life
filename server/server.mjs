// Minimal reference backend exposing the SAME outcome engine the PWA embeds.
// Run with: node --experimental-strip-types server/server.mjs
// The engine files use only erasable TypeScript syntax, so Node can import them directly.
//
//   POST /api/round   { mode, bet, clientSeed, params }  -> RoundTicket (outcome predetermined)
//   GET  /api/config                                     -> public operator config (rtp, limits)
//   POST /api/operator { rtp }                           -> change the RTP at runtime
//   GET  /api/reveal/:nonce                              -> reveal the server seed for a settled round
//
// In a production deployment the client would call /api/round instead of
// running OutcomeEngine locally (see src/app/casino.ts), persist tickets in a
// database and settle wallets server-side. The on-court director in the client
// only ever *reproduces* the ticket; it cannot change it.
import http from 'node:http';
import { OutcomeEngine, DEFAULT_OPERATOR } from '../src/core/casino/engine.ts';

const engine = new OutcomeEngine({ ...DEFAULT_OPERATOR, serverSeed: process.env.SERVER_SEED ?? DEFAULT_OPERATOR.serverSeed, rtp: Number(process.env.RTP ?? DEFAULT_OPERATOR.rtp) });
const tickets = new Map();

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' });
  res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/config') {
      const { rtp, minBet, maxBet } = engine.config;
      return json(res, 200, { rtp, minBet, maxBet, nextFairnessHash: engine.fairnessHash(engine.nonce + 1) });
    }
    if (req.method === 'POST' && (url.pathname === '/api/round' || url.pathname === '/api/operator')) {
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body || '{}');
      if (url.pathname === '/api/operator') {
        engine.setRtp(Number(data.rtp));
        return json(res, 200, { rtp: engine.config.rtp });
      }
      const ticket = engine.createTicket({ mode: data.mode, bet: Number(data.bet), clientSeed: String(data.clientSeed ?? ''), params: data.params ?? {} });
      tickets.set(ticket.nonce, ticket);
      return json(res, 200, ticket);
    }
    const m = url.pathname.match(/^\/api\/reveal\/(\d+)$/);
    if (req.method === 'GET' && m) {
      const nonce = Number(m[1]);
      if (!tickets.has(nonce)) return json(res, 404, { error: 'unknown round' });
      return json(res, 200, { nonce, revealSeed: engine.revealSeed(nonce), fairnessHash: engine.fairnessHash(nonce) });
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 400, { error: String(e.message ?? e) });
  }
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => console.log(`Ball is Life outcome server on http://localhost:${port} (RTP ${engine.config.rtp})`));
