import { Server as HttpServer } from 'http';
import { Server as IoServer } from 'socket.io';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { websocketConnections } from '../metrics/registry';

let io: IoServer | null = null;

export function initIoServer(httpServer: HttpServer): IoServer {
  io = new IoServer(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN,
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    websocketConnections.inc();
    logger.info({ socketId: socket.id }, 'WebSocket client connected');

    // Client joins a deployment-specific room to receive its logs
    socket.on('deployment:subscribe', (deploymentId: string) => {
      if (typeof deploymentId !== 'string' || !deploymentId.trim()) {
        socket.emit('error', { message: 'Invalid deployment ID' });
        return;
      }
      const room = `deployment:${deploymentId}`;
      socket.join(room);
      logger.info({ socketId: socket.id, deploymentId }, 'Client subscribed to deployment');
    });

    socket.on('deployment:unsubscribe', (deploymentId: string) => {
      const room = `deployment:${deploymentId}`;
      socket.leave(room);
      logger.info({ socketId: socket.id, deploymentId }, 'Client unsubscribed from deployment');
    });

    socket.on('disconnect', (reason) => {
      websocketConnections.dec();
      logger.info({ socketId: socket.id, reason }, 'WebSocket client disconnected');
    });

    socket.on('error', (err) => {
      logger.error({ socketId: socket.id, err }, 'WebSocket error');
    });
  });

  logger.info('Socket.io server initialized');
  return io;
}

/**
 * Returns the initialized Socket.io instance.
 * Returns null if called before initIoServer (safe — job checks for null).
 */
export function getIoServer(): IoServer | null {
  return io;
}
