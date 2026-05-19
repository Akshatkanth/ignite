import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { DeploymentStatus } from '@devflow/shared';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { getIoServer } from '../websocket/io';
import { LogLevel } from '@devflow/shared';

const PREVIEW_STORAGE_DIR = path.resolve(process.cwd(), 'storage', 'previews');
const PREVIEW_PUBLIC_BASE_URL = `http://localhost:${env.PORT}`;
const DEFAULT_APP_URL = process.env.DEPLOYMENT_PREVIEW_URL;

function getPreviewFileName(deploymentId: string): string {
  return `${deploymentId}.png`;
}

function getPreviewFilePath(deploymentId: string): string {
  return path.join(PREVIEW_STORAGE_DIR, getPreviewFileName(deploymentId));
}

function getPreviewUrl(deploymentId: string): string {
  return `${PREVIEW_PUBLIC_BASE_URL}/previews/${getPreviewFileName(deploymentId)}`;
}

export async function captureDeploymentPreview(deploymentId: string, targetUrl?: string): Promise<void> {
  const deployment = await prisma.deployment.findUnique({
    where: { id: deploymentId },
    select: {
      status: true,
      project: {
        select: { repoUrl: true },
      },
    },
  });

  if (!deployment || deployment.status !== DeploymentStatus.HEALTHY) {
    return;
  }

  // Use explicit targetUrl, or fall back to repo URL, or env default
  const resolvedTargetUrl = targetUrl ?? deployment.project.repoUrl ?? DEFAULT_APP_URL;

  if (!resolvedTargetUrl) {
    await prisma.deploymentLog.create({
      data: {
        deploymentId,
        message: 'Preview capture skipped: no URL available (no repoUrl configured)',
        level: 'warn',
        timestamp: new Date(),
      },
    });
    logger.warn({ deploymentId }, 'Preview capture skipped: no target URL');
    return;
  }

  await fs.mkdir(PREVIEW_STORAGE_DIR, { recursive: true });

  const filePath = getPreviewFilePath(deploymentId);
  const previewUrl = getPreviewUrl(deploymentId);
  const capturedAt = new Date();

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  // Retry loop to handle timing/network flakiness when the deployed app becomes reachable
  const maxAttempts = 5;
  let attempt = 0;
  let lastErr: unknown = null;

  try {
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        browser = await chromium.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });

        const page = await browser.newPage({
          viewport: { width: 1440, height: 1024 },
          deviceScaleFactor: 1,
        });

        await page.goto(resolvedTargetUrl, {
          waitUntil: 'load',
          timeout: 30_000,
        });

        await page.waitForTimeout(1000);

        await page.screenshot({ path: filePath, fullPage: true, type: 'png' });

        await prisma.deployment.update({
          where: { id: deploymentId },
          data: {
            previewScreenshotPath: filePath,
            previewScreenshotUrl: previewUrl,
            previewScreenshotCapturedAt: capturedAt,
          },
        });

        logger.info(
          { deploymentId, previewScreenshotPath: filePath, previewScreenshotUrl: previewUrl, captureTarget: resolvedTargetUrl },
          'Deployment preview screenshot captured'
        );

        // Emit websocket event so frontends update without manual refresh
        try {
          const io = getIoServer();
          if (io) {
            io.to(`deployment:${deploymentId}`).emit('deployment:preview', {
              deploymentId,
              previewScreenshotUrl: previewUrl,
              previewScreenshotCapturedAt: capturedAt.toISOString(),
            });
          }
        } catch (emitErr) {
          logger.warn({ deploymentId, err: emitErr }, 'Failed to emit deployment preview event');
        }

        // Success — break retry loop
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        logger.warn({ deploymentId, attempt, err }, 'Deployment preview attempt failed');

        // close browser if opened
        if (browser) {
          await browser.close().catch((cErr) => logger.warn({ deploymentId, err: cErr }, 'Failed to close browser')); 
          browser = null;
        }

        // Exponential backoff before retrying
        const backoffMs = 1000 * Math.pow(2, attempt - 1);
        await new Promise((res) => setTimeout(res, backoffMs));
      }
    }

    if (lastErr) {
      // Persist a warning log line so the UI shows why preview is missing
      try {
        await prisma.deploymentLog.create({
          data: {
            deploymentId,
            message: `Preview capture failed after ${maxAttempts} attempts for target ${resolvedTargetUrl}: ${String(lastErr)}`,
            level: 'warn',
            timestamp: new Date(),
          },
        });
      } catch (logErr) {
        logger.warn({ deploymentId, err: logErr }, 'Failed to persist preview failure log');
      }
      logger.warn({ deploymentId, err: lastErr }, 'Deployment preview screenshot failed after retries');
    }
  } finally {
    if (browser) {
      await browser.close().catch((err) => {
        logger.warn({ deploymentId, err }, 'Failed to close preview browser cleanly');
      });
    }
  }
}