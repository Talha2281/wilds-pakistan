import { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured } from '../data/supabaseClient';
import {
  AnimalId,
  BiomeId,
  CoopPeerState,
  CoopSquadMode,
  GaitState,
  GameMode,
  GrowthStage,
} from '../types/game';

export type CoopTransportKind = 'websocket' | 'supabase' | 'broadcast' | 'offline';

export interface CoopWelcomePayload {
  roomCode: string;
  squadMode: CoopSquadMode;
  biomeId: BiomeId;
  mode: GameMode;
  seed: number;
}

export interface CoopEventNotification {
  peerId: string;
  playerName: string;
  eventType: string;
  label: string;
}

export class CoopClient {
  private peerId: string;
  private roomCode = '';
  private squadMode: CoopSquadMode = 'rangers';
  private transport: CoopTransportKind = 'offline';

  private ws: WebSocket | null = null;
  private sbChannel: RealtimeChannel | null = null;
  private bc: BroadcastChannel | null = null;

  private peers: Map<string, CoopPeerState> = new Map();
  private onPeersChange?: (peers: CoopPeerState[], transport: CoopTransportKind) => void;
  private onWelcome?: (welcome: CoopWelcomePayload) => void;
  private onCoopEvent?: (ev: CoopEventNotification) => void;
  private pruneTimer: number | null = null;

  constructor(callbacks?: {
    onPeersChange?: (peers: CoopPeerState[], transport: CoopTransportKind) => void;
    onWelcome?: (welcome: CoopWelcomePayload) => void;
    onCoopEvent?: (ev: CoopEventNotification) => void;
  }) {
    this.peerId = `peer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.onPeersChange = callbacks?.onPeersChange;
    this.onWelcome = callbacks?.onWelcome;
    this.onCoopEvent = callbacks?.onCoopEvent;
  }

  public getPeerId(): string {
    return this.peerId;
  }

  public getTransport(): CoopTransportKind {
    return this.transport;
  }

  public getRoomCode(): string {
    return this.roomCode;
  }

  public getPeers(): CoopPeerState[] {
    return Array.from(this.peers.values());
  }

  public joinRoom(params: {
    roomCode: string;
    squadMode: CoopSquadMode;
    playerName: string;
    animalId: AnimalId;
    skinId?: string;
    biomeId: BiomeId;
    mode: GameMode;
    seed: number;
  }): void {
    this.disconnect();
    this.roomCode = params.roomCode.trim().toUpperCase() || 'PK-ALPHA';
    this.squadMode = params.squadMode;
    this.peers.clear();

    // Prune stale disconnected peers periodically
    this.pruneTimer = window.setInterval(() => {
      const cutoff = Date.now() - 12000;
      let removed = false;
      for (const [id, peer] of this.peers.entries()) {
        if (peer.updatedAt < cutoff) {
          this.peers.delete(id);
          removed = true;
        }
      }
      if (removed) this.emitPeers();
    }, 3000);

    // 1) Try same-origin WebSocket server (/ws) if running on Node/Express
    if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProto}//${window.location.host}/ws`;
      let settled = false;

      try {
        const socket = new WebSocket(wsUrl);
        this.ws = socket;

        const fallbackTimer = window.setTimeout(() => {
          if (!settled && socket.readyState !== WebSocket.OPEN) {
            settled = true;
            try {
              socket.close();
            } catch {
              // ignore
            }
            this.ws = null;
            this.connectFallbackChannels(params);
          }
        }, 1600);

        socket.onopen = () => {
          settled = true;
          window.clearTimeout(fallbackTimer);
          this.transport = 'websocket';
          socket.send(
            JSON.stringify({
              type: 'join',
              roomCode: this.roomCode,
              squadMode: this.squadMode,
              peerId: this.peerId,
              playerName: params.playerName,
              animalId: params.animalId,
              skinId: params.skinId,
              biomeId: params.biomeId,
              mode: params.mode,
              seed: params.seed,
              x: 0,
              y: 0,
              z: 0,
              heading: 0,
              gait: 'idle',
            }),
          );
          this.emitPeers();
        };

        socket.onmessage = (ev) => {
          try {
            const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
            this.handleIncomingMessage(msg);
          } catch {
            // ignore malformed
          }
        };

        socket.onerror = () => {
          if (!settled) {
            settled = true;
            window.clearTimeout(fallbackTimer);
            this.ws = null;
            this.connectFallbackChannels(params);
          }
        };
        return;
      } catch {
        // Fall through to Supabase / BroadcastChannel
      }
    }

