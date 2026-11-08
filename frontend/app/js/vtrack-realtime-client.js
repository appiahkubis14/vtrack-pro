/**
 * VTrackRealtimeClient - a resilient wrapper around the Socket.IO client
 * already used elsewhere in the app (see live-map.html), purpose-built for
 * the specific failure mode Ghanaian mobile data actually has: not a clean
 * "connected" or "disconnected" binary, but frequent short drops (a few
 * seconds, moving between cell towers) mixed with occasional long outages
 * (real signal loss in low-coverage areas). Socket.IO's own built-in
 * reconnection exists, but its default backoff curve and lack of
 * distinction between "brief blip" and "sustained outage" isn't quite
 * right for this use case - a UI that flickers "Reconnecting..." on every
 * 2-second blip is worse than one that only surfaces a warning once the
 * outage is genuinely sustained.
 *
 * Plain JS, no build step - loaded via a normal <script src> tag like every
 * other file in this frontend. Requires socket.io-client's UMD build to
 * already be loaded on the page (assigns the global `io`), same as
 * live-map.html does today.
 *
 * Usage:
 *   const client = new VTrackRealtimeClient({
 *     url: `${window.VTrackAPI.wsBaseUrl}/twin`,
 *     token: window.VTrackAPI.getToken(),
 *     organizationId: user.organizationId,
 *   });
 *   client.on('digitalTwinUpdate', (state) => updateMarker(state));
 *   client.onConnectionStateChange((state) => updateStatusBadge(state));
 *   client.connect();
 */

/** @typedef {'connecting'|'connected'|'reconnecting'|'offline'} ConnectionState */

class VTrackRealtimeClient {
  static MAX_QUEUED_EVENTS = 50;

  /**
   * @param {{
   *   url: string,
   *   token: string,
   *   organizationId: string,
   *   blipThresholdMs?: number,
   *   maxBackoffMs?: number,
   * }} options
   */
  constructor(options) {
    this.socket = null;
    this.reconnectAttempt = 0;
    this.disconnectedAt = null;
    this.blipTimer = null;
    /** @type {ConnectionState} */
    this.connectionState = 'offline';
    this.stateListeners = new Set();
    this.eventListeners = new Map();
    this.outboundQueue = [];

    this.opts = {
      blipThresholdMs: 3000,
      maxBackoffMs: 30_000,
      ...options,
    };
  }

  connect() {
    const io = window.io;
    if (!io) {
      throw new Error('socket.io-client must be loaded before VTrackRealtimeClient.connect()');
    }

    this.setState('connecting');

    this.socket = io(this.opts.url, {
      transports: ['websocket'],
      auth: { token: this.opts.token },
      reconnection: false, // handled manually below - Socket.IO's default backoff curve doesn't distinguish blips from real outages the way this needs
    });

    this.socket.on('connect', () => this.handleConnect());
    this.socket.on('disconnect', (reason) => this.handleDisconnect(reason));
    this.socket.on('connect_error', () => this.scheduleReconnect());

    this.eventListeners.forEach((handlers, event) => {
      handlers.forEach((handler) => this.socket.on(event, handler));
    });
  }

  disconnect() {
    this.clearBlipTimer();
    this.socket?.disconnect();
    this.socket = null;
    this.setState('offline');
  }

  on(event, handler) {
    if (!this.eventListeners.has(event)) this.eventListeners.set(event, new Set());
    this.eventListeners.get(event).add(handler);
    this.socket?.on(event, handler);
  }

  off(event, handler) {
    this.eventListeners.get(event)?.delete(handler);
    this.socket?.off(event, handler);
  }

  onConnectionStateChange(listener) {
    this.stateListeners.add(listener);
    listener(this.connectionState);
  }

  /**
   * Emits now if connected, otherwise queues for replay on reconnect. Use
   * for non-critical client->server messages (e.g. "I'm viewing vehicle X" -
   * a presence hint) - never for anything requiring a guaranteed delivery
   * confirmation, which needs a real request/response HTTP call instead.
   */
  emit(event, payload) {
    if (this.connectionState === 'connected' && this.socket) {
      this.socket.emit(event, payload);
      return;
    }
    if (this.outboundQueue.length >= VTrackRealtimeClient.MAX_QUEUED_EVENTS) {
      this.outboundQueue.shift();
    }
    this.outboundQueue.push({ event, payload });
  }

  handleConnect() {
    this.reconnectAttempt = 0;
    this.disconnectedAt = null;
    this.clearBlipTimer();
    this.setState('connected');

    this.socket.emit('joinOrg', this.opts.organizationId);

    while (this.outboundQueue.length) {
      const { event, payload } = this.outboundQueue.shift();
      this.socket.emit(event, payload);
    }
  }

  handleDisconnect(reason) {
    this.disconnectedAt = Date.now();

    // A brief blip doesn't need to alarm the user - only flip to the
    // visible "reconnecting" state if the outage outlasts the threshold.
    // If this callback ever actually runs, that means no reconnect
    // succeeded in the meantime - a successful handleConnect() call clears
    // this timer via clearBlipTimer() before it can fire. So the
    // transition here is unconditional, not gated on re-checking
    // connectionState (which would still read 'connected' from before the
    // disconnect, since nothing else moves it away from that in between).
    this.blipTimer = setTimeout(() => {
      this.setState('reconnecting');
    }, this.opts.blipThresholdMs);

    // 'io server disconnect' means the server explicitly closed the
    // connection (e.g. auth expired) - reconnecting immediately without a
    // fresh token would just loop the same failure.
    if (reason === 'io server disconnect') {
      this.setState('offline');
      return;
    }

    this.scheduleReconnect();
  }

  scheduleReconnect() {
    this.reconnectAttempt += 1;
    const backoff = Math.min(1000 * 2 ** this.reconnectAttempt, this.opts.maxBackoffMs);
    // Jitter avoids a thundering-herd reconnect storm if many devices on
    // the same cell tower drop and recover together.
    const jitter = Math.random() * 0.3 * backoff;

    setTimeout(() => {
      if (this.connectionState === 'connected') return;
      this.connect();
    }, backoff + jitter);
  }

  setState(state) {
    if (this.connectionState === state) return;
    this.connectionState = state;
    this.stateListeners.forEach((listener) => listener(state));
  }

  clearBlipTimer() {
    if (this.blipTimer) {
      clearTimeout(this.blipTimer);
      this.blipTimer = null;
    }
  }
}

window.VTrackRealtimeClient = VTrackRealtimeClient;