    this.connectFallbackChannels(params);
  }

  private connectFallbackChannels(params: {
    roomCode: string;
    squadMode: CoopSquadMode;
    playerName: string;
    animalId: AnimalId;
    skinId?: string;
    biomeId: BiomeId;
    mode: GameMode;
    seed: number;
  }): void {
    const sb = getSupabaseClient();
    if (sb && isSupabaseConfigured) {
      this.transport = 'supabase';
      const channel = sb.channel(`wp-coop-${this.roomCode}`, {
        config: { broadcast: { self: false } },
      });
      channel
        .on('broadcast', { event: 'coop_msg' }, (payload) => {
          if (payload?.payload) {
            this.handleIncomingMessage(payload.payload as Record<string, unknown>);
          }
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            channel.send({
              type: 'broadcast',
              event: 'coop_msg',
              payload: {
                type: 'peer_update',
                peer: {
                  peerId: this.peerId,
                  playerName: params.playerName,
                  animalId: params.animalId,
                  skinId: params.skinId,
                  x: 0,
                  y: 0,
                  z: 0,
                  heading: 0,
                  gait: 'idle',
                  updatedAt: Date.now(),
                },
              },
            });
          }
        });
      this.sbChannel = channel;
      this.emitPeers();
      return;
    }

    if (typeof BroadcastChannel !== 'undefined') {
      this.transport = 'broadcast';
      const bc = new BroadcastChannel(`wild-pakistan-coop-${this.roomCode}`);
      bc.onmessage = (ev) => {
        if (ev.data && typeof ev.data === 'object') {
          this.handleIncomingMessage(ev.data as Record<string, unknown>);
        }
      };
      this.bc = bc;
      bc.postMessage({
        type: 'peer_update',
        peer: {
          peerId: this.peerId,
          playerName: params.playerName,
          animalId: params.animalId,
          skinId: params.skinId,
          x: 0,
          y: 0,
          z: 0,
          heading: 0,
          gait: 'idle',
          updatedAt: Date.now(),
        },
      });
      this.emitPeers();
      return;
    }

    this.transport = 'offline';
    this.emitPeers();
  }

  private handleIncomingMessage(msg: Record<string, unknown>): void {
    const type = String(msg.type || '');
    if (type === 'room_welcome') {
      const list = Array.isArray(msg.peers) ? (msg.peers as CoopPeerState[]) : [];
      this.peers.clear();
      for (const p of list) {
        if (p.peerId && p.peerId !== this.peerId) {
          this.peers.set(p.peerId, { ...p, updatedAt: Date.now() });
        }
      }
      this.onWelcome?.({
        roomCode: String(msg.roomCode || this.roomCode),
        squadMode: msg.squadMode === 'wolf_pack' ? 'wolf_pack' : 'rangers',
        biomeId: (msg.biomeId as BiomeId) || 'northern_mountains',
        mode: (msg.mode as GameMode) || 'wild_life',
        seed: Number(msg.seed || 0),
      });
      this.emitPeers();
    } else if (type === 'peer_update' && msg.peer && typeof msg.peer === 'object') {
      const p = msg.peer as CoopPeerState;
      if (p.peerId && p.peerId !== this.peerId) {
        this.peers.set(p.peerId, { ...p, updatedAt: Date.now() });
        this.emitPeers();
      }
    } else if (type === 'peer_left' && typeof msg.peerId === 'string') {
      if (this.peers.delete(msg.peerId)) {
        this.emitPeers();
      }
    } else if (type === 'coop_event') {
      if (msg.peerId !== this.peerId) {
        this.onCoopEvent?.({
          peerId: String(msg.peerId || ''),
          playerName: String(msg.playerName || 'Teammate'),
          eventType: String(msg.eventType || ''),
          label: String(msg.label || ''),
        });
      }
    }
  }

  private emitPeers(): void {
    this.onPeersChange?.(this.getPeers(), this.transport);
  }

  public sendState(state: {
    playerName: string;
    animalId: AnimalId;
    skinId?: string;
    x: number;
    y: number;
    z: number;
    heading: number;
    gait: GaitState;
    growthStage?: GrowthStage;
  }): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'state',
          x: state.x,
          y: state.y,
          z: state.z,
          heading: state.heading,
          gait: state.gait,
          animalId: state.animalId,
          skinId: state.skinId,
          growthStage: state.growthStage,
        }),
      );
      return;
    }

    const peerPayload: CoopPeerState = {
      peerId: this.peerId,
      playerName: state.playerName,
      animalId: state.animalId,
      skinId: state.skinId,
      x: state.x,
      y: state.y,
      z: state.z,
      heading: state.heading,
      gait: state.gait,
      growthStage: state.growthStage,
      updatedAt: Date.now(),
    };

    if (this.sbChannel) {
      this.sbChannel.send({
        type: 'broadcast',
        event: 'coop_msg',
        payload: { type: 'peer_update', peer: peerPayload },
      });
    } else if (this.bc) {
      this.bc.postMessage({ type: 'peer_update', peer: peerPayload });
    }
  }

  public sendCoopEvent(playerName: string, eventType: string, label = ''): void {
    const payload = {
      type: 'coop_event',
      peerId: this.peerId,
      playerName,
      eventType,
      label,
    };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    } else if (this.sbChannel) {
      this.sbChannel.send({ type: 'broadcast', event: 'coop_msg', payload });
    } else if (this.bc) {
      this.bc.postMessage(payload);
    }
  }

  public disconnect(): void {
    if (this.pruneTimer !== null) {
      window.clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    if (this.sbChannel) {
      this.sbChannel.unsubscribe().catch(() => {});
      this.sbChannel = null;
    }
    if (this.bc) {
      this.bc.postMessage({ type: 'peer_left', peerId: this.peerId });
      this.bc.close();
      this.bc = null;
    }
    this.peers.clear();
    this.transport = 'offline';
  }
}
